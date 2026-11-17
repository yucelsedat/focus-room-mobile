import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { findNodeHandle, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { DocTextSegment } from './DocTextSegment'
import { useDocumentMode } from './DocumentMode'
import { DragHandle, DropLine, useDraggedStyle, useReorder } from './DragReorder'
import { HIGHLIGHT_COLOR, HIGHLIGHT_SOLID, HighlighterHandle } from './HighlighterHandle'
import { HandCheckbox } from './HandCheckbox'
import { HighlightStroke } from './HighlightStroke'

import Animated from 'react-native-reanimated'

import { BOX, BOX_DONE, boxOffsets, continueList, enterAction, toggleBox } from '../lib/noteLists'
import { fonts, HAND_TAIL, handTailWidth, highlightFill, highlighterOf, inkOf, notebook } from '../theme'

import { enableImagePaste } from '../../../modules/note-paste'

// Android'de gerçek tutamaçlar görünmez yapılıp üstlerine fosforlu kalem çizilir.
// iOS tutamaçların şeklini değiştirmeye izin vermez; orada yalnızca rengi yeşil olur.
const CUSTOM_HANDLES = Platform.OS === 'android'

// Fosforlu kalemin satırdaki şeridi: harflerin gövdesinden tabanına kadar
const STROKE_TOP = 8
const STROKE_HEIGHT = 24

// Görünmez kopyadaki son satırdan, verilen konumdaki harfin altını (satır tabanını) bulur
function caretBottom(e) {
  const lines = e.nativeEvent.lines
  const last = lines[lines.length - 1]
  if (!last) return null
  return { x: last.x + last.width, y: lines.length * notebook.lineHeight }
}

// Satır başındaki kutuların görünmez kopyadaki yerleri; satırların yazısı uç uca metni verir
function boxPoints(e, value) {
  const offsets = new Set(boxOffsets(value))
  const points = []
  let offset = 0
  e.nativeEvent.lines.forEach((line, i) => {
    if (offsets.has(offset)) points.push({ offset, x: line.x, y: i * notebook.lineHeight })
    offset += line.text.length
  })
  return points
}

// Yazının her satırının (satır sonundan satır sonuna; sığmayıp alta kayan kısmı dahil) yeri.
// Görünmez kopyanın en sondaki boş satırı ölçülmeyebilir; onun yeri son satırın altıdır.
function lineExtents(e, value) {
  const count = value.split('\n').length
  const extents = []
  let offset = 0
  e.nativeEvent.lines.forEach((line, i) => {
    const top = i * notebook.lineHeight
    if (offset === 0 || value[offset - 1] === '\n') {
      extents.push({ top, height: notebook.lineHeight })
    } else if (extents.length > 0) {
      extents[extents.length - 1].height += notebook.lineHeight
    }
    offset += line.text.length
  })
  while (extents.length < count) {
    const last = extents[extents.length - 1]
    extents.push({ top: last ? last.top + last.height : 0, height: notebook.lineHeight })
  }
  return extents.slice(0, count)
}

// Metnin o yerindeki satırın sırası
function lineIndexAt(value, offset) {
  let line = 0
  for (let i = 0; i < offset; i++) if (value[i] === '\n') line++
  return line
}

// Yazı parçalara bölünür: başka renk kalemle yazılan yerler o renkte yazılır; kutu karakterleri
// metinde kalır ama saydam yazılır, yerlerine el çizimi kutu konur
function richText(value, boxes, inks) {
  const cuts = new Set([0, value.length])
  for (const offset of boxes) {
    cuts.add(offset)
    cuts.add(offset + 1)
  }
  for (const ink of inks) {
    cuts.add(Math.min(ink.start, value.length))
    cuts.add(Math.min(ink.end, value.length))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const boxSet = new Set(boxes)
  const parts = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const box = boxSet.has(from)
    const ink = inks.find((m) => m.start <= from && m.end >= to)
    if (!box && !ink) {
      parts.push(value.slice(from, to))
      continue
    }
    parts.push(
      <Text key={from} style={[ink && { color: inkOf(ink.color).color }, box && styles.hiddenBox]}>
        {value.slice(from, to)}
      </Text>,
    )
  }
  return parts
}

// Fosforlu kalemin boyası yazının arkasına, takvimdeki gibi uçları eğik şeritler olarak çizilir.
// Yazının nerede durduğu görünmez kopyalardan ölçülür: bütün yazının satırları ve her boyanın
// başına ve sonuna kadarki yazının bittiği yer.
function HighlightLayer({ value, highlights }) {
  const [lines, setLines] = useState([])
  const [ends, setEnds] = useState(() => new Map())
  const offsets = [...new Set(highlights.flatMap((h) => [h.start, h.end]))]

  function measure(offset, e) {
    const point = caretBottom(e)
    if (!point) return
    setEnds((prev) => {
      const old = prev.get(offset)
      if (old && old.x === point.x && old.y === point.y) return prev
      return new Map(prev).set(offset, point)
    })
  }

  // Satıra sığmayan boya alttaki satırlarda sürer: ilk satırda başından, son satırda sonuna kadar
  const strokes = []
  for (const h of highlights) {
    const from = ends.get(h.start)
    const to = ends.get(h.end)
    if (!from || !to) continue
    const first = Math.round(from.y / notebook.lineHeight) - 1
    const last = Math.round(to.y / notebook.lineHeight) - 1
    for (let line = first; line <= last; line++) {
      const row = lines[line]
      if (!row) continue
      const left = line === first ? from.x : row.x
      const right = line === last ? to.x : row.x + row.width
      if (right - left < 4) continue
      strokes.push({ key: `${h.start}-${line}`, left, right, line, color: h.color })
    }
  }

  return (
    <View pointerEvents="none" style={styles.layer}>
      {strokes.map((stroke) => (
        <HighlightStroke
          key={stroke.key}
          width={stroke.right - stroke.left + 6}
          height={STROKE_HEIGHT}
          color={highlighterOf(stroke.color).color}
          strength={0.4}
          // Aynı yerdeki şerit her çizimde aynı kalır
          seed={Math.round(stroke.left) * 7 + stroke.line + 1}
          style={{
            left: stroke.left - 3,
            top: stroke.line * notebook.lineHeight + STROKE_TOP,
          }}
        />
      ))}
      <Text
        style={[styles.text, styles.mirror]}
        onTextLayout={(e) => setLines(e.nativeEvent.lines.map((l) => ({ x: l.x, width: l.width })))}
      >
        {value}
      </Text>
      {offsets.map((offset) => (
        <Text key={offset} style={[styles.text, styles.mirror]} onTextLayout={(e) => measure(offset, e)}>
          {value.slice(0, offset)}
          {'\u200B'}
        </Text>
      ))}
    </View>
  )
}

// Kutunun açısı yerine göre değişir; aynı kutu her çizimde aynı kalır
function boxTilt(offset) {
  return (((offset * 37) % 5) - 2) * 1.2
}

// Not içindeki bir yazı bölümü: defterde el yazısı, PDF'te Markdown (bkz. DocTextSegment)
export function NoteTextSegment(props) {
  const document = useDocumentMode()
  return document ? <DocTextSegment {...props} /> : <HandTextSegment {...props} />
}

function HandTextSegment({
  ref,
  value,
  readOnly = false,
  placeholder,
  onChangeText,
  onSelectionChange,
  onSelect,
  onFocus,
  onBlur,
  highlights = [],
  inks = [],
  highlighter = null,
  onMoveLine,
  onDragChange,
  times = [],
  firstInNote = false,
  onEnter,
  onBackspaceAtStart,
  indent,
  push = 0,
  collapsed = false,
  onLayout,
}) {
  const [focused, setFocused] = useState(false)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [startPoint, setStartPoint] = useState(null)
  const [endPoint, setEndPoint] = useState(null)
  const [boxes, setBoxes] = useState([])
  // Saydam kutu karakterinin genişliği; el çizimi kutu bunun ortasına oturur
  const [boxWidth, setBoxWidth] = useState(22)
  const inputRef = useRef(null)
  // Liste Enter'la sürdürülünce imleç yeni maddenin işaretinin arkasına konur
  const pendingCursor = useRef(null)
  // Enter tuşu yazıya satır sonu koymaz, bloğu böler (bkz. submitBehavior). Yine de satır sonunu
  // yazı olarak gönderen klavyelerde, yazı geri verilirken klavye (öneriler açıkken) aynı satır
  // sonunu bir daha gönderebilir; bu ikinci Enter yok sayılır, yoksa iki yeni blok açılır. Başka
  // bir değişiklikte ya da alana yeniden odaklanınca Enter yine bölmeye başlar.
  const justSplit = useRef(false)
  // Kutusundan tutulup sürüklenen satır; parmağın altında kopyası yürür
  const [dragLine, setDragLine] = useState(null)
  const [lineTops, setLineTops] = useState([])
  // Yazının yerel tarafta ölçülen gerçek yüksekliği. Yazı alanının boyu buna göre verilir:
  // Android'de scrollEnabled çalışmaz, yazı alanı ölçülen boyundan kısa kalırsa uzun yazının
  // sonu görünmez ve alan kendi içinde kayar; Enter'la bölününce silinen satır sonunun boşluğu da
  // ancak başka bir yeniden ölçümde kapanırdı
  const [contentHeight, setContentHeight] = useState(null)
  const lines = useReorder({
    onMove: (from, to) => onMoveLine?.(from, to),
    onDragChange: (index) => {
      setDragLine(index)
      onDragChange?.(index !== null)
    },
  })

  useImperativeHandle(ref, () => inputRef.current)

  // Basılı tutunca çıkan "Yapıştır" panodaki resmi de yapıştırabilsin; okuma modundan çıkınca
  // yazı alanı yeniden kurulduğu için tekrar açılır
  useEffect(() => {
    if (inputRef.current) enableImagePaste(findNodeHandle(inputRef.current))
  }, [readOnly])

  useEffect(() => {
    if (pendingCursor.current === null) return
    inputRef.current?.setSelection(pendingCursor.current, pendingCursor.current)
    pendingCursor.current = null
  }, [value])

  function changeText(text) {
    if (onEnter) {
      const action = enterAction(value, text, selection.start)
      if (action?.kind === 'split') {
        if (justSplit.current) return
        justSplit.current = true
        onEnter(action.at, action.prefix)
        return
      }
      justSplit.current = false
      if (action?.kind === 'edit') {
        pendingCursor.current = action.edit.cursor
        onChangeText(action.edit.text)
        return
      }
    }
    const edit = continueList(value, text, selection.start)
    if (!edit) {
      onChangeText(text)
      return
    }
    pendingCursor.current = edit.cursor
    onChangeText(edit.text)
  }

  const selecting = CUSTOM_HANDLES && focused && selection.start !== selection.end
  const offsets = boxOffsets(value)
  const hasBoxes = offsets.length > 0
  // Kutu ya da başka renk yazı varsa yazı parça parça verilir
  const rich = hasBoxes || inks.length > 0

  return (
    // collapsable={false}: seçim başlayınca zIndex eklendiğinde yazı alanı yeniden kurulup odağı kaybetmesin.
    // Dıştaki görünüm kenar boşluğuna kadar uzanır ki satırların saatleri dokunulabilir olsun.
    <View
      collapsable={false}
      pointerEvents="box-none"
      onLayout={onLayout}
      style={[
        styles.gutter,
        indent && {
          paddingLeft: notebook.marginX + 12 + indent.left,
          paddingRight: indent.right,
        },
        push > 0 && { marginTop: push },
        (selecting || dragLine !== null) && styles.raised,
        collapsed && styles.collapsed,
      ]}
    >
      <View collapsable={false}>
        {highlights.length > 0 && <HighlightLayer value={value} highlights={highlights} />}

        {readOnly ? (
          // Okurken yazı düz metin olarak çizilir: Android'de yazı alanı düzenlenemezken bile
          // dokunuşu üst görünümlere bırakmaz, yazının üstünden sayfa çevrilemez
          <Text style={[styles.text, styles.reading]}>{rich ? richText(value, offsets, inks) : value}</Text>
        ) : (
          <TextInput
            ref={inputRef}
            style={[
              styles.text,
              styles.input,
              contentHeight !== null && {
                height: Math.max(notebook.lineHeight, Math.ceil(contentHeight)),
              },
            ]}
            onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
            // Parça parça verilen yazı value ile birlikte verilemez
            value={rich ? undefined : value}
            onChangeText={changeText}
            onSelectionChange={(e) => {
              const next = e.nativeEvent.selection
              setSelection(next)
              onSelectionChange(next.end)
              onSelect?.(Math.min(next.start, next.end), Math.max(next.start, next.end))
            }}
            onFocus={() => {
              justSplit.current = false
              setFocused(true)
              onFocus()
            }}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Backspace' && selection.start === 0 && selection.end === 0) {
                onBackspaceAtStart?.()
              }
            }}
            onBlur={() => {
              setFocused(false)
              onBlur()
            }}
            multiline
            scrollEnabled={false}
            // Bloklar Enter'la bölünür: tuş yazıya satır sonu koymaz, bölme burada yapılır. Satır
            // sonu önce yazı alanına girip sonra silinseydi blok bir an bir satır uzayıp titrerdi.
            submitBehavior={onEnter ? 'submit' : 'newline'}
            onSubmitEditing={() => {
              const from = Math.min(selection.start, selection.end)
              const to = Math.max(selection.start, selection.end)
              changeText(value.slice(0, from) + '\n' + value.slice(to))
            }}
            placeholder={placeholder}
            placeholderTextColor="rgba(56, 56, 61, 0.3)"
            // Fosforlu kalem açıkken seçim kalemin renginde: yazının üstünden kalem geçiyormuş gibi
            selectionColor={
              highlighter ? highlightFill(highlighter) : CUSTOM_HANDLES ? HIGHLIGHT_COLOR : HIGHLIGHT_SOLID
            }
            selectionHandleColor={CUSTOM_HANDLES ? 'transparent' : undefined}
            cursorColor={notebook.graphite}
          >
            {rich ? richText(value, offsets, inks) : undefined}
          </TextInput>
        )}

        {selecting && (
          <>
            <Text style={[styles.text, styles.mirror]} onTextLayout={(e) => setStartPoint(caretBottom(e))}>
              {value.slice(0, selection.start)}
              {'\u200B'}
            </Text>
            <Text style={[styles.text, styles.mirror]} onTextLayout={(e) => setEndPoint(caretBottom(e))}>
              {value.slice(0, selection.end)}
              {'\u200B'}
            </Text>
          </>
        )}

        {hasBoxes && (
          <View pointerEvents="none" style={styles.mirror}>
            <Text
              style={styles.text}
              onTextLayout={(e) => {
                setBoxes(boxPoints(e, value))
                const extents = lineExtents(e, value)
                lines.extents.set(extents)
                setLineTops(extents.map((extent) => extent.top))
              }}
            >
              {richText(value, offsets, [])}
            </Text>
            <Text
              style={styles.text}
              onTextLayout={(e) => {
                const width = e.nativeEvent.lines[0]?.width
                if (width) setBoxWidth(width)
              }}
            >
              {BOX}
            </Text>
          </View>
        )}

        {hasBoxes && <DropLine reorder={lines} left={-6} />}

        {/* Kutuya dokununca işaretlenir; yazı alanına odaklanılmaz. Basılı tutup sürükleyince
            satır yukarı aşağı taşınır. */}
        {hasBoxes &&
          boxes.map((box) => (
            <DragHandle
              key={box.offset}
              reorder={lines}
              index={lineIndexAt(value, box.offset)}
              enabled={!readOnly && onMoveLine !== undefined}
              hitSlop={6}
              style={[styles.box, { left: box.x, top: box.y, width: boxWidth }]}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: value[box.offset] !== BOX, disabled: readOnly }}
                accessibilityLabel="Yapılacak"
                accessibilityHint={readOnly ? undefined : 'Basılı tutup sürükleyince satır taşınır'}
                disabled={readOnly}
                hitSlop={6}
                style={styles.boxPress}
                onPress={() => onChangeText(toggleBox(value, box.offset))}
              >
                <HandCheckbox checked={value[box.offset] !== BOX} tilt={boxTilt(box.offset)} />
              </Pressable>
            </DragHandle>
          ))}

        {dragLine !== null && (
          <DraggedLine
            reorder={lines}
            index={dragLine}
            top={lineTops[dragLine] ?? 0}
            text={value.split('\n')[dragLine] ?? ''}
            // Kopyanın kutusu yerindeki kutuyla aynı açıda
            tilt={boxTilt(value.split('\n').slice(0, dragLine).join('\n').length + (dragLine > 0 ? 1 : 0))}
            boxWidth={boxWidth}
          />
        )}

        {selecting && startPoint && <HighlighterHandle side="start" {...startPoint} />}
        {selecting && endPoint && <HighlighterHandle side="end" {...endPoint} />}
      </View>

      {/* Kutulu satırın saati: basılı tutup sürükleyince satır yukarı aşağı taşınır */}
      {hasBoxes &&
        boxes.map((box) => {
          const line = lineIndexAt(value, box.offset)
          const time = times.find((m) => m.start === box.offset)?.color
          if (!time || (firstInNote && line === 0)) return null
          return (
            <LineTime
              key={box.offset}
              reorder={lines}
              index={line}
              top={box.y}
              time={time}
              enabled={!readOnly && onMoveLine !== undefined}
            />
          )
        })}
    </View>
  )
}

