import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fonts, type, space, radius } from '../theme'

// Oda satırı: ad + isteğe bağlı açıklama; current → yeşil işaret (web canvas oda linki gibi)
export function RoomRow({ name, hint, current, onPress, tone = colors.accent }) {
  return (
    <Pressable
      onPress={current ? undefined : onPress}
      style={({ pressed }) => [styles.row, pressed && !current && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!current }}
    >
      <View style={[styles.dot, { backgroundColor: current ? colors.link : tone }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, current && { color: colors.link }]} numberOfLines={1}>{name}</Text>
        {!!hint && <Text style={styles.hint} numberOfLines={1}>{hint}</Text>}
      </View>
      {!current && <Text style={styles.chev}>›</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceHi, marginBottom: space.sm,
    minHeight: 52,
  },
  pressed: { backgroundColor: colors.line },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontFamily: fonts.strong, fontSize: type.body, color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, marginTop: 2 },
  chev: { fontFamily: fonts.bodyThin, fontSize: 26, color: colors.faint, marginTop: -2 },
})
