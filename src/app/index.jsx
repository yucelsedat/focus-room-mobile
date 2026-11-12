// Giriş: sunucuyu otomatik bulur, ardından dünya (kök oda) seçimi.
// Web WorldSelect'in mobil karşılığı. Adres elle girilmez; yalnızca otomatik
// arama başarısız olursa son çare olarak elle giriş sunulur.
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api, assetUrl, normalizeServerUrl, saveServerUrl } from '../api/client'
import { discoverServer, probe } from '../api/discovery'
import { useStore } from '../store/useStore'
import { colors, fonts, type, space, radius } from '../theme'

function openRoom(room) {
  router.push({ pathname: '/room', params: { id: room.id, name: room.name } })
}

async function fetchHome() {
  const [worlds, rooms] = await Promise.all([api('/api/worlds'), api('/api/rooms')])
  const [[, id], [, name]] = await AsyncStorage.multiGet(['lastRoomId', 'lastRoomName'])
  const last = id && rooms.some((r) => r.id === id) ? { id, name } : null
  return { worlds, rooms, last }
}

// Son çare: otomatik arama sunucuyu bulamadıysa
function ManualForm({ onConnected }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const connect = async () => {
    const base = normalizeServerUrl(value)
    if (!base) return
    setBusy(true)
    setError(null)
    if (await probe(base, { timeout: 5000 })) {
      onConnected(await saveServerUrl(base))
    } else {
      setError('Bu adreste Focus Room sunucusu yanıt vermedi.')
    }
    setBusy(false)
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Adresi elle gir</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="192.168.1.20"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={connect}
          style={styles.input}
          accessibilityLabel="Sunucu adresi"
        />
        <Pressable onPress={connect} disabled={busy || !value.trim()} style={[styles.connect, (busy || !value.trim()) && { opacity: 0.5 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.connectText}>Bağlan</Text>}
        </Pressable>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

function WorldCard({ world, index }) {
  const cover = world.coverImage ? assetUrl(world.coverImage) : null
  return (
    <Pressable onPress={() => openRoom(world)} style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.985 }] }]} accessibilityRole="button">
      {cover && <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: cover ? 'rgba(8,8,10,0.55)' : 'transparent' }]} />
      <Text style={styles.cardIndex}>{String(index + 1).padStart(2, '0')}</Text>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Text style={styles.cardName} numberOfLines={2}>{world.name}</Text>
        <Text style={styles.cardMeta}>
          {world.children?.length ? `${world.children.length} alt oda` : 'Tek oda'}
          {world.roomType === 'cadde' ? ' · cadde' : ''}
        </Text>
      </View>
    </Pressable>
  )
}

