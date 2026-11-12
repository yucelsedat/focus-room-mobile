// Ekranın tam ortasındaki + işareti (web Crosshair ile aynı: yarı saydam beyaz,
// camgöbeği hale). Yazı yerine iki çizgi: fonttan bağımsız, piksel net ortalanır.
// Duvar tile'ı hover'dayken altında "dokun · ekle" ipucu belirir.
import { StyleSheet, Text, View } from 'react-native'
import { useStore } from '../store/useStore'
import { colors, fonts, type } from '../theme'

const SIZE = 18
const THICK = 2

export function Crosshair() {
  const onWall = useStore((s) => !!s.hoveredTile && s.hoveredTile.kind !== 'floor')
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.bar, styles.h, onWall && styles.active]} />
      <View style={[styles.bar, styles.v, onWall && styles.active]} />
      {onWall && <Text style={styles.hint}>dokun · ekle</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: SIZE,
    height: SIZE,
    marginLeft: -SIZE / 2,
    marginTop: -SIZE / 2,
    alignItems: 'center',
  },
  bar: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 1,
    shadowColor: '#00f2ff',
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  active: { backgroundColor: colors.accent },
  h: { left: 0, top: (SIZE - THICK) / 2, width: SIZE, height: THICK },
  v: { top: 0, left: (SIZE - THICK) / 2, width: THICK, height: SIZE },
  hint: {
    position: 'absolute',
    top: SIZE + 8,
    width: 120,
    textAlign: 'center',
    fontFamily: fonts.strong,
    fontSize: type.micro,
    letterSpacing: 1.2,
    color: colors.accent,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
  },
})
