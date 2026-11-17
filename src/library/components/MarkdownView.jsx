import { Lexer } from 'marked'
import { useMemo, useState } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { ScrollView } from 'react-native-gesture-handler'
import Svg, { Path, Rect } from 'react-native-svg'

import { DocHighlights } from '../notebook/DocHighlights'

import { BLANK_BLOCK, blockImages, parseMarkdown } from '../lib/richText/markdownUnits'
import { docPage, docPageDark, fonts, inkOf } from '../theme'

// Yazı ölçüleri web'deki .cvmd CSS'ine denk: h1 1.75em/800, h2 1.4em/700, h3 1.15em/600, satır
// yüksekliği 1.5
const SIZE = docPage.fontSize

const HEADINGS = {
  1: { scale: 1.75, family: fonts.displayBold },
  2: { scale: 1.4, family: fonts.docHeadingBold },
  3: { scale: 1.15, family: fonts.docHeadingSemi },
  4: { scale: 1, family: fonts.bodyBold },
  5: { scale: 0.92, family: fonts.bodyBold },
  6: { scale: 0.85, family: fonts.bodyBold },
}

// Başlığın yazı boyu, satır yüksekliği ve üstündeki boşluk
function headingMetrics(depth) {
  const level = Math.min(6, Math.max(1, depth))
  const fontSize = SIZE * HEADINGS[level].scale
  return {
    level,
    fontSize,
    lineHeight: Math.round(fontSize * 1.28),
    marginTop: level <= 2 ? 6 : 2,
  }
}

// Yazı bir başlıkla başlıyorsa, biçimli görünümde o ilk satırın dikey ortası (görünümün üstünden);
// başlıkla başlamıyorsa null
export function leadingHeadingCenter(value) {
  // Başlık en çok iki satırdır (alt çizgili başlıkta), yazının gerisine bakmaya gerek yok
  const head = value
    .replace(/^\s*\n/, '')
    .split('\n', 2)
    .join('\n')
  const first = Lexer.lex(head, { gfm: true }).find((t) => t.type !== 'space')
  if (first?.type !== 'heading') return null
  const m = headingMetrics(first.depth)
  return m.marginTop + m.lineHeight / 2
}

const NO_MARKS = []

const SAFE_LINK = /^(https?:|mailto:)/i

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

// marked metin token'larındaki HTML varlıklarını çözmez (web'de tarayıcı çözer)
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const PLAIN = { bold: false, italic: false, strike: false, heading: null, link: null }

// Yazı parçası (ham yazıda from'dan başlayan) kalem renklerinin sınırlarından bölünür; her parça
// kendi renginde yazılır. Ham hâli ekrandakinden farklı parçada (kaçış, HTML varlığı) yalnızca
// parçanın tamamını kaplayan renk kullanılır. Fosforlu kalemin boyası burada değil, yazının
// arkasında şerit olarak çizilir (bkz. DocHighlights). Ölçüm kopyasında yazı ctx.cut'ta kesilir.
function markedText(text, raw, from, ctx) {
  if (ctx.cut !== undefined && from !== undefined) {
    if (from >= ctx.cut) return null
    if (raw === text && from + raw.length > ctx.cut) {
      text = text.slice(0, ctx.cut - from)
      raw = text
    }
  }
  const shown = decode(text)
  if (from === undefined || ctx.inks.length === 0) return shown
  const to = from + raw.length
  const inks = ctx.inks.filter((m) => m.end > from && m.start < to)
  if (inks.length === 0) return shown
  const colorAt = (a, b) => {
    const ink = inks.find((m) => m.start <= a && m.end >= b)
    return ink ? inkOf(ink.color).color : null
  }
  if (raw !== text) {
    const color = colorAt(from, to)
    return color ? <Text style={{ color }}>{shown}</Text> : shown
  }
  const cuts = new Set([from, to])
  for (const m of inks) {
    cuts.add(Math.max(from, m.start))
    cuts.add(Math.min(to, m.end))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const parts = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const piece = decode(text.slice(a - from, b - from))
    const color = colorAt(a, b)
    parts.push(
      color ? (
        <Text key={a} style={{ color }}>
          {piece}
        </Text>
      ) : (
        piece
      ),
    )
  }
  return parts
}