// Kenar boşluğundaki saat (bloğun ve kutulu satırların saati); saat yoksa kısa bir çizgi
export function MarginTime({ time }) {
  return (
    <Text
      style={[styles.time, time === null && styles.dash]}
      accessibilityLabel={time === null ? 'Blok' : `Saat ${time}`}
    >
      {(time ?? '—') + HAND_TAIL}
    </Text>
  )
}

function LineTime({ reorder, index, top, time, enabled }) {
  const draggedStyle = useDraggedStyle(reorder, index)
  return (
    <DragHandle
      reorder={reorder}
      index={index}
      enabled={enabled}
      hitSlop={8}
      style={[styles.timeHandle, { top }, draggedStyle]}
    >
      <MarginTime time={time} />
    </DragHandle>
  )
}

// Sürüklenen satırın kâğıttan kaldırılmış kopyası: kutusu ve yazısı parmakla birlikte yürür
function DraggedLine({ reorder, index, top, text, tilt, boxWidth }) {
  const draggedStyle = useDraggedStyle(reorder, index)
  const boxed = text[0] === BOX || text[0] === BOX_DONE
  return (
    <Animated.View pointerEvents="none" style={[styles.dragged, { top }, draggedStyle]}>
      <Text style={styles.text}>{richText(text, boxed ? [0] : [], [])}</Text>
      {boxed && (
        <View style={[styles.box, { left: 6, top: 0, width: boxWidth }]}>
          <HandCheckbox checked={text[0] !== BOX} tilt={tilt} />
        </View>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  raised: {
    zIndex: 10,
  },
  // Notun satırları kenar boşluğundan bu kadar içeride başlar (bkz. NoteEntry)
  gutter: {
    marginLeft: -(notebook.marginX + 12),
    paddingLeft: notebook.marginX + 12,
  },
  // Sağa dayalı saatin sonundaki boşluk kadar kutu geniş tutulur; rakamlar yine aynı yerde biter
  timeHandle: {
    position: 'absolute',
    left: 0,
    width: notebook.marginX - 8 + handTailWidth(15),
    zIndex: 1,
  },
  time: {
    textAlign: 'right',
    fontFamily: fonts.hand,
    fontSize: 15,
    lineHeight: notebook.lineHeight,
    color: 'rgba(56, 56, 61, 0.55)',
  },
  // Çizgi saatin rakamlarıyla aynı yerde biter, biraz daha soluk
  dash: {
    fontSize: 22,
    color: 'rgba(56, 56, 61, 0.4)',
  },
  text: {
    fontFamily: fonts.hand,
    fontSize: 25,
    lineHeight: notebook.lineHeight,
    color: notebook.graphite,
    includeFontPadding: false,
  },
  layer: {
    ...StyleSheet.absoluteFill,
  },
  mirror: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  hiddenBox: {
    color: 'transparent',
  },
  collapsed: {
    height: 0,
    overflow: 'hidden',
  },
  // Kutunun alt kenarı yazının tabanına, satır çizgisinin birkaç piksel üstüne oturur
  box: {
    position: 'absolute',
    height: notebook.lineHeight,
    alignItems: 'center',
    paddingTop: 8,
  },
  boxPress: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  dragged: {
    position: 'absolute',
    left: -6,
    right: 0,
    paddingLeft: 6,
    backgroundColor: notebook.paper,
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  input: {
    minHeight: notebook.lineHeight,
    padding: 0,
    paddingTop: 0,
    paddingBottom: 0,
    opacity: 0.92,
    textAlignVertical: 'top',
  },
  // Yazı alanının görünümü; el yazısına opacity verilmez (bkz. theme HAND_TAIL), saydamlık renkte
  reading: {
    minHeight: notebook.lineHeight,
    color: 'rgba(56, 56, 61, 0.92)',
  },
})