export default function Home() {
  const insets = useSafeAreaInsets()
  const setRooms = useStore((s) => s.setRooms)
  // phase: 'searching' → 'ready' | 'notfound'
  const [phase, setPhase] = useState('searching')
  const [status, setStatus] = useState('Sunucu aranıyor')
  const [attempt, setAttempt] = useState(0)
  const [server, setServer] = useState(null)
  const [worlds, setWorlds] = useState([])
  const [recent, setRecent] = useState([])
  const [last, setLast] = useState(null)
  const [loading, setLoading] = useState(false)
  const [manual, setManual] = useState(false)

  // Otomatik bulma: açılışta ve "tekrar ara"da (attempt artar)
  useEffect(() => {
    let alive = true
    discoverServer({ onStatus: (s) => alive && setStatus(s) }).then((url) => {
      if (!alive) return
      if (url) {
        setLoading(true)
        setServer(url)
        setPhase('ready')
      } else {
        setPhase('notfound')
      }
    })
    return () => { alive = false }
  }, [attempt])

  const rediscover = useCallback(() => {
    setStatus('Sunucu aranıyor')
    setPhase('searching')
    setManual(false)
    setAttempt((a) => a + 1)
  }, [])

  const apply = useCallback((data) => {
    setWorlds(data.worlds)
    setRooms(data.rooms)
    setRecent(data.rooms.filter((r) => r.parent).slice(0, 6))
    setLast(data.last)
  }, [setRooms])

  useEffect(() => {
    if (!server) return undefined
    let alive = true
    fetchHome()
      .then((d) => alive && apply(d), () => alive && rediscover())
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [server, apply, rediscover])

  // Aşağı çekip yenile — sunucu kaybolduysa (IP değişti vb.) yeniden ara
  const refresh = useCallback(() => {
    setLoading(true)
    fetchHome().then(apply, rediscover).finally(() => setLoading(false))
  }, [apply, rediscover])

  const onManualConnected = (url) => {
    setLoading(true)
    setServer(url)
    setPhase('ready')
  }

  if (phase !== 'ready') {
    const searching = phase === 'searching'
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.list}>
        <ScrollView contentContainerStyle={[styles.root, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.heroThin}>Focus</Text>
          <Text style={styles.hero}>Room</Text>
          {searching ? (
            <View style={styles.searchRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.searchText}>{status}…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.lede}>Sunucu bulunamadı.</Text>
              <Text style={styles.help}>
                Bilgisayarda proje kökünde {'"npm run dev:backend"'} çalışıyor mu, telefon aynı Wi-Fi ağında mı?
              </Text>
              <Pressable onPress={rediscover} style={styles.retry} accessibilityRole="button">
                <Text style={styles.connectText}>Tekrar ara</Text>
              </Pressable>
              {manual ? (
                <ManualForm onConnected={onManualConnected} />
              ) : (
                <Pressable onPress={() => setManual(true)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>Adresi elle gir</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  const header = (
    <View style={{ paddingTop: insets.top + space.xl }}>
      <View style={styles.brandRow}>
        <View>
          <Text style={styles.heroThin}>Focus</Text>
          <Text style={styles.hero}>Room</Text>
        </View>
        <Pressable onPress={rediscover} style={styles.serverChip} accessibilityRole="button" accessibilityLabel="Sunucuyu yeniden ara">
          <View style={[styles.statusDot, { backgroundColor: colors.link }]} />
          <Text style={styles.serverText} numberOfLines={1}>{server.replace(/^https?:\/\//, '')}</Text>
        </Pressable>
      </View>

      {last && (
        <Pressable onPress={() => openRoom(last)} style={styles.resume} accessibilityRole="button">
          <Text style={styles.resumeEyebrow}>Kaldığın yer</Text>
          <Text style={styles.resumeName} numberOfLines={1}>{last.name}</Text>
          <Text style={styles.resumeArrow}>→</Text>
        </Pressable>
      )}

      {recent.length > 0 && (
        <>
          <Text style={styles.section}>Son odalar</Text>
          <View style={styles.pills}>
            {recent.map((r) => (
              <Pressable key={r.id} onPress={() => openRoom(r)} style={styles.pill} accessibilityRole="button">
                <Text style={styles.pillText} numberOfLines={1}>{r.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <Text style={styles.section}>Dünyalar · {worlds.length}</Text>
    </View>
  )

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl }}
      data={worlds}
      keyExtractor={(w) => w.id}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => <WorldCard world={item} index={index} />}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.xl }} /> : null}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
    />
  )
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xxl },
  searchText: { fontFamily: fonts.body, fontSize: type.heading - 2, color: colors.muted },
  retry: { alignSelf: 'flex-start', height: 52, paddingHorizontal: space.xl, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: space.xl, marginBottom: space.lg },
  link: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.accent, textDecorationLine: 'underline' },
  list: { flex: 1, backgroundColor: colors.bg },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  heroThin: { fontFamily: fonts.displayThin, fontSize: type.hero + 8, color: colors.text, lineHeight: (type.hero + 8) * 1.0 },
  hero: { fontFamily: fonts.display, fontSize: type.hero + 8, color: colors.accent, lineHeight: (type.hero + 8) * 1.05, marginTop: -8 },
  lede: { fontFamily: fonts.body, fontSize: type.heading - 2, lineHeight: 26, color: colors.muted, marginTop: space.lg, maxWidth: 320 },
  form: { marginTop: space.xxl },
  label: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 1.6, color: colors.faint, textTransform: 'uppercase', marginBottom: space.sm },
  inputRow: { flexDirection: 'row', gap: space.sm },
  input: {
    flex: 1, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text,
    paddingHorizontal: space.lg, fontFamily: fonts.body, fontSize: type.body + 1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  connect: { height: 52, paddingHorizontal: space.xl, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  connectText: { fontFamily: fonts.strong, fontSize: type.body, color: colors.accentInk },
  help: { fontFamily: fonts.body, fontSize: type.caption, color: colors.faint, marginTop: space.sm },
  error: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18, color: colors.danger, marginTop: space.sm },
  serverChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 170, marginBottom: 10,
    paddingHorizontal: space.md, height: 32, borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  serverText: { fontFamily: fonts.body, fontSize: type.micro + 1, color: colors.muted },
  resume: {
    marginTop: space.xl, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.accent,
  },
  resumeEyebrow: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 1.6, color: colors.accentInk, textTransform: 'uppercase', opacity: 0.7 },
  resumeName: { fontFamily: fonts.display, fontSize: type.title, color: colors.accentInk, marginTop: 2, paddingRight: 40 },
  resumeArrow: { position: 'absolute', right: space.lg, bottom: space.lg, fontFamily: fonts.strong, fontSize: type.title, color: colors.accentInk },
  section: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 1.6, color: colors.faint, textTransform: 'uppercase', marginTop: space.xl, marginBottom: space.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: { paddingHorizontal: space.lg, height: 36, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, maxWidth: 200 },
  pillText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text },
  card: {
    height: 148, borderRadius: radius.lg, overflow: 'hidden', padding: space.lg, marginBottom: space.md,
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  cardIndex: { fontFamily: fonts.displayThin, fontSize: type.title, color: colors.accent },
  cardName: { fontFamily: fonts.display, fontSize: type.title - 2, lineHeight: (type.title - 2) * 1.12, color: colors.text },
  cardMeta: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, marginTop: 4 },
})