// Yazı bloğu (paragraf, başlık, tablo hücresi): üstünden fosforlu kalem geçtiyse arkasına şerit
// katmanı konur. block, bloğun ham yazıdaki yerini veren token'dır.
function BlockText({ block, tokens, inline, ctx, style, wrapperStyle, header }) {
  const start = ctx.offsets.get(block)
  const raw = block.raw ?? block.text
  const end = start === undefined || raw === undefined ? undefined : start + raw.length
  const highlights =
    start === undefined || end === undefined || ctx.cut !== undefined
      ? []
      : ctx.highlights
          .filter((m) => m.end > start && m.start < end)
          .map((m) => ({ ...m, start: Math.max(m.start, start), end: Math.min(m.end, end) }))
  const unit = ctx.cut === undefined ? ctx.unitOf.get(block) : undefined
  const editor = unit ? ctx.editor : undefined
  if (unit && editor && editor.active === unit.index) {
    return editor.renderInput({
      unit,
      style,
      wrapperStyle,
      spans: (cut) => rawSpans(unit.tokens, unit.start, unit.end, inline, ctx, cut),
    })
  }
  const text = (
    <Text
      style={style}
      accessibilityRole={header ? 'header' : undefined}
      accessibilityHint={editor ? 'Dokununca yazılır' : undefined}
      onPress={unit && editor ? () => editor.activate(unit.index) : undefined}
    >
      {renderInline(tokens, inline, ctx)}
    </Text>
  )
  if (highlights.length === 0) {
    return wrapperStyle ? <View style={wrapperStyle}>{text}</View> : text
  }
  return (
    <View style={wrapperStyle}>
      <DocHighlights
        highlights={highlights}
        textStyle={style}
        content={renderInline(tokens, inline, ctx)}
        upTo={(offset) => renderInline(tokens, inline, { ...ctx, cut: offset })}
      />
      {text}
    </View>
  )
}

// Yazılan birimin ham yazısı, biçimiyle: yazma alanının içeriği tam olarak ham yazının
// [from, to) aralığıdır. Token'ların arasında kalan işaretler ("**", "`", "[", "](adres)") soluk,
// yazının kendisi biçimiyle (kalın, italik, kod, link) ve kalem rengiyle yazılır. cut verilirse
// yazı orada kesilir (fosforlu kalemin ölçüm kopyaları için).
function rawSpans(tokens, from, to, inline, ctx, cut) {
  const limit = cut === undefined ? to : Math.min(to, cut)
  const out = []
  const faint = { ...leafStyle(inline, ctx.palette), color: ctx.palette.faint }
  const piece = (a, b, style, ink = true) => {
    if (b <= a) return
    const text = ctx.source.slice(a, b)
    const color = ink ? ctx.inks.find((m) => m.start <= a && m.end >= b)?.color : undefined
    if (!ink || ctx.inks.every((m) => m.end <= a || m.start >= b) || color) {
      out.push(
        <Text key={`${a}-${b}`} style={color ? [style, { color: inkOf(color).color }] : style}>
          {text}
        </Text>,
      )
      return
    }
    // Kalem rengi parçanın ortasında başlıyor ya da bitiyor: sınırlarından bölünür
    const cuts = new Set([a, b])
    for (const m of ctx.inks) {
      if (m.start > a && m.start < b) cuts.add(m.start)
      if (m.end > a && m.end < b) cuts.add(m.end)
    }
    const points = [...cuts].sort((x, y) => x - y)
    for (let i = 0; i < points.length - 1; i++) piece(points[i], points[i + 1], style)
  }
  const marker = (a, b) => piece(a, Math.min(b, limit), faint, false)
  const leaf = (a, b, style) => piece(a, Math.min(b, limit), style)

  let cursor = from
  for (const token of tokens) {
    const at = ctx.offsets.get(token)
    if (at === undefined || at < cursor) continue
    if (at >= limit) break
    const end = Math.min(at + token.raw.length, to)
    marker(cursor, at)
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
      case 'link': {
        const next =
          token.type === 'strong'
            ? { ...inline, bold: true }
            : token.type === 'em'
              ? { ...inline, italic: true }
              : token.type === 'del'
                ? { ...inline, strike: true }
                : { ...inline, link: token.href }
        out.push(...rawSpans(token.tokens ?? [], at, end, next, ctx, cut))
        break
      }
      case 'codespan': {
        const code = token
        const inner = code.raw.indexOf(code.text)
        const a = inner < 0 ? at : at + inner
        const b = inner < 0 ? end : a + code.text.length
        marker(at, a)
        leaf(a, b, { ...styles.codespan, backgroundColor: ctx.palette.inlineCodeBg })
        marker(b, end)
        break
      }
      case 'text':
      case 'escape': {
        const t = token
        if (t.tokens && t.tokens.length > 0) out.push(...rawSpans(t.tokens, at, end, inline, ctx, cut))
        else leaf(at, end, leafStyle(inline, ctx.palette))
        break
      }
      default:
        // Görsel, HTML, satır sonu: ham hâliyle, soluk
        marker(at, end)
    }
    cursor = Math.max(cursor, end)
  }
  marker(cursor, limit)
  return out
}

