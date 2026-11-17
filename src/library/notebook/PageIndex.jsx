import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HandDrawing, HandIcon } from './HandIcon'
import { HighlightStroke } from './HighlightStroke'
import { Paper } from './Paper'
import { getPageTexts, getPageTitles } from '../db'
import { plainText } from '../lib/noteLists'
import { colors, fonts, HAND_TAIL, handTailWidth, highlighters, notebook } from '../theme'

const LEFT = notebook.marginX + 8
const RIGHT = 14
const COLUMNS = 5
const ROW = 50
// Bulunan yerin iki yanında gösterilen yazı
const CONTEXT = 28

function lower(text) {
  return text.toLocaleLowerCase('tr')
}

// Not defterinin içindeki sayfa listesi: takvim yaprağı gibi görünen sayfanın üstüne kapanır.
// Sayfa numaraları kâğıda elle yazılmış, yazılı sayfalar fosforlu kalemle boyanmış; numaraya
// dokununca o sayfa açılır. Üstteki satıra yazılan, sayfaların notlarında aranır.
export function PageIndex({ notebookId, pages, current, onClose, onOpenPage }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  // Sayfa numarası → sayfadaki notların yazısı
  const [texts, setTexts] = useState(null)
  // Sayfa numarası → sayfaya yazılan başlık
  const [titles, setTitles] = useState(new Map())
  const [query, setQuery] = useState('')
  const cellWidth = (width - LEFT - RIGHT) / COLUMNS

  useEffect(() => {
    let cancelled = false
    getPageTitles(notebookId).then((map) => {
      if (!cancelled) setTitles(map)
    })
    getPageTexts(notebookId).then((rows) => {
      if (cancelled) return
      const map = new Map()
      for (const row of rows) {
        const text = plainText(row.content)
        map.set(row.ref, map.has(row.ref) ? `${map.get(row.ref)} ${text}` : text)
      }
      setTexts(map)
    })
    return () => {
      cancelled = true
    }
  }, [notebookId])

  const search = query.trim()
  // Başlığında ya da notlarında aranan geçen sayfalar, sayfa sırasıyla
  const matches =
    search && texts
      ? [...new Set([...texts.keys(), ...titles.keys()])]
          .sort((a, b) => a - b)
          .map((number) => {
            const text = texts.get(number) ?? ''
            const title = titles.get(number) ?? ''
            return {
              number,
              title,
              text,
              at: lower(text).indexOf(lower(search)),
              inTitle: lower(title).includes(lower(search)),
            }
          })
          .filter((m) => m.at !== -1 || m.inTitle)
      : null

  const numbers = Array.from({ length: pages }, (_, i) => i + 1)
  const rows = []
  for (let i = 0; i < numbers.length; i += COLUMNS) rows.push(numbers.slice(i, i + COLUMNS))

  return (
    <Paper seed={7_100_000}>
      <StatusBar style="dark" />

      <View style={[styles.top, { paddingTop: insets.top + 4 }]}>
        <HandIcon shape="back" label="Sayfaya dön" size={28} onPress={onClose} />
      </View>

      <View style={styles.header}>
        <Text style={styles.title}>{'Sayfalar' + HAND_TAIL}</Text>
        <Text style={styles.meta}>
          {`${pages} sayfa · ${texts?.size ?? 0} yazılı · numaraya dokun` + HAND_TAIL}
        </Text>
      </View>

      <View style={styles.searchRow}>
        <HandDrawing shape="search" size={26} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Sayfalarda ara"
          placeholderTextColor="rgba(56, 56, 61, 0.35)"
          accessibilityLabel="Sayfalarda ara"
          returnKeyType="search"
          style={styles.searchInput}
        />
        {query !== '' && (
          <HandIcon shape="close" label="Aramayı temizle" size={22} onPress={() => setQuery('')} />
        )}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {matches ? (
          matches.length === 0 ? (
            <Text style={styles.empty}>{'Hiçbir sayfada bulunamadı' + HAND_TAIL}</Text>
          ) : (
            matches.map((m) => (
              <SearchResult
                key={m.number}
                number={m.number}
                title={m.title}
                text={m.text}
                at={m.at}
                length={search.length}
                onPress={() => onOpenPage(m.number)}
              />
            ))
          )
        ) : (
          rows.map((row, r) => (
            <View key={row[0]} style={styles.row}>
              {row.map((number) => (
                <PageNumber
                  key={number}
                  number={number}
                  width={cellWidth}
                  written={texts?.has(number) ?? false}
                  // Her on sayfa başka renk kalemle boyanır
                  color={highlighters[Math.floor(r / 2) % highlighters.length].color}
                  current={number === current}
                  onPress={() => onOpenPage(number)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Paper>
  )
}

function PageNumber({ number, width, written, color, current, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sayfa ${number}${written ? ', yazılı' : ', boş'}${current ? ', açık olan' : ''}`}
      accessibilityHint="Bu sayfayı aç"
      style={({ pressed }) => [styles.number, { width }, pressed && styles.pressed]}
    >
      {written && (
        <HighlightStroke
          width={width - 12}
          height={30}
          color={color}
          strength={0.45}
          seed={number * 31}
          style={styles.numberHighlight}
        />
      )}
      {current && (
        <View style={styles.ring} pointerEvents="none">
          <HandDrawing shape="ring" size={44} color={colors.today} />
        </View>
      )}
      <Text style={[styles.numberText, !written && styles.numberEmpty, current && styles.current]}>
        {number + HAND_TAIL}
      </Text>
    </Pressable>
  )
}

// Bulunan sayfa: numarası, başlığı ve aranan yerin çevresindeki yazı, bulunan kısım kalın.
// Aranan yalnızca başlıkta geçiyorsa notların başı gösterilir.
function SearchResult({ number, title, text, at, length, onPress }) {
  const found = at !== -1
  const start = found ? Math.max(0, at - CONTEXT) : 0
  const end = found ? Math.min(text.length, at + length + CONTEXT) : Math.min(text.length, CONTEXT * 2)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Bu sayfayı aç"
      style={({ pressed }) => [styles.result, pressed && styles.pressed]}
    >
      <Text style={styles.resultTitle} numberOfLines={1}>
        {(title ? `Sayfa ${number} · ${title}` : `Sayfa ${number}`) + HAND_TAIL}
      </Text>
      {text !== '' && (
        <Text style={styles.snippet} numberOfLines={2}>
          {start > 0 ? '…' : ''}
          {found ? (
            <>
              {text.slice(start, at)}
              <Text style={styles.snippetMatch}>{text.slice(at, at + length)}</Text>
              {text.slice(at + length, end)}
            </>
          ) : (
            text.slice(start, end)
          )}
          {end < text.length ? '…' : ''}
          {HAND_TAIL}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    paddingHorizontal: 10,
  },
  header: {
    paddingLeft: notebook.marginX + 12,
    paddingRight: 20,
    paddingBottom: 6,
  },
  // Defter sayfasındaki başlıkla aynı
  title: {
    alignSelf: 'flex-start',
    marginVertical: -6,
    marginRight: -handTailWidth(46),
    fontFamily: fonts.handBold,
    fontSize: 46,
    lineHeight: 62,
    color: 'rgba(56, 56, 61, 0.9)',
  },
  meta: {
    fontFamily: fonts.hand,
    fontSize: 19,
    color: 'rgba(56, 56, 61, 0.6)',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: notebook.marginX + 6,
    marginRight: 20,
    borderBottomWidth: 1,
    borderBottomColor: notebook.rule,
  },
  searchInput: {
    flex: 1,
    height: notebook.lineHeight + 8,
    padding: 0,
    fontFamily: fonts.handBold,
    fontSize: 24,
    color: notebook.graphite,
  },
  row: {
    flexDirection: 'row',
    marginLeft: LEFT,
  },
  number: {
    height: ROW,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  numberHighlight: {
    top: 12,
    left: 6,
  },
  ring: {
    position: 'absolute',
  },
  numberText: {
    fontFamily: fonts.handBold,
    fontSize: 26,
    color: notebook.graphite,
  },
  numberEmpty: {
    fontFamily: fonts.hand,
    color: 'rgba(56, 56, 61, 0.5)',
  },
  current: {
    color: colors.today,
  },
  pressed: {
    backgroundColor: 'rgba(56, 56, 61, 0.12)',
  },
  empty: {
    paddingLeft: notebook.marginX + 12,
    fontFamily: fonts.hand,
    fontSize: 21,
    color: 'rgba(56, 56, 61, 0.5)',
  },
  result: {
    paddingLeft: notebook.marginX + 12,
    paddingRight: 20,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: notebook.rule,
  },
  resultTitle: {
    alignSelf: 'flex-start',
    marginRight: -handTailWidth(26),
    fontFamily: fonts.handBold,
    fontSize: 26,
    color: notebook.graphite,
  },
  snippet: {
    marginRight: -handTailWidth(20),
    fontFamily: fonts.hand,
    fontSize: 20,
    lineHeight: 24,
    color: 'rgba(56, 56, 61, 0.75)',
  },
  snippetMatch: {
    fontFamily: fonts.handBold,
    color: notebook.graphite,
  },
})
