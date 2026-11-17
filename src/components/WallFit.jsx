// Duvar önizlemesi: seçilen görselin duvarda kaplayacağı tile'lar.
// Panel, dokunulan tile'ın sol-alt köşesinden sağa ve yukarı büyür (web
// MediaOverlay yerleşimi: içerik ((w-1)/2, (h-1)/2) kaydırılır).
import { Image, StyleSheet, Text, View } from 'react-native'
import { useSheetLayout } from './Sheet'
import { colors, fonts, type, space, radius } from '../theme'

const WALL_ROWS = 6
const WALL_TINT = '#b0623f' // duvar.jpg fayans tonu

export function WallFit({ row = 0, width, height, uri, color }) {
  const { contentWidth: avail } = useSheetLayout()
  const cols = Math.max(8, Math.ceil(width) + 2)
  const rows = Math.max(WALL_ROWS, Math.ceil(row + height))
  const cell = Math.min(avail / cols, 190 / rows)
  const W = cols * cell
  const H = rows * cell
  const wallTop = H - WALL_ROWS * cell
  const overflow = Math.max(0, row + height - WALL_ROWS)

  return (
    <View>
      <View style={[styles.box, { width: W, height: H }]}>
        {/* duvar gövdesi (satır 0–5) */}
        <View style={[styles.wall, { top: wallTop, height: WALL_ROWS * cell }]} />
        {Array.from({ length: cols + 1 }, (_, i) => (
          <View key={`v${i}`} style={[styles.lineV, { left: i * cell, top: wallTop, height: WALL_ROWS * cell }]} />
        ))}
        {Array.from({ length: WALL_ROWS + 1 }, (_, i) => (
          <View key={`h${i}`} style={[styles.lineH, { top: wallTop + i * cell, width: W }]} />
        ))}
        {/* görselin kaplayacağı alan */}
        <View style={[styles.frame, { left: cell, bottom: row * cell, width: width * cell, height: height * cell }]}>
          {uri ? (
            <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
          ) : color ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.empty]} />
          )}
        </View>
        {/* dokunulan tile (panelin sol-alt köşesi) */}
        <View style={[styles.anchor, { left: cell, bottom: row * cell, width: cell, height: cell }]}>
          <View style={styles.anchorDot} />
        </View>
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          <Text style={styles.legendStrong}>{width} × {height}</Text> tile · satır {row + 1}/{WALL_ROWS}
        </Text>
        {overflow > 0 && (
          <Text style={styles.warn}>duvarın üstünü {Number(overflow.toFixed(2))} tile aşıyor</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { alignSelf: 'center', overflow: 'hidden', borderRadius: radius.sm },
  wall: { position: 'absolute', left: 0, right: 0, backgroundColor: WALL_TINT, opacity: 0.32 },
  lineV: { position: 'absolute', width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.18)' },
  lineH: { position: 'absolute', left: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.18)' },
  frame: {
    position: 'absolute', borderWidth: 1.5, borderColor: colors.accent, overflow: 'hidden',
    backgroundColor: 'rgba(0,242,255,0.08)',
  },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(0,242,255,0.5)' },
  anchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  anchorDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, borderWidth: 1.5, borderColor: colors.bg },
  legend: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: space.sm, gap: space.sm },
  legendText: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted },
  legendStrong: { fontFamily: fonts.strong, color: colors.text },
  warn: { fontFamily: fonts.body, fontSize: type.caption, color: '#fbbf24' },
})