// Görev maddeleri yazıdaki sırayla numaralanır: token ağacında derinlemesine, madde maddeden önce
function indexTasks(tokens, map = new Map()) {
  for (const token of tokens) {
    if (token.type === 'list') {
      for (const item of token.items) {
        if (item.task) map.set(item, map.size)
        indexTasks(item.tokens, map)
      }
    } else if (token.type === 'blockquote') {
      indexTasks(token.tokens, map)
    }
  }
  return map
}

function leafStyle(inline, palette) {
  const family =
    inline.heading !== null
      ? HEADINGS[inline.heading].family
      : inline.bold && inline.italic
        ? fonts.docBoldItalic
        : inline.bold
          ? fonts.bodyBold
          : inline.italic
            ? fonts.docItalic
            : fonts.docBody
  return {
    fontFamily: family,
    ...(inline.link && { color: palette.link, textDecorationLine: 'underline' }),
    ...(inline.strike && {
      textDecorationLine: inline.link ? 'underline line-through' : 'line-through',
    }),
  }
}

function openLink(href) {
  if (SAFE_LINK.test(href)) Linking.openURL(href).catch(() => {})
}

function renderInline(tokens, inline, ctx, key = 'i') {
  if (!tokens) return []
  return tokens.map((token, i) => {
    const k = `${key}-${i}`
    if (ctx.cut !== undefined && (ctx.offsets.get(token) ?? -1) >= ctx.cut) return null
    switch (token.type) {
      case 'text':
      case 'escape': {
        const t = token
        if (t.tokens && t.tokens.length > 0) return renderInline(t.tokens, inline, ctx, k)
        return (
          <Text key={k} style={leafStyle(inline, ctx.palette)}>
            {markedText(t.text, t.raw, ctx.offsets.get(token), ctx)}
          </Text>
        )
      }
      case 'strong':
        return renderInline(token.tokens, { ...inline, bold: true }, ctx, k)
      case 'em':
        return renderInline(token.tokens, { ...inline, italic: true }, ctx, k)
      case 'del':
        return renderInline(token.tokens, { ...inline, strike: true }, ctx, k)
      case 'codespan': {
        const code = token
        const at = ctx.offsets.get(token)
        const inner = code.raw.indexOf(code.text)
        return (
          <Text key={k} style={[styles.codespan, { backgroundColor: ctx.palette.inlineCodeBg }]}>
            {markedText(code.text, code.text, at === undefined || inner < 0 ? undefined : at + inner, ctx)}
          </Text>
        )
      }
      case 'br':
        return '\n'
      case 'link': {
        const link = token
        const safe = SAFE_LINK.test(link.href)
        return (
          <Text
            key={k}
            onPress={safe ? () => openLink(link.href) : undefined}
            accessibilityRole={safe ? 'link' : undefined}
          >
            {renderInline(link.tokens, { ...inline, link: safe ? link.href : null }, ctx, k)}
          </Text>
        )
      }
      case 'image': {
        // Satır içinde görsel çizilemez; adı yazılır (blok görseller paragrafta ayrıca çizilir)
        const image = token
        return (
          <Text key={k} style={[leafStyle(inline, ctx.palette), { color: ctx.palette.muted }]}>
            {image.text ? `[${image.text}]` : ''}
          </Text>
        )
      }
      case 'html': {
        // Ham HTML etiketleri yok sayılır; <br> satır sonudur
        return /^<br\s*\/?>$/i.test(token.text.trim()) ? '\n' : null
      }
      case 'checkbox':
        return null
      default:
        return 'text' in token && typeof token.text === 'string' ? decode(token.text) : null
    }
  })
}

