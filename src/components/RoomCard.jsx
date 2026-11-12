// Oda menüsü kartı: ad + açıklama; Gir · Keşfet (alt odası varsa) · ayarlar (dişli)
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon } from './Icon'
import { colors, fonts, type, space, radius } from '../theme'

export function RoomCard({ name, hint, tone = colors.accent, current, childCount = 0, onEnter, onExplore, onSettings }) {
  return (
    <View style={[styles.card, current && styles.cardHere]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: current ? colors.link : tone }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, current && { color: colors.link }]} numberOfLines={1}>{name}</Text>
          {!!(current || hint) && <Text style={styles.hint} numberOfLines={1}>{current ? 'Şu an buradasın' : hint}</Text>}
        </View>
        {onSettings && (
          <Pressable onPress={onSettings} hitSlop={10} style={({ pressed }) => [styles.gear, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${name} ayarları`}>
            <Icon name="settings" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {(!current || childCount > 0) && (
        <View style={styles.actions}>
          {!current && (
            <Pressable onPress={onEnter} style={({ pressed }) => [styles.btn, styles.enter, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`${name} odasına gir`}>
              <Text style={styles.enterText}>Gir</Text>
            </Pressable>
          )}
          {childCount > 0 && onExplore && (
            <Pressable onPress={onExplore} style={({ pressed }) => [styles.btn, styles.explore, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${name} alt odalarını keşfet`}>
              <Text style={styles.exploreText}>Keşfet</Text>
              <Text style={styles.count}>{childCount}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, backgroundColor: colors.surfaceHi, marginBottom: space.sm, padding: space.md, gap: space.md },
  cardHere: { borderWidth: 1, borderColor: 'rgba(16,185,129,0.45)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontFamily: fonts.strong, fontSize: type.body, color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, marginTop: 2 },
  gear: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.line },
  actions: { flexDirection: 'row', gap: space.sm, paddingLeft: 8 + space.md },
  btn: { height: 34, borderRadius: radius.pill, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  enter: { backgroundColor: colors.accent },
  enterText: { fontFamily: fonts.strong, fontSize: type.caption + 1, color: colors.accentInk },
  explore: { borderWidth: 1, borderColor: colors.line },
  exploreText: { fontFamily: fonts.strong, fontSize: type.caption + 1, color: colors.text },
  count: { fontFamily: fonts.mono, fontSize: type.micro, color: colors.muted },
})
