// Oda linki ekleme paneli (yatay tam ekran düzenleyici içinde).
// 1) Ara: odalar süzülür; yazılan adla oda yoksa "oluştur ve ekle" satırı çıkar
// 2) Tür / ilişki: yeni oda → child | ayrık; var olan kök oda → child | parent | ayrık
//    (kurallar roomLink.js'te — web CanvasMesh ile aynı)
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useStore } from '../../store/useStore'
import { refreshRooms } from '../../api/loadRoom'
import { colors, fonts, type, space, radius } from '../../theme'
import { applyRoomPlan, existingRoomPlan, newRoomPlan, roomMatches } from './roomLink'

export function RoomLinkPanel({ left, onAdd, onClose }) {
  const rooms = useStore((s) => s.rooms)
  // zustand v5: seçici her seferinde yeni nesne döndürmesin (sonsuz render)
  const hereId = useStore((s) => s.currentRoomId)
  const hereName = useStore((s) => s.currentRoomName)
  const here = useMemo(() => ({ id: hereId, name: hereName }), [hereId, hereName])
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)

  // Web'de yeni açılan odalar da listede olsun
  useEffect(() => { refreshRooms().catch(() => {}) }, [])

  const matches = useMemo(() => roomMatches(rooms, q), [rooms, q])
  const name = q.trim()
  const exact = name && rooms.some((r) => r.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))
  const canCreate = !!name && !exact

  const finish = async (p, choice) => {
    setBusy(true)
    try {
      const res = await applyRoomPlan(p, choice, here)
      onAdd(res.roomId, res.roomName)
    } catch (err) {
      setBusy(false)
      Alert.alert(p.roomId ? 'Oda ilişkisi kurulamadı' : 'Oda oluşturulamadı', err?.message ?? String(err))
    }
  }

  const pickExisting = (room) => {
    const p = existingRoomPlan(rooms, here, room)
    if (p) setPlan(p)
    else onAdd(room.id, room.name)
  }
  const pickCreate = () => setPlan(newRoomPlan(name, here))
  // Klavyedeki "Bitti": ilk öneri (web'de Enter)
  const submit = () => {
    if (matches.length && name) pickExisting(matches[0])
    else if (canCreate) pickCreate()
  }

  return (
    <KeyboardAvoidingView style={StyleSheet.absoluteFill} behavior="padding" pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={busy ? undefined : onClose} accessibilityLabel="Kapat" />
      <View style={[styles.panel, { left }]}>
        {plan ? (
          <KindStep plan={plan} here={here} busy={busy} onBack={() => setPlan(null)} onPick={(c) => finish(plan, c)} />
        ) : (
          <>
            <View style={styles.head}>
              <Text style={styles.eyebrow}>ODA LİNKİ EKLE</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Kapat">
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Oda ara ya da yeni oda adı yaz"
              placeholderTextColor={colors.faint}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={submit}
              disableFullscreenUI
              autoCorrect={false}
              selectionColor={colors.accent}
            />
            <FlatList
              data={matches}
              keyExtractor={(r) => r.id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => <RoomOption room={item} here={item.id === here.id} onPress={() => pickExisting(item)} />}
              ListFooterComponent={canCreate ? (
                <Pressable onPress={pickCreate} style={({ pressed }) => [styles.create, pressed && styles.pressed]} accessibilityRole="button">
                  <Text style={styles.createPlus}>＋</Text>
                  <Text style={styles.createText} numberOfLines={1}>
                    “<Text style={styles.createName}>{name}</Text>” odasını oluştur ve ekle
                  </Text>
                </Pressable>
              ) : null}
              ListEmptyComponent={!canCreate ? <Text style={styles.empty}>{rooms.length ? 'Eşleşen oda yok' : 'Henüz oda yok — bir ad yaz'}</Text> : null}
            />
          </>
        )}
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

function RoomOption({ room, here, onPress }) {
  const sub = here ? 'şu an buradasın' : room.parent ? `↳ ${room.parent.name}` : 'kök oda'
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={room.name}>
      <Text style={styles.rowIcon}>🏠</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{room.name}</Text>
        <Text style={[styles.rowSub, here && { color: colors.link }]} numberOfLines={1}>{sub}</Text>
      </View>
      {room.children?.length > 0 && <Text style={styles.rowCount}>{room.children.length} child</Text>}
    </Pressable>
  )
}