// Bloklar sırayla çizilir. Yalnızca görsellerden oluşan art arda paragraflar (ve birden çok görsel
// taşıyan tek paragraf) yerinde, yana kayan bir görsel şeridi olur; tek görsel tam genişlikte kalır.
function renderBlocks(tokens, ctx, key = 'b') {
  const blocks = tokens.filter((t) => t.type !== 'space' && t.type !== 'def')
  const out = []
  // Boş yazı: yazmaya başlanacak tek birim. Anahtarı ilk bloğunkiyle aynıdır, yazı paragraf olunca
  // yazma alanı yerinde kalır (klavye kapanıp açılmaz)
  if (blocks.length === 0 && key === 'b' && ctx.unitOf.has(BLANK_BLOCK)) {
    out.push(
      <BlockText
        key="b-0"
        block={BLANK_BLOCK}
        tokens={[]}
        inline={PLAIN}
        ctx={ctx}
        style={[styles.paragraph, { color: ctx.palette.ink }]}
      />,
    )
  }
  for (let i = 0; i < blocks.length; i++) {
    const k = `${key}-${i}`
    const images = blockImages(blocks[i])
    if (!images) {
      out.push(renderBlock(blocks[i], ctx, k))
      continue
    }
    const run = [...images]
    let next
    while (i + 1 < blocks.length && (next = blockImages(blocks[i + 1]))) {
      run.push(...next)
      i++
    }
    out.push(
      run.length === 1 ? (
        <MdImage key={k} uri={run[0].href} alt={run[0].text} palette={ctx.palette} />
      ) : (
        <ImageCarousel key={k} images={run} palette={ctx.palette} />
      ),
    )
  }
  return out
}

