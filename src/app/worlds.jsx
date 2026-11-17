// Odalar: sunucuyu otomatik bulur, ardından dünya (kök oda) seçimi. Kitaplıktan (/) açılır.
// Web WorldSelect'in (/worlds) mobil karşılığı. Adres elle girilmez; yalnızca otomatik
// arama başarısız olursa son çare olarak elle giriş sunulur.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { assetUrl, normalizeServerUrl, saveServerUrl } from '../api/client'
import { discoverServer, probe } from '../api/discovery'
import { refreshRooms } from '../api/loadRoom'
import { getVisits, lastVisit, orderWorlds, recentRooms, worldsOf } from '../api/visits'
import { useStore } from '../store/useStore'
import { useScreen } from '../layout'
import { colors, fonts, type, space, radius } from '../theme'

function openRoom(room) {
  router.push({ pathname: '/room', params: { id: room.id, name: room.name } })
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

// compact: yataydaki dörtlü grid hücresi (daha alçak, daha küçük yazı)
function WorldCard({ world, index, width, compact }) {
  const cover = world.coverImage ? assetUrl(world.coverImage) : null
  return (
    <Pressable onPress={() => openRoom(world)} style={({ pressed }) => [styles.card, compact && styles.cardCompact, width != null && { width }, pressed && { transform: [{ scale: 0.985 }] }]} accessibilityRole="button">
      {cover && <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: cover ? 'rgba(8,8,10,0.55)' : 'transparent' }]} />
      <Text style={[styles.cardIndex, compact && styles.cardIndexCompact]}>{String(index + 1).padStart(2, '0')}</Text>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Text style={[styles.cardName, compact && styles.cardNameCompact]} numberOfLines={2}>{world.name}</Text>
        <Text style={[styles.cardMeta, compact && styles.cardMetaCompact]} numberOfLines={1}>
          {world.children?.length ? `${world.children.length} alt oda` : 'Tek oda'}
          {world.roomType === 'cadde' ? ' · cadde' : ''}
        </Text>
      </View>
    </Pressable>
  )
}

// Kitaplığa (ana sayfa) dönüş; kitaplık yığının en altındadır
function goToLibrary() {
  router.dismissTo('/')
}