function KindStep({ plan, here, busy, onBack, onPick }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>{plan.roomId ? 'KÖK ODA' : 'YENİ ODA'}</Text>
        <Pressable onPress={onBack} disabled={busy} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>← Geri</Text>
        </Pressable>
      </View>
      <Text style={styles.kindName} numberOfLines={1}>{plan.name}</Text>
      <Text style={styles.kindQ}>
        {plan.roomId ? `Bu oda “${here.name ?? ''}” odasına nasıl bağlansın?` : 'Bu oda nasıl oluşturulsun?'}
      </Text>
      <View style={styles.options}>
        {plan.options.map((o) => (
          <Pressable
            key={o.key}
            disabled={o.disabled || busy}
            onPress={() => onPick(o.key)}
            style={({ pressed }) => [styles.option, o.key === plan.choice && styles.optionMain, o.disabled && styles.optionOff, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!o.disabled }}
          >
            <Text style={[styles.optionIcon, o.disabled && styles.offText]}>{o.icon}</Text>
            <Text style={[styles.optionLabel, o.disabled && styles.offText]}>{o.label}</Text>
            <Text style={styles.optionHint}>{o.hint}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(5,5,10,0.55)' },
  panel: {
    position: 'absolute',
    top: space.md,
    bottom: space.md,
    right: space.md,
    maxWidth: 640,
    backgroundColor: 'rgba(12,12,20,0.98)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.3)',
    padding: space.lg,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  eyebrow: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 2.4, color: colors.muted },
  close: { fontFamily: fonts.strong, fontSize: type.heading, color: colors.muted },
  back: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.accent },
  input: {
    fontFamily: fonts.body,
    fontSize: type.heading,
    color: colors.text,
    backgroundColor: colors.surfaceHi,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.md,
    paddingVertical: Platform.OS === 'ios' ? space.md : space.sm,
  },
  list: { flex: 1, marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2, paddingHorizontal: space.sm, borderRadius: radius.sm },
  rowIcon: { fontSize: 18 },
  rowName: { fontFamily: fonts.strong, fontSize: type.body, color: '#93c5fd' },
  rowSub: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, marginTop: 1 },
  rowCount: { fontFamily: fonts.mono, fontSize: type.micro, color: colors.faint },
  pressed: { backgroundColor: 'rgba(96,165,250,0.12)' },
  create: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.sm, borderRadius: radius.sm, marginTop: space.xs, borderTopWidth: 1, borderTopColor: colors.line },
  createPlus: { fontFamily: fonts.strong, fontSize: type.heading, color: colors.accent },
  createText: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.muted },
  createName: { fontFamily: fonts.strong, color: colors.text, textDecorationLine: 'underline' },
  empty: { fontFamily: fonts.body, fontSize: type.caption, color: colors.faint, padding: space.md, textAlign: 'center' },
  kindName: { fontFamily: fonts.display, fontSize: type.title, color: colors.text, marginTop: space.xs },
  kindQ: { fontFamily: fonts.body, fontSize: type.body, color: colors.muted, marginTop: space.xs },
  options: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  option: {
    flex: 1,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    minHeight: 120,
  },
  optionMain: { borderColor: 'rgba(96,165,250,0.6)', backgroundColor: 'rgba(96,165,250,0.08)' },
  optionOff: { opacity: 0.45 },
  optionIcon: { fontSize: 26, color: '#93c5fd' },
  optionLabel: { fontFamily: fonts.strong, fontSize: type.body, color: colors.text, marginTop: space.sm },
  optionHint: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, marginTop: space.xs },
  offText: { color: colors.faint },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,10,0.6)', alignItems: 'center', justifyContent: 'center' },
})