function renderBlock(token, ctx, k) {
  switch (token.type) {
    case 'heading': {
      const h = token
      const { level, fontSize, lineHeight, marginTop } = headingMetrics(h.depth)
      return (
        <BlockText
          key={k}
          block={h}
          tokens={h.tokens}
          inline={{ ...PLAIN, heading: level }}
          ctx={ctx}
          header
          wrapperStyle={{ marginTop }}
          style={[
            styles.heading,
            { fontFamily: HEADINGS[level].family, fontSize, lineHeight, color: ctx.palette.ink },
          ]}
        />
      )
    }
    // Paragraf da başlık gibi doğrudan BlockText'tir: yazarken biri ötekine dönünce (ör. "# "
    // yazılınca) yazma alanı yerinde kalır
    case 'paragraph':
      return (
        <BlockText
          key={k}
          block={token}
          tokens={token.tokens}
          inline={PLAIN}
          ctx={ctx}
          style={[styles.paragraph, { color: ctx.palette.ink }]}
        />
      )
    case 'text': {
      const t = token
      return (
        <BlockText
          key={k}
          block={t}
          tokens={t.tokens ?? [t]}
          inline={PLAIN}
          ctx={ctx}
          style={[styles.paragraph, { color: ctx.palette.ink }]}
        />
      )
    }
    case 'code':
      return <CodeBlock key={k} code={token.text} lang={token.lang} palette={ctx.palette} />
    case 'blockquote':
      return (
        <View key={k} style={[styles.quote, { borderLeftColor: ctx.palette.quoteBar }]}>
          {renderBlocks(token.tokens, { ...ctx, palette: { ...ctx.palette, ink: ctx.palette.muted } }, k)}
        </View>
      )
    case 'list':
      return <List key={k} list={token} ctx={ctx} k={k} />
    case 'table':
      return <Table key={k} table={token} ctx={ctx} />
    case 'hr':
      return <View key={k} style={[styles.hr, { backgroundColor: ctx.palette.rule }]} />
    case 'html': {
      const text = token.text.trim()
      return text ? (
        <Text key={k} style={[styles.rawHtml, { color: ctx.palette.muted }]}>
          {text}
        </Text>
      ) : null
    }
    default:
      return 'text' in token && typeof token.text === 'string' ? (
        <Text key={k} style={[styles.paragraph, { color: ctx.palette.ink }]}>
          {decode(token.text)}
        </Text>
      ) : null
  }
}