export default function Worlds() {
  const insets = useSafeAreaInsets()
  // Yatay: dünyalar dörtlü grid (soldan sağa), "Kaldığın yer" bir grid hücresi genişliğinde,
  // yanında geniş "Son odalar" alanı. Kenar boşlukları çentiği / kamera deliğini hesaba katar.
  const { width, landscape } = useScreen()
  const cols = landscape ? 4 : 1
  const pad = { paddingLeft: insets.left + space.lg, paddingRight: insets.right + space.lg }
  const cardW = cols > 1 ? (width - pad.paddingLeft - pad.paddingRight - space.md * (cols - 1)) / cols : null
  // Dünyalar da alt odalar da store'daki tek listeden (/api/rooms): oda ekranı ve oda
  // oluşturma akışı bu listeyi tazeler, yeni / silinen odalar sıralamaya hemen yansır.
  const rooms = useStore((s) => s.rooms)
  const setRooms = useStore((s) => s.setRooms)
  // phase: 'searching' → 'ready' | 'notfound'
  const [phase, setPhase] = useState('searching')
  const [status, setStatus] = useState('Sunucu aranıyor')
  const [attempt, setAttempt] = useState(0)
  const [server, setServer] = useState(null)
  // Sıra cihazın kendi ziyaret geçmişinden (visits.js), sunucunun lastActiveAt'inden değil
  const [visits, setVisits] = useState([])
  const loadedFor = useRef(null) // listesi en az bir kez yüklenmiş sunucu
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

  // İlk açılış ve odadan her dönüş: geçmiş + oda listesi tazelenir (oda, web'de ya da
  // telefonda eklenmiş / silinmiş olabilir). Liste elde varken geçici bir ağ hatası
  // arama ekranına atmaz; yalnızca bu sunucudan hiç liste alınamadıysa yeniden aranır.
  useFocusEffect(useCallback(() => {
    if (!server) return undefined
    let alive = true
    if (loadedFor.current !== server) setRooms([]) // başka sunucunun odaları görünmesin
    getVisits().then((v) => alive && setVisits(v))
    refreshRooms()
      .then(() => { loadedFor.current = server }, () => alive && loadedFor.current !== server && rediscover())
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [server, setRooms, rediscover]))

  const worlds = useMemo(() => orderWorlds(worldsOf(rooms), rooms, visits), [rooms, visits])
  const recent = useMemo(() => recentRooms(rooms, visits), [rooms, visits])
  const last = useMemo(() => lastVisit(rooms, visits), [rooms, visits])

  // Aşağı çekip yenile — sunucu kaybolduysa (IP değişti vb.) yeniden ara
  const refresh = useCallback(() => {
    setLoading(true)
    getVisits().then(setVisits)
    refreshRooms().catch(rediscover).finally(() => setLoading(false))
  }, [rediscover])

  const onManualConnected = (url) => {
    setLoading(true)
    setServer(url)
    setPhase('ready')
  }

  if (phase !== 'ready') {
    const searching = phase === 'searching'
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.list}>
        <ScrollView contentContainerStyle={[styles.root, pad, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
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

  const resume = last && (
    <Pressable onPress={() => openRoom(last)} style={styles.resume} accessibilityRole="button">
      <Text style={styles.resumeEyebrow}>Kaldığın yer</Text>
      <Text style={styles.resumeName} numberOfLines={1}>{last.name}</Text>
      <Text style={styles.resumeArrow}>→</Text>
    </Pressable>
  )

  const recentPills = (
    <View style={styles.pills}>
      {recent.map((r) => (
        <Pressable key={r.id} onPress={() => openRoom(r)} style={styles.pill} accessibilityRole="button">
          <Text style={styles.pillText} numberOfLines={1}>{r.name}</Text>
        </Pressable>
      ))}
    </View>
  )

  // Yatay: tek ince satır — solda küçük "Kaldığın yer" hapı, yanında yatay kayan son odalar
  const resumeStrip = (
    <View style={styles.strip}>
      {last && (
        <Pressable onPress={() => openRoom(last)} style={[styles.resumeChip, { maxWidth: cardW }]} accessibilityRole="button" accessibilityLabel={`Kaldığın yer: ${last.name}`}>
          <Text style={styles.resumeChipEyebrow}>Kaldığın yer</Text>
          <Text style={styles.resumeChipName} numberOfLines={1}>{last.name}</Text>
          <Text style={styles.resumeChipArrow}>→</Text>
        </Pressable>
      )}
      {recent.length > 0 && (
        <>
          <Text style={styles.stripLabel}>Son</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.stripPills}>
            {recent.map((r) => (
              <Pressable key={r.id} onPress={() => openRoom(r)} style={styles.stripPill} accessibilityRole="button">
                <Text style={styles.stripPillText} numberOfLines={1}>{r.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  )

  const header = (
    <View style={{ paddingTop: insets.top + (landscape ? space.lg : space.xl) }}>
      <View style={styles.brandRow}>
        {landscape ? (
          <Text style={styles.brandInlineThin}>Focus <Text style={styles.brandInline}>Room</Text></Text>
        ) : (
          <View>
            <Text style={styles.heroThin}>Focus</Text>
            <Text style={styles.hero}>Room</Text>
          </View>
        )}
        <View style={styles.chips}>
          <Pressable onPress={goToLibrary} style={styles.serverChip} accessibilityRole="button" accessibilityLabel="Kitaplık" accessibilityHint="Defterlerin durduğu kitaplığa döner">
            <Text style={styles.serverText}>← Kitaplık</Text>
          </Pressable>
          <Pressable onPress={rediscover} style={styles.serverChip} accessibilityRole="button" accessibilityLabel="Sunucuyu yeniden ara">
            <View style={[styles.statusDot, { backgroundColor: colors.link }]} />
            <Text style={styles.serverText} numberOfLines={1}>{server.replace(/^https?:\/\//, '')}</Text>
          </Pressable>
        </View>
      </View>

      {landscape ? (
        (last || recent.length > 0) && resumeStrip
      ) : (
        <>
          {resume}
          {recent.length > 0 && (
            <>
              <Text style={styles.section}>Son odalar</Text>
              {recentPills}
            </>
          )}
        </>
      )}
      <Text style={[styles.section, landscape && { marginTop: space.lg }]}>Dünyalar · {worlds.length}</Text>
    </View>
  )

  return (
    <FlatList
      key={`cols-${cols}`} // numColumns yerinde değişemez: yön değişince liste yeniden kurulur
      style={styles.list}
      contentContainerStyle={[pad, { paddingBottom: insets.bottom + space.xxl }]}
      data={worlds}
      keyExtractor={(w) => w.id}
      numColumns={cols}
      columnWrapperStyle={cols > 1 ? { gap: space.md } : undefined}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => <WorldCard world={item} index={index} width={cardW} compact={landscape} />}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.xl }} /> : null}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
    />
  )
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xxl },
  searchText: { fontFamily: fonts.body, fontSize: type.heading - 2, color: colors.muted },
  retry: { alignSelf: 'flex-start', height: 52, paddingHorizontal: space.xl, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: space.xl, marginBottom: space.lg },
  link: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.accent, textDecorationLine: 'underline' },
  list: { flex: 1, backgroundColor: colors.bg },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  chips: { alignItems: 'flex-end', gap: space.sm },
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
  // Yatay: tek satır şerit (32 px) — "Kaldığın yer" hapı + yatay kayan son odalar
  brandInlineThin: { fontFamily: fonts.displayThin, fontSize: type.hero - 8, lineHeight: (type.hero - 8) * 1.1, color: colors.text },
  brandInline: { fontFamily: fonts.display, color: colors.accent },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  resumeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: space.md,
    borderRadius: radius.pill, backgroundColor: colors.accent,
  },
  resumeChipEyebrow: { fontFamily: fonts.strong, fontSize: type.micro - 1, letterSpacing: 1.2, color: colors.accentInk, textTransform: 'uppercase', opacity: 0.65 },
  resumeChipName: { flexShrink: 1, fontFamily: fonts.strong, fontSize: type.caption, color: colors.accentInk },
  resumeChipArrow: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.accentInk },
  stripLabel: { fontFamily: fonts.strong, fontSize: type.micro - 1, letterSpacing: 1.2, color: colors.faint, textTransform: 'uppercase', marginLeft: space.xs },
  stripPills: { gap: 6, alignItems: 'center' },
  stripPill: {
    height: 28, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, maxWidth: 180,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  stripPillText: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted },
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
  cardCompact: { height: 124, padding: space.md },
  cardIndexCompact: { fontSize: type.heading },
  cardNameCompact: { fontSize: type.heading, lineHeight: type.heading * 1.15 },
  cardMetaCompact: { fontSize: type.micro + 1, marginTop: 2 },
})
