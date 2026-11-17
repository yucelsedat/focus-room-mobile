import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { findNodeHandle, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { MarkdownView } from '../components/MarkdownView'
import { DocHighlights } from './DocHighlights'
import { useDocumentMode } from './DocumentMode'

import { padForInsertion } from '../lib/richText/htmlToMarkdown'
import { markdownEnter, pastedChunk, toggleTask } from '../lib/richText/markdownEdit'
import { BLANK_BLOCK, parseMarkdown, unitAt, unitPrefix } from '../lib/richText/markdownUnits'
import { missingLinksNotice, richReplacementFor } from '../lib/richText/usePasteRichText'
import { docPage, fonts, highlightFill, inkOf } from '../theme'

import { enableImagePaste } from '../../../modules/note-paste'

// PDF sayfasındaki bir yazı bölümü. Yazı Markdown'dır. İki türlü yazılır (sayfa ayarlarındaki
// "Markdown'ı düzenle"):
//  - biçimli (varsayılan): yazı hep biçimli görünür; başlığa, paragrafa ya da maddeye dokununca
//    o parça yerinde yazılır (bkz. LiveDocText). Görsellere, tablolara dokunmak yazmayı açmaz.
//  - ham Markdown: yazıya dokununca bölümün bütün Markdown'ı ham hâliyle açılır (bkz. RawDocText).
export function DocTextSegment(props) {
  const mode = useDocumentMode()
  return mode?.rawMarkdown ? <RawDocText {...props} /> : <LiveDocText {...props} />
}

// Ham Markdown düzenleme: odaktayken ham hâliyle yazılır, odaktan çıkınca biçimli görünür;
// biçimli yazıya dokununca yeniden yazma açılır. Yazı alanı yalnızca yazarken kuruludur; sayfanın
// verdiği odak ve imleç istekleri (focus / setSelection) yazı alanı kurulana kadar bekletilir.
function RawDocText({
  ref,
  value,
  readOnly = false,
  placeholder,
  onChangeText,
  onSelectionChange,
  onSelect,
  onFocus,
  onBlur,
  highlights = NO_MARKS,
  inks = NO_MARKS,
  highlighter = null,
  onEnter,
  onBackspaceAtStart,
  indent,
  push = 0,
  collapsed = false,
  onLayout,
}) {
  const mode = useDocumentMode()
  const inputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  // Yazı alanı kurulunca verilecek odak ve imleç
  const pending = useRef(null)
  const wantsFocus = useRef(false)
  const selection = useRef({ start: 0, end: 0 })
  // Değişikliği bekleyen işler (Enter'dan sonra imleç, yapıştırılan parçanın yerine Markdown) en son
  // yazıyı görsün
  const latest = useRef(value)
  const pendingCursor = useRef(null)
  // Enter'dan sonra bazı Android klavyeleri aynı satır sonunu bir de yazı olarak gönderir; o ikinci
  // satır sonu yok sayılır, yoksa boş satırda Enter sayılıp bloğu bölerdi
  const lastEnterAt = useRef(0)
  const [contentHeight, setContentHeight] = useState(null)
  // Boş blok ve okurken hiç yazı alanı olmayan blok yazma alanıyla durur
  const showInput = !readOnly && (editing || value === '')
  // Başka renk yazı yazı alanına parça parça verilir (parçalar value ile birlikte verilemez)
  const marked = inks.length > 0

  useEffect(() => {
    latest.current = value
    if (pendingCursor.current && inputRef.current) {
      const { start, end } = pendingCursor.current
      inputRef.current.setSelection(start, end)
      pendingCursor.current = null
    }
  }, [value])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (inputRef.current) inputRef.current.focus()
        else {
          wantsFocus.current = true
          setEditing(true)
        }
      },
      blur: () => inputRef.current?.blur(),
      isFocused: () => inputRef.current?.isFocused() ?? false,
      setSelection: (start, end) => {
        if (inputRef.current) inputRef.current.setSelection(start, end)
        else pending.current = { start, end }
      },
      clear: () => inputRef.current?.clear(),
    }),
    [],
  )

  // Yazı alanı kurulunca bekleyen odak verilir; basılı tutunca çıkan "Yapıştır" panodaki resmi de
  // yapıştırabilsin
  useEffect(() => {
    if (!showInput || !inputRef.current) return
    enableImagePaste(findNodeHandle(inputRef.current))
    if (wantsFocus.current) {
      wantsFocus.current = false
      inputRef.current.focus()
      const target = pending.current ?? { start: value.length, end: value.length }
      pending.current = null
      inputRef.current.setSelection(target.start, target.end)
    }
    // Yalnızca yazı alanı kurulduğunda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInput])

  function startEditing() {
    if (readOnly) return
    wantsFocus.current = true
    setEditing(true)
  }

  // Enter: liste sürer / biter ya da satır sonu girer; boş satırda blok bölünür
  function enter(text, at) {
    lastEnterAt.current = Date.now()
    const result = markdownEnter(text, at.start, at.end)
    if (result.kind === 'split') {
      if (!onEnter) {
        onChangeText(text.slice(0, at.start) + '\n' + text.slice(at.end))
        return
      }
      onChangeText(result.head + result.tail)
      onEnter(result.head.length, '')
      return
    }
    pendingCursor.current = { start: result.edit.start, end: result.edit.end }
    onChangeText(result.edit.text)
  }

  function changeText(text) {
    const chunk = pastedChunk(value, text)
    // Satır sonunu yazı olarak gönderen klavyelerde Enter buraya düşer
    if (text.length === value.length + 1) {
      const at = firstDifference(value, text)
      if (text[at] === '\n') {
        if (Date.now() - lastEnterAt.current > ENTER_ECHO_MS) enter(value, { start: at, end: at })
        return
      }
    }
    onChangeText(text)
    // Android'de sistem "Yapıştır"ı: giren parça panodaki düz metinse ve panoda biçim varsa yerine
    // Markdown karşılığı girer
    if (chunk && Platform.OS === 'android') {
      richReplacementFor(chunk.text)
        .then((result) => {
          const current = latest.current
          if (!result || current.slice(chunk.at, chunk.at + chunk.text.length) !== chunk.text) return
          const before = current.slice(0, chunk.at)
          const after = current.slice(chunk.at + chunk.text.length)
          onChangeText(before + padForInsertion(result.text, before, after) + after)
          // Biçimli yapıştırılan yazı hemen biçimli görünsün: yazma kapanır, Markdown'ın ham hâli
          // ekranda kalmaz; dokununca yeniden düzenlenir
          inputRef.current?.blur()
          mode?.notify(
            result.missingLinks > 0
              ? missingLinksNotice(result.missingLinks)
              : 'Biçimli metin olarak yapıştırıldı',
          )
        })
        .catch(() => {})
    }
  }

  return (
    <View
      collapsable={false}
      onLayout={onLayout}
      style={[
        indent && { marginLeft: indent.left, marginRight: indent.right },
        push > 0 && { marginTop: push },
        collapsed && styles.collapsed,
      ]}
    >
      {showInput && highlights.length > 0 && (
        <DocHighlights
          highlights={highlights}
          textStyle={styles.text}
          content={value}
          upTo={(offset) => value.slice(0, offset)}
        />
      )}
      {showInput ? (
        <TextInput
          ref={inputRef}
          value={marked ? undefined : value}
          onChangeText={changeText}
          style={[
            styles.text,
            styles.input,
            contentHeight !== null && {
              height: Math.max(docPage.lineHeight, Math.ceil(contentHeight)),
            },
          ]}
          onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
          onSelectionChange={(e) => {
            const next = e.nativeEvent.selection
            selection.current = next
            onSelectionChange(next.end)
            onSelect?.(Math.min(next.start, next.end), Math.max(next.start, next.end))
          }}
          onFocus={() => {
            setEditing(true)
            onFocus()
          }}
          onBlur={() => {
            setEditing(false)
            onBlur()
          }}
          onKeyPress={(e) => {
            const { start, end } = selection.current
            if (e.nativeEvent.key === 'Backspace' && start === 0 && end === 0) onBackspaceAtStart?.()
          }}
          multiline
          scrollEnabled={false}
          // Enter yazıya kendiliğinden satır sonu koymaz; listeyi sürdürmek ya da bloğu bölmek burada
          submitBehavior="submit"
          onSubmitEditing={() => enter(value, selection.current)}
          placeholder={placeholder}
          placeholderTextColor={docPage.faint}
          // Fosforlu kalem açıkken seçim kalemin renginde: yazının üstünden kalem geçiyormuş gibi
          selectionColor={highlighter ? highlightFill(highlighter) : 'rgba(11, 92, 173, 0.25)'}
          cursorColor={docPage.ink}
          autoCorrect
          textAlignVertical="top"
        >
          {marked ? markedSpans(value, inks) : undefined}
        </TextInput>
      ) : (
        <Pressable
          onPress={startEditing}
          disabled={readOnly}
          accessibilityRole={readOnly ? undefined : 'button'}
          accessibilityHint={readOnly ? undefined : 'Dokununca yazı düzenlenir'}
          style={styles.rendered}
        >
          <MarkdownView
            value={value}
            highlights={highlights}
            inks={inks}
            onToggleTask={readOnly ? undefined : (index) => onChangeText(toggleTask(value, index))}
          />
        </Pressable>
      )}
    </View>
  )
}

// Biçimli yazma: yazı hep biçimli görünür. Başlık, paragraf ya da madde ("birim", bkz.
// lib/richText/markdownUnits) dokununca yerinde yazı alanı olur; alan birimin ham yazısını taşır,
// satır içi işaretleri soluk görünür. Yazılan her harf bölümün bütün yazısına işlenir; yazı yeniden
// ayrışınca birim değişmişse (ör. başına "# " yazılıp başlık olunca) imleç yeni birime geçer.
// Sayfanın odak ve imleç istekleri (focus / setSelection) bölümün bütün yazısındaki konumlarla
// gelir, birime çevrilir.
function LiveDocText({
  ref,
  value,
  readOnly = false,
  placeholder,
  onChangeText,
  onSelectionChange,
  onSelect,
  onFocus,
  onBlur,
  highlights = NO_MARKS,
  inks = NO_MARKS,
  highlighter = null,
  onEnter,
  onBackspaceAtStart,
  indent,
  push = 0,
  collapsed = false,
  onLayout,
}) {
  const mode = useDocumentMode()
  const parsed = parseMarkdown(value)
  const [active, setActive] = useState(null)
  const [request, setRequest] = useState(null)
  const seq = useRef(0)
  // O an yazılan birimin yazı alanı
  const inputRef = useRef(null)
  // En son yazı ve yazılan birimin bu yazıdaki aralığı: harfler yeniden çizimden önce art arda
  // gelse de her biri bir öncekinin üstüne işlenir
  const latest = useRef(value)
  const live = useRef(null)
  const selection = useRef({ start: 0, end: 0 })
  // Değişiklikten sonra imlecin olacağı yer (bütün yazıda) ve yazı alanının o an taşıdığı yazı
  const pendingAt = useRef(null)
  const nativeText = useRef(null)
  const lastEnterAt = useRef(0)

  // Yazı değişti: imleç, yeni ayrışmada içinde kaldığı birime geçer. Yazı alanı zaten doğru yazıyı
  // taşıyorsa (harf yazıldı, birim değişmedi) dokunulmaz; klavyenin yazmakta olduğu kelime bozulmaz.
  useEffect(() => {
    latest.current = value
    const at = pendingAt.current
    pendingAt.current = null
    if (active === null) {
      live.current = null
      return
    }
    if (at === null) {
      const unit = parsed.units[active]
      live.current = unit ? { start: unit.start, end: unit.end } : null
      return
    }
    const unit = unitAt(parsed.units, at, active)
    if (!unit) {
      // Yazılan yer artık yazı birimi değil (ör. görsele dönüştü): yazma biter
      inputRef.current?.blur()
      inputRef.current = null
      live.current = null
      setActive(null)
      onBlur()
      return
    }
    live.current = { start: unit.start, end: unit.end }
    if (unit.index === active && value.slice(unit.start, unit.end) === nativeText.current) return
    seq.current += 1
    setRequest({ index: unit.index, start: at - unit.start, end: at - unit.start, seq: seq.current })
    if (unit.index !== active) setActive(unit.index)
    // Yalnızca yazı değişince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Verilen yere (bütün yazıda) odaklan: içinde olduğu birim, yoksa ondan önceki son birim
  function focusAt(start, end = start) {
    const units = parsed.units
    const unit = unitAt(units, start, active) ?? units.filter((u) => u.start <= start).pop() ?? units[0]
    if (!unit) return
    const from = Math.min(Math.max(start, unit.start), unit.end)
    const to = Math.min(Math.max(end, from), unit.end)
    seq.current += 1
    setRequest({ index: unit.index, start: from - unit.start, end: to - unit.start, seq: seq.current })
    live.current = { start: unit.start, end: unit.end }
    setActive(unit.index)
  }

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (inputRef.current) inputRef.current.focus()
      else focusAt(latest.current.length)
    },
    blur: () => inputRef.current?.blur(),
    isFocused: () => inputRef.current?.isFocused() ?? false,
    setSelection: (start, end) => focusAt(start, end),
    clear: () => {},
  }))

  // Bütün yazı değişti (harf, Enter, yapıştırma); Android'de sistem "Yapıştır"ı panoda biçim
  // varsa Markdown karşılığıyla değiştirilir (bkz. RawDocText)
  function commit(text) {
    latest.current = text
    onChangeText(text)
  }

  function changeUnit(text) {
    const range = live.current
    if (!range) return
    const base = latest.current
    const old = base.slice(range.start, range.end)
    const full = base.slice(0, range.start) + text + base.slice(range.end)
    // Satır sonunu yazı olarak gönderen klavyelerde Enter buraya düşer
    if (text.length === old.length + 1) {
      const at = firstDifference(old, text)
      if (text[at] === '\n') {
        if (Date.now() - lastEnterAt.current > ENTER_ECHO_MS) enter(range.start + at)
        return
      }
    }
    let tail = 0
    while (
      tail < Math.min(old.length, text.length) &&
      old[old.length - 1 - tail] === text[text.length - 1 - tail]
    ) {
      tail++
    }
    pendingAt.current = range.start + text.length - tail
    nativeText.current = text
    live.current = { start: range.start, end: range.start + text.length }
    const chunk = pastedChunk(base, full)
    commit(full)
    if (chunk && Platform.OS === 'android') {
      richReplacementFor(chunk.text)
        .then((result) => {
          const current = latest.current
          if (!result || current.slice(chunk.at, chunk.at + chunk.text.length) !== chunk.text) return
          const before = current.slice(0, chunk.at)
          const after = current.slice(chunk.at + chunk.text.length)
          commit(before + padForInsertion(result.text, before, after) + after)
          inputRef.current?.blur()
          mode?.notify(
            result.missingLinks > 0
              ? missingLinksNotice(result.missingLinks)
              : 'Biçimli metin olarak yapıştırıldı',
          )
        })
        .catch(() => {})
    }
  }

  // Enter: maddede liste sürer (boş maddede liste biter, blok orada bölünür); başlıkta ve
  // paragrafta blok imlecin yerinde bölünür
  function enter(at) {
    lastEnterAt.current = Date.now()
    const base = latest.current
    const unit = unitAt(parsed.units, at, active)
    if (unit?.kind === 'item') {
      if (base.slice(unit.start, unit.end).trim() === '') {
        const lineStart = base.lastIndexOf('\n', unit.start - 1) + 1
        const newline = base.indexOf('\n', unit.start)
        const lineEnd = newline === -1 ? base.length : newline
        const head = base.slice(0, Math.max(0, lineStart - 1))
        const tail = base.slice(Math.min(base.length, lineEnd + 1))
        if (onEnter) {
          commit(head + tail)
          onEnter(head.length, '')
        } else {
          pendingAt.current = lineStart
          commit(base.slice(0, lineStart) + base.slice(lineEnd))
        }
        return
      }
      const result = markdownEnter(base, at, at)
      if (result.kind === 'edit') {
        pendingAt.current = result.edit.start
        nativeText.current = null
        commit(result.edit.text)
        return
      }
    }
    if (onEnter) {
      onEnter(at, '')
      return
    }
    pendingAt.current = at + 1
    nativeText.current = null
    commit(base.slice(0, at) + '\n' + base.slice(at))
  }

  // Birimin başında geri silme: satır önü işareti (başlık, madde, alıntı) varsa o kalkar; yoksa
  // birim bir öncekiyle birleşir (araları boş satırsa önce satır sonuna iner). Bölümün ilk birimiyse
  // blok bir üstteki blokla birleşir.
  function backspaceAtStart(unit) {
    const base = latest.current
    const prefix = unitPrefix(base, unit)
    nativeText.current = null
    if (prefix) {
      pendingAt.current = prefix.start
      commit(base.slice(0, prefix.start) + base.slice(prefix.end))
      return
    }
    const prev = parsed.units[unit.index - 1]
    if (!prev) {
      if (base.slice(0, unit.start).trim() === '') onBackspaceAtStart?.()
      return
    }
    const gap = base.slice(prev.end, unit.start)
    if (/\S/.test(gap)) {
      // Arada görsel, tablo gibi yazı olmayan bir şey var: imleç önceki birimin sonuna geçer
      focusAt(prev.end)
      return
    }
    const glue = /\n[ \t]*\n/.test(gap) ? '\n' : ''
    pendingAt.current = prev.end + glue.length
    commit(base.slice(0, prev.end) + glue + base.slice(unit.start))
  }

  function renderInput({ unit, style, wrapperStyle, spans }) {
    return (
      <UnitInput
        unit={unit}
        style={style}
        wrapperStyle={wrapperStyle}
        spans={spans}
        highlights={highlights.filter((m) => m.end > unit.start && m.start < unit.end)}
        request={request?.index === unit.index ? request : null}
        placeholder={unit.block === BLANK_BLOCK ? placeholder : undefined}
        highlighter={highlighter}
        onInput={(node) => {
          inputRef.current = node
        }}
        onChangeText={changeUnit}
        onSelect={(start, end) => {
          const base = live.current?.start ?? unit.start
          selection.current = { start: base + start, end: base + end }
          onSelectionChange(base + end)
          onSelect?.(base + Math.min(start, end), base + Math.max(start, end))
        }}
        onSubmit={() => enter(selection.current.end)}
        onBackspaceAtStart={() => backspaceAtStart(unit)}
        onFocus={onFocus}
        onBlur={(node) => {
          // Başka birime geçilirken eski alanın odak kaybı yok sayılır
          if (node !== inputRef.current) return
          inputRef.current = null
          setActive(null)
          onBlur()
        }}
      />
    )
  }

  return (
    <View
      collapsable={false}
      onLayout={onLayout}
      style={[
        indent && { marginLeft: indent.left, marginRight: indent.right },
        push > 0 && { marginTop: push },
        collapsed && styles.collapsed,
        styles.rendered,
      ]}
    >
      <MarkdownView
        value={value}
        parsed={parsed}
        highlights={highlights}
        inks={inks}
        onToggleTask={readOnly ? undefined : (index) => commit(toggleTask(value, index))}
        editor={
          readOnly
            ? undefined
            : {
                active,
                activate: (index) => {
                  const unit = parsed.units[index]
                  if (unit) focusAt(unit.end)
                },
                renderInput,
              }
        }
      />
    </View>
  )
}