// Liste: işaret sütunu (madde, numara ya da görev kutusu) ve maddenin blokları
function List({ list, ctx, k }) {
  const start = typeof list.start === 'number' ? list.start : 1
  return (
    <View style={[styles.list, list.loose && styles.listLoose]}>
      {list.items.map((item, i) => {
        let marker
        if (item.task) {
          const index = ctx.taskIndex.get(item) ?? -1
          const box = <TaskBox checked={!!item.checked} palette={ctx.palette} />
          marker = ctx.onToggleTask ? (
            <Pressable
              hitSlop={8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!item.checked }}
              onPress={() => ctx.onToggleTask?.(index)}
            >
              {box}
            </Pressable>
          ) : (
            box
          )
        } else {
          marker = (
            <Text style={[styles.marker, { color: ctx.palette.muted }]}>
              {list.ordered ? `${start + i}.` : '•'}
            </Text>
          )
        }
        const blocks = item.tokens.filter((t) => t.type !== 'checkbox')
        return (
          <View key={`${k}-${i}`} style={styles.item}>
            <View style={[styles.markerCell, list.ordered && !item.task && styles.markerWide]}>{marker}</View>
            <View style={styles.itemBody}>
              {blocks.length === 0 && ctx.unitOf.has(item) ? (
                // Boş madde: işaretinin ardına yazılır
                <BlockText
                  block={item}
                  tokens={[]}
                  inline={PLAIN}
                  ctx={ctx}
                  style={[styles.paragraph, { color: ctx.palette.ink }]}
                />
              ) : (
                renderBlocks(blocks, ctx, `${k}-${i}`)
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function TaskBox({ checked, palette }) {
  return (
    <Svg width={16} height={16} style={styles.taskBox}>
      <Rect
        x={0.75}
        y={0.75}
        width={14.5}
        height={14.5}
        rx={3}
        fill={checked ? palette.check : 'none'}
        stroke={checked ? palette.check : palette.muted}
        strokeWidth={1.5}
      />
      {checked && (
        <Path
          d="M4 8.3 L6.8 11 L12 5.2"
          stroke="#FFFFFF"
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </Svg>
  )
}

// GFM tablosu: yana kayar; sütun genişliği o sütundaki en uzun yazıya göre
function Table({ table, ctx }) {
  const rows = [table.header, ...table.rows]
  const widths = table.header.map((_, col) => {
    const longest = Math.max(...rows.map((row) => (row[col]?.text ?? '').length))
    return Math.min(260, Math.max(72, longest * 7.6 + 24))
  })
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={[styles.table, { borderColor: ctx.palette.rule }]}>
        {rows.map((row, r) => (
          <View
            key={r}
            style={[
              styles.tableRow,
              r > 0 && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: ctx.palette.rule },
            ]}
          >
            {row.map((cell, c) => (
              <View
                key={c}
                style={[
                  styles.tableCell,
                  { width: widths[c] },
                  c > 0 && {
                    borderLeftWidth: StyleSheet.hairlineWidth * 2,
                    borderLeftColor: ctx.palette.rule,
                  },
                  r === 0 && { backgroundColor: ctx.palette.inlineCodeBg },
                ]}
              >
                <BlockText
                  block={cell}
                  tokens={cell.tokens}
                  inline={{ ...PLAIN, bold: r === 0 }}
                  ctx={ctx}
                  style={[styles.cellText, { color: ctx.palette.ink, textAlign: table.align[c] ?? 'left' }]}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

// Kod bloğu: koyu kutu, sağ üstte dil etiketi, uzun satırlar yana kayar
function CodeBlock({ code, lang, palette }) {
  const label = (lang ?? '').split(/\s/)[0]
  return (
    <View style={[styles.code, { backgroundColor: palette.codeBg }]}>
      {label !== '' && <Text style={[styles.codeLabel, { color: palette.codeLabel }]}>{label}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={[styles.codeText, { color: palette.codeInk }, label !== '' && styles.codeTextLabeled]}>
          {code.replace(/\n$/, '')}
        </Text>
      </ScrollView>
    </View>
  )
}

// Yalnızca https görseller; oran korunarak genişliğe sığar
function MdImage({ uri, alt, palette }) {
  const [ratio, setRatio] = useState(null)
  const [failed, setFailed] = useState(false)
  if (!/^https:\/\//i.test(uri) || failed) {
    return alt ? <Text style={[styles.paragraph, { color: palette.muted }]}>{`[${alt}]`}</Text> : null
  }
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={alt || undefined}
      resizeMode="contain"
      onLoad={(e) => {
        const { width, height } = e.nativeEvent.source
        if (width > 0 && height > 0) setRatio(width / height)
      }}
      onError={() => setFailed(true)}
      style={[styles.image, { aspectRatio: ratio ?? 16 / 9 }]}
    />
  )
}

// Art arda görseller: yana kayan şerit. Kart sayfanın %82'si genişliğinde, sonraki kartın ucu görünür
// ki kaydırılabildiği anlaşılsın; bırakınca kart yerine oturur. Altta görselin adı ve kaçıncı
// görselde olunduğunu gösteren noktalar. Kaydırma gesture-handler'ındır: şeridin üstünde yana
// sürükleyince sayfa çevrilmez.
const CARD_GAP = 10

function ImageCarousel({ images, palette }) {
  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const card = Math.round(width * 0.82)
  const step = card + CARD_GAP
  return (
    <View
      onLayout={(e) => {
        const next = e.nativeEvent.layout.width
        setWidth((prev) => (prev === next ? prev : next))
      }}
    >
      {width > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          decelerationRate="fast"
          disableIntervalMomentum
          // Şerit kaydırılırken sayfa ne çevrilir ne aşağı yukarı kayar
          disallowInterruption
          nestedScrollEnabled
          contentContainerStyle={styles.carousel}
          scrollEventThrottle={32}
          onScroll={(e) => {
            const next = Math.min(
              images.length - 1,
              Math.max(0, Math.round(e.nativeEvent.contentOffset.x / step)),
            )
            setIndex((prev) => (prev === next ? prev : next))
          }}
        >
          {images.map((image, i) => (
            <CarouselCard
              key={`${i}-${image.href}`}
              image={image}
              width={card}
              palette={palette}
              label={`${i + 1}. görsel, ${images.length} görselden`}
            />
          ))}
        </ScrollView>
      )}
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {images.map((image, i) => (
          <View
            key={`${i}-${image.href}`}
            style={[styles.dot, { backgroundColor: i === index ? palette.ink : palette.rule }]}
          />
        ))}
      </View>
    </View>
  )
}

function CarouselCard({ image, width, palette, label }) {
  const [failed, setFailed] = useState(false)
  const shown = /^https:\/\//i.test(image.href) && !failed
  const alt = decode(image.text)
  return (
    <View style={{ width }}>
      <View
        style={[styles.card, { height: Math.round(width * 0.66), backgroundColor: palette.inlineCodeBg }]}
      >
        {shown ? (
          <Image
            source={{ uri: image.href }}
            accessibilityLabel={alt ? `${alt} (${label})` : label}
            resizeMode="cover"
            onError={() => setFailed(true)}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <Text style={[styles.cardMissing, { color: palette.muted }]} numberOfLines={3}>
            {alt || 'Görsel açılamadı'}
          </Text>
        )}
      </View>
      {alt !== '' && (
        <Text style={[styles.cardCaption, { color: palette.muted }]} numberOfLines={1}>
          {alt}
        </Text>
      )}
    </View>
  )
}

export function MarkdownView({
  value,
  theme = 'light',
  onToggleTask,
  highlights = NO_MARKS,
  inks = NO_MARKS,
  parsed: given,
  editor,
}) {
  const own = useMemo(() => (given ? null : parseMarkdown(value)), [given, value])
  const parsed = given ?? own
  const { tokens, offsets, unitOf } = parsed
  const taskIndex = useMemo(() => indexTasks(tokens), [tokens])
  const ctx = {
    palette: theme === 'dark' ? docPageDark : docPage,
    onToggleTask,
    taskIndex,
    offsets,
    highlights,
    inks,
    source: value,
    unitOf,
    editor,
  }
  return <View style={styles.root}>{renderBlocks(tokens, ctx)}</View>
}

const styles = StyleSheet.create({
  root: {
    gap: 10,
  },
  paragraph: {
    fontFamily: fonts.docBody,
    fontSize: SIZE,
    lineHeight: docPage.lineHeight,
  },
  heading: {
    letterSpacing: -0.2,
  },
  codespan: {
    fontFamily: fonts.mono,
    fontSize: SIZE * 0.88,
  },
  code: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  codeLabel: {
    position: 'absolute',
    top: 6,
    right: 10,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  codeText: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 19,
  },
  codeTextLabeled: {
    marginTop: 10,
  },
  quote: {
    gap: 8,
    borderLeftWidth: 3,
    paddingLeft: 12,
  },
  list: {
    gap: 3,
  },
  listLoose: {
    gap: 8,
  },
  item: {
    flexDirection: 'row',
  },
  markerCell: {
    width: 20,
    alignItems: 'flex-start',
  },
  markerWide: {
    width: 26,
  },
  marker: {
    fontFamily: fonts.docBody,
    fontSize: SIZE,
    lineHeight: docPage.lineHeight,
  },
  taskBox: {
    marginTop: (docPage.lineHeight - 16) / 2,
  },
  itemBody: {
    flex: 1,
    gap: 4,
  },
  hr: {
    height: 2,
    marginVertical: 6,
  },
  rawHtml: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  tableScroll: {
    flexGrow: 0,
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cellText: {
    fontFamily: fonts.docBody,
    fontSize: SIZE * 0.92,
    lineHeight: 20,
  },
  image: {
    width: '100%',
    borderRadius: 4,
  },
  carousel: {
    gap: CARD_GAP,
  },
  card: {
    overflow: 'hidden',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMissing: {
    paddingHorizontal: 16,
    fontFamily: fonts.docBody,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  cardCaption: {
    marginTop: 6,
    fontFamily: fonts.docBody,
    fontSize: 12,
    lineHeight: 16,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
})
