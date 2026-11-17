import { StyleSheet } from 'react-native'
import Svg, { G, Path, Rect } from 'react-native-svg'

export const HIGHLIGHT_COLOR = 'rgba(57, 255, 20, 0.38)'
export const HIGHLIGHT_SOLID = '#2BE04A'

const WIDTH = 14
const HEIGHT = 20

// Kalem ucu (0,0) noktasında, gövde aşağı doğru. Başlangıç tutamacında gövde sola,
// bitiş tutamacında sağa yatar; uç her zaman seçimin kenarına değer (Android tutamaçları gibi).
const VIEW = {
  start: { box: '-18 -1 22 31', tipX: (18 / 22) * WIDTH, rotate: 25 },
  end: { box: '-4 -1 22 31', tipX: (4 / 22) * WIDTH, rotate: -25 },
}
const TIP_Y = (1 / 31) * HEIGHT

// Seçimin iki ucunda duran küçük fosforlu kalem; dokunuşları alttaki gerçek tutamaca bırakır
export function HighlighterHandle({ side, x, y }) {
  const view = VIEW[side]
  return (
    <Svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={view.box}
      pointerEvents="none"
      style={[styles.handle, { left: x - view.tipX, top: y - TIP_Y }]}
    >
      <G transform={`rotate(${view.rotate})`} stroke="#137A2A" strokeWidth={0.6}>
        {/* Kesik keçe uç */}
        <Path d="M-2.6 0 L2.6 -1.4 L3 4 L-3 4 Z" fill="#7DFF8F" />
        <Rect x={-4} y={4} width={8} height={3} fill="#178A30" />
        <Rect x={-5} y={7} width={10} height={17} rx={2} fill="#4CFF3A" />
        <Rect x={-3.2} y={9} width={1.6} height={13} rx={0.8} fill="#FFFFFF" opacity={0.5} stroke="none" />
        <Rect x={-5} y={24} width={10} height={6} rx={2} fill="#1E9E3A" />
      </G>
    </Svg>
  )
}

const styles = StyleSheet.create({
  handle: {
    position: 'absolute',
    zIndex: 5,
  },
})
