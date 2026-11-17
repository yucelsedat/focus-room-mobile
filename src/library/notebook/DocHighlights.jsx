import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { HighlightStroke } from './HighlightStroke'

import { highlighterOf } from '../theme'

// PDF'te fosforlu kalemin boyası: defterdeki gibi uçları yatık, elle çekilmiş şeritler yazının
// arkasında durur. Yazının satırları ve her boyanın başına ve sonuna kadarki yazının bittiği yer
// görünmez kopyalardan ölçülür; satırların boyu farklı olabilir (başlık, liste, tablo).
// Kendisini saran görünümün sol üst köşesine, yazının tam arkasına oturur.
export function DocHighlights({ highlights, content, upTo, textStyle }) {
  const [lines, setLines] = useState([])
  const [ends, setEnds] = useState(() => new Map())
  const offsets = [...new Set(highlights.flatMap((h) => [h.start, h.end]))]

  function measure(offset, e) {
    const all = e.nativeEvent.lines
    const last = all[all.length - 1]
    if (!last) return
    const end = { x: last.x + last.width, line: all.length - 1 }
    setEnds((prev) => {
      const old = prev.get(offset)
      if (old && old.x === end.x && old.line === end.line) return prev
      return new Map(prev).set(offset, end)
    })
  }

  // Satıra sığmayan boya alttaki satırlarda sürer: ilk satırda başından, son satırda sonuna kadar
  const strokes = []
  for (const h of highlights) {
    const from = ends.get(h.start)
    const to = ends.get(h.end)
    if (!from || !to) continue
    for (let line = from.line; line <= to.line; line++) {
      const row = lines[line]
      if (!row) continue
      const left = line === from.line ? from.x : row.x
      const right = line === to.line ? to.x : row.x + row.width
      if (right - left < 4) continue
      strokes.push({ key: `${h.start}-${line}`, left, right, row, color: h.color })
    }
  }

  return (
    <View pointerEvents="none" style={styles.layer}>
      {strokes.map((stroke) => (
        <HighlightStroke
          key={stroke.key}
          width={stroke.right - stroke.left + 6}
          // Defterdeki oranla: satırın üstünden %24 aşağıda başlar, satırın %70'i boyunca
          height={Math.round(stroke.row.height * 0.7)}
          color={highlighterOf(stroke.color).color}
          strength={0.4}
          // Aynı yerdeki şerit her çizimde aynı kalır
          seed={Math.round(stroke.left) * 7 + Math.round(stroke.row.y) + 1}
          style={{
            left: stroke.left - 3,
            top: stroke.row.y + stroke.row.height * 0.24,
          }}
        />
      ))}
      <Text
        style={[textStyle, styles.mirror]}
        onTextLayout={(e) =>
          setLines(e.nativeEvent.lines.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height })))
        }
      >
        {content}
      </Text>
      {offsets.map((offset) => (
        <Text key={offset} style={[textStyle, styles.mirror]} onTextLayout={(e) => measure(offset, e)}>
          {upTo(offset)}
          {'​'}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
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
})
