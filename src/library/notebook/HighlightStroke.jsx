import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Path } from 'react-native-svg'

// Her açılışta kalem aynı yerden geçmiş görünsün diye sabit tohumlu rastgele sayı üreteci
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// Fosforlu kalemle çekilmiş şerit: kesik keçe uç yüzünden iki ucu da yatık, kenarları hafif
// dalgalı. Kalem iki kez geçer; geçişlerin üst üste bindiği orta bant daha koyu görünür.
// Bulunduğu görünümün sol üst köşesine oturur.
export function HighlightStroke({ width, height, color, strength, seed, style }) {
  const passes = useMemo(() => {
    const rand = seeded(seed)
    const jitter = (n) => (rand() - 0.5) * n
    const f = (n) => n.toFixed(1)
    const pass = (top, bottom) => {
      const slant = (bottom - top) * 0.35
      const left = 1 + jitter(4)
      const right = width - 1 + jitter(4)
      return (
        `M${f(left + slant)} ${f(top + jitter(1.5))}` +
        ` Q${f(width / 2)} ${f(top + jitter(3))} ${f(right)} ${f(top + jitter(1.5))}` +
        ` L${f(right - slant)} ${f(bottom + jitter(1.5))}` +
        ` Q${f(width / 2)} ${f(bottom + jitter(3))} ${f(left)} ${f(bottom + jitter(1.5))} Z`
      )
    }
    return [pass(height * 0.08, height * 0.66), pass(height * 0.34, height * 0.92)]
  }, [width, height, seed])

  return (
    <Svg width={width} height={height} style={[styles.stroke, style]} pointerEvents="none">
      {passes.map((d) => (
        <Path key={d} d={d} fill={color} fillOpacity={strength} />
      ))}
    </Svg>
  )
}

const styles = StyleSheet.create({
  stroke: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
})
