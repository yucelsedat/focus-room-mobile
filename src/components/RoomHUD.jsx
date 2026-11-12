// Oda içi arayüz (dikey): üstte oda adı + geri + odalar; sağda uçma düğmeleri.
// Ortadaki alan dokunmatik katmana (bakış) bırakılır, joystick alt-solda belirir.
import { useRef } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore } from '../store/useStore'
import { input } from '../controls/input'
import { clipLabel } from '../api/tileClipboard'
import { colors, fonts, type, space, radius } from '../theme'

function HoldButton({ label, a11y, onDown, onUp, onDoubleTap }) {
  const last = useRef(0)
  return (
    <Pressable
      onPressIn={() => {
        const now = Date.now()
        if (onDoubleTap && now - last.current < 300) onDoubleTap()
        last.current = now
        onDown()
      }}
      onPressOut={onUp}
      style={({ pressed }) => [styles.fly, pressed && styles.flyPressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
    >
      <Text style={styles.flyText}>{label}</Text>
    </Pressable>
  )
}

export function RoomHUD({ onBack }) {
  const insets = useSafeAreaInsets()
  const name = useStore((s) => s.currentRoomName)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const setRoomSheet = useStore((s) => s.setRoomSheet)
  const clip = useStore((s) => s.tileClipboard)
  const setClip = useStore((s) => s.setTileClipboard)
  const childCount = useStore((s) => s.rooms.find((r) => r.id === s.currentRoomId)?.children?.length ?? 0)

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <Pressable onPress={onBack} style={styles.chip} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dünyalara dön">
          <Text style={styles.chipText}>‹</Text>
        </Pressable>
        <Pressable style={styles.titleWrap} onPress={() => setRoomSheet(true)} accessibilityRole="button" accessibilityLabel="Odalar">
          <Text style={styles.eyebrow}>{loading ? 'Yükleniyor' : 'Oda'}</Text>
          <Text style={styles.title} numberOfLines={1}>{name || '—'}</Text>
        </Pressable>
        <Pressable onPress={() => setRoomSheet(true)} style={[styles.chip, styles.roomsChip]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Oda gezinme">
          <Text style={styles.roomsText}>Odalar{childCount ? ` · ${childCount}` : ''}</Text>
        </Pressable>
      </View>

      {/* Pano: kesilen / kopyalanan tile öğesi bir tile'a dokununca yapıştırılır */}
      {clip && (
        <View style={[styles.clip, clip.mode === 'cut' && styles.clipCut, { top: insets.top + space.sm + 52 }]}>
          <Text style={styles.clipText} numberOfLines={1}>
            <Text style={styles.clipStrong}>{clipLabel(clip)}</Text>
            {clip.mode === 'cut' ? ' kesildi' : ' kopyalandı'} · yapıştırmak için + ile bir tile&apos;a dokun
          </Text>
          <Pressable onPress={() => setClip(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Panoyu boşalt">
            <Text style={styles.clipClose}>✕</Text>
          </Pressable>
        </View>
      )}

      {!!error && (
        <View style={styles.error} pointerEvents="none">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {loading && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      <View style={[styles.flyCol, { bottom: insets.bottom + 110 }]} pointerEvents="box-none">
        <HoldButton label="▲" a11y="Yüksel" onDown={() => { input.flyUp = true }} onUp={() => { input.flyUp = false }} />
        <HoldButton
          label="▼"
          a11y="Alçal (çift dokun: zemine in)"
          onDown={() => { input.flyDown = true }}
          onUp={() => { input.flyDown = false }}
          onDoubleTap={() => { input.fastFall = true }}
        />
      </View>

      <Text style={[styles.hint, { bottom: insets.bottom + space.md }]} pointerEvents="none">
        sol altta sürükle: yürü · ekranı kaydır: bak · panele dokun: aç · zemine çift dokun: ışınlan
      </Text>
    </View>
  )
}

const glass = { backgroundColor: 'rgba(12,12,15,0.62)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' }

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  chip: { ...glass, height: 44, minWidth: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.text, fontSize: 28, fontFamily: fonts.bodyThin, marginTop: -4 },
  titleWrap: { ...glass, flex: 1, height: 44, borderRadius: radius.pill, paddingHorizontal: space.lg, justifyContent: 'center' },
  eyebrow: { fontFamily: fonts.strong, fontSize: 9, letterSpacing: 1.6, color: colors.accent, textTransform: 'uppercase' },
  title: { fontFamily: fonts.display, fontSize: type.heading - 2, color: colors.text, marginTop: -1 },
  roomsChip: { paddingHorizontal: space.lg },
  roomsText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text },
  flyCol: { position: 'absolute', right: space.md, gap: space.md },
  fly: { ...glass, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  flyPressed: { backgroundColor: 'rgba(0,242,255,0.22)', borderColor: colors.accent },
  flyText: { color: colors.text, fontSize: 18 },
  hint: {
    position: 'absolute', left: space.lg, right: space.lg, textAlign: 'center',
    fontFamily: fonts.body, fontSize: type.micro, color: 'rgba(242,239,233,0.45)', letterSpacing: 0.3,
  },
  loading: { position: 'absolute', top: '48%', alignSelf: 'center' },
  error: { position: 'absolute', top: 120, alignSelf: 'center', ...glass, borderColor: colors.danger, borderRadius: radius.md, padding: space.md, marginHorizontal: space.lg },
  clip: {
    position: 'absolute', alignSelf: 'center', maxWidth: '92%', flexDirection: 'row', alignItems: 'center', gap: space.md,
    ...glass, borderColor: 'rgba(96,165,250,0.6)', borderRadius: radius.pill, paddingVertical: space.sm, paddingLeft: space.lg, paddingRight: space.md,
  },
  clipCut: { borderColor: 'rgba(245,158,11,0.7)' },
  clipText: { flexShrink: 1, fontFamily: fonts.body, fontSize: type.caption, color: colors.muted },
  clipStrong: { fontFamily: fonts.strong, color: colors.text },
  clipClose: { fontFamily: fonts.strong, fontSize: type.body, color: colors.muted },
  errorText: { fontFamily: fonts.body, fontSize: type.caption, color: colors.danger },
})