// Yazılan birimin yazı alanı: birimin biçimli hâliyle aynı yazı stilinde, aynı yerde durur
function UnitInput({
  unit,
  style,
  wrapperStyle,
  spans,
  highlights,
  request,
  placeholder,
  highlighter,
  onInput,
  onChangeText,
  onSelect,
  onSubmit,
  onBackspaceAtStart,
  onFocus,
  onBlur,
}) {
  const ref = useRef(null)
  const selection = useRef({ start: 0, end: 0 })
  const [contentHeight, setContentHeight] = useState(null)

  useEffect(() => {
    const node = ref.current
    onInput(node)
    // Basılı tutunca çıkan "Yapıştır" panodaki resmi de yapıştırabilsin
    if (node) enableImagePaste(findNodeHandle(node))
    // Yalnızca kurulunca
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Odak ve imleç isteği (dokunuş, sayfanın isteği ya da birimin değişmesi)
  useEffect(() => {
    if (!request || !ref.current) return
    onInput(ref.current)
    ref.current.focus()
    ref.current.setSelection(request.start, request.end)
    // Yalnızca yeni istekte
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  return (
    <View style={wrapperStyle}>
      {highlights.length > 0 && (
        <DocHighlights
          highlights={highlights}
          textStyle={style}
          content={spans()}
          upTo={(offset) => spans(offset)}
        />
      )}
      <TextInput
        ref={ref}
        onChangeText={onChangeText}
        style={[style, styles.unitInput, contentHeight !== null && { height: Math.ceil(contentHeight) }]}
        onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
        onSelectionChange={(e) => {
          const next = e.nativeEvent.selection
          selection.current = next
          onSelect(next.start, next.end)
        }}
        onFocus={onFocus}
        onBlur={() => onBlur(ref.current)}
        onKeyPress={(e) => {
          const { start, end } = selection.current
          if (e.nativeEvent.key === 'Backspace' && start === 0 && end === 0) onBackspaceAtStart()
        }}
        multiline
        scrollEnabled={false}
        // Enter yazıya kendiliğinden satır sonu koymaz: listeyi sürdürmek ya da bloğu bölmek burada
        submitBehavior="submit"
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={docPage.faint}
        selectionColor={highlighter ? highlightFill(highlighter) : 'rgba(11, 92, 173, 0.25)'}
        cursorColor={docPage.ink}
        autoCorrect
        textAlignVertical="top"
        accessibilityHint={unit.kind === 'heading' ? 'Başlık' : undefined}
      >
        {spans()}
      </TextInput>
    </View>
  )
}

const ENTER_ECHO_MS = 250

const NO_MARKS = []

// Ham yazı, kalem renklerinin sınırlarından bölünür: başka renk kalemle yazılan yer o renkte
// yazılır. Fosforlu kalemin boyası yazının arkasında şerit olarak çizilir (bkz. DocHighlights).
function markedSpans(value, inks) {
  const cuts = new Set([0, value.length])
  for (const m of inks) {
    cuts.add(Math.min(m.start, value.length))
    cuts.add(Math.min(m.end, value.length))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const parts = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const ink = inks.find((m) => m.start <= from && m.end >= to)
    const text = value.slice(from, to)
    parts.push(
      ink ? (
        <Text key={from} style={{ color: inkOf(ink.color).color }}>
          {text}
        </Text>
      ) : (
        text
      ),
    )
  }
  return parts
}

// Biçimli görünümün üstündeki ve altındaki boşluk
export const DOC_RENDERED_PAD = 2

function firstDifference(a, b) {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return i
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fonts.docBody,
    fontSize: docPage.fontSize,
    lineHeight: docPage.lineHeight,
    color: docPage.ink,
    includeFontPadding: false,
  },
  input: {
    minHeight: docPage.lineHeight,
    padding: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  rendered: {
    minHeight: docPage.lineHeight,
    paddingVertical: DOC_RENDERED_PAD,
  },
  collapsed: {
    height: 0,
    overflow: 'hidden',
  },
  unitInput: {
    padding: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
})
