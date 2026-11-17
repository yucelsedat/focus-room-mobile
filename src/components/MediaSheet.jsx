// Dokunulan panelin detay sayfası. Web'de panellerin çoğu yerinde (DOM) açılır;
// mobilde içerik native olarak burada okunur. Düzenleme şimdilik masaüstünde.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useStore } from '../store/useStore'
import { assetUrl } from '../api/client'
import { CLIP_TYPES, removeTileMedia, toggleClip } from '../api/tileClipboard'
import { Sheet, SectionLabel, useSheetLayout } from './Sheet'
import { RoomRow } from './RoomRow'
import { metaFor, parseJson, stripHtml, stripMarkdown, youtubeThumb } from '../scene/media'
import { colors, fonts, type, space, radius } from '../theme'
import { Icon } from './Icon'
import { formatTime, probeVideo } from '../video/video'

function FitImage({ uri }) {
  const { contentWidth: w, mediaMaxHeight: maxHeight } = useSheetLayout()
  const [ar, setAr] = useState(16 / 10)
  return (
    <Image
      source={{ uri }}
      onLoad={(e) => {
        const s = e.nativeEvent?.source
        if (s?.width && s?.height) setAr(s.width / s.height)
      }}
      style={{ width: w, height: Math.min(maxHeight, w / ar), borderRadius: radius.md, backgroundColor: colors.surfaceHi }}
      resizeMode="contain"
    />
  )
}

// Medyanın bağlı olduğu tile (TileSheet için): satır = panel tabanının yüksekliği
function tileFromMedia(item) {
  const id = String(item.tileId)
  const kind = id.startsWith('outer2-') ? 'outer2' : id.startsWith('outer-') ? 'outer' : id.startsWith('wall-') ? 'wall' : 'floor'
  return { id: item.tileId, position: item.position, rotation: item.rotation, kind, row: Math.max(0, Math.floor(item.position[1])) }
}

// edit: true → tile sayfası doğrudan bu metnin düzenleyicisiyle açılır
function EditButton({ item, label = 'Boyut · sil', edit = false, primary = false }) {
  const openTileSheet = useStore((s) => s.openTileSheet)
  const selectMedia = useStore((s) => s.selectMedia)
  // iOS: bir Modal kapanırken diğerini açmak sunum hatası verir → önce kapat, sonra aç
  const open = () => {
    selectMedia(null)
    setTimeout(() => openTileSheet({ ...tileFromMedia(item), ...(edit ? { editId: item.id } : {}) }), 380)
  }
  return (
    <Pressable style={[styles.button, !primary && styles.ghost]} onPress={open} accessibilityRole="button">
      <Text style={[styles.buttonText, !primary && { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

// Kopyala / Kes → sonra başka bir tile'a dokunup "Yapıştır" (web EditModal ile aynı)
function ClipActions({ item }) {
  const clip = useStore((s) => s.tileClipboard)
  if (!CLIP_TYPES.has(item.type)) return null
  const copied = clip?.id === item.id && clip.mode === 'copy'
  const cut = clip?.id === item.id && clip.mode === 'cut'
  return (
    <>
      <Pressable style={[styles.button, styles.ghost, copied && styles.copyOn]} onPress={() => toggleClip(item, 'copy')} accessibilityRole="button">
        <Text style={[styles.buttonText, { color: copied ? '#60a5fa' : colors.text }]}>{copied ? '✓ Kopyalandı' : 'Kopyala'}</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.ghost, cut && styles.cutOn]} onPress={() => toggleClip(item, 'cut')} accessibilityRole="button">
        <Text style={[styles.buttonText, { color: cut ? '#f59e0b' : colors.text }]}>{cut ? '✓ Kesildi' : 'Kes'}</Text>
      </Pressable>
    </>
  )
}

// Panoyu duvardan kaldır (onaylı). Senkron canvas'ta yalnız bu kopya gider.
function DeleteButton({ item }) {
  const selectMedia = useStore((s) => s.selectMedia)
  const [busy, setBusy] = useState(false)
  const label = metaFor(item.type).label
  const sync = item.syncGroupId && item.syncCount > 1
  const ask = () => Alert.alert(
    `${label} silinsin mi?`,
    sync
      ? `Bu senkron bir canvas. Yalnız bu kopya kaldırılır; diğer ${item.syncCount - 1} kopya ve içerik kalır.`
      : `${label} ve içindekiler bu duvardan kalıcı olarak kaldırılacak.`,
    [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive', onPress: async () => {
          setBusy(true)
          try {
            await removeTileMedia(item)
            selectMedia(null)
          } catch (err) {
            setBusy(false)
            Alert.alert('Silinemedi', err?.message ?? String(err))
          }
        },
      },
    ],
  )
  return (
    <Pressable style={[styles.button, styles.danger]} onPress={ask} disabled={busy} accessibilityRole="button" accessibilityLabel={`${label} sil`}>
      {busy ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={[styles.buttonText, { color: colors.danger }]}>Sil</Text>}
    </Pressable>
  )
}

// Canvas → yatay tam ekran düzenleyici (duvarda basılı tutmakla aynı)
function CanvasEditButton({ item }) {
  const selectMedia = useStore((s) => s.selectMedia)
  const openCanvasEditor = useStore((s) => s.openCanvasEditor)
  const open = () => {
    selectMedia(null)
    setTimeout(() => openCanvasEditor(item.id), 300) // sayfa kapanma animasyonu bitsin
  }
  return (
    <Pressable style={styles.button} onPress={open} accessibilityRole="button">
      <Text style={styles.buttonText}>Tam ekran düzenle</Text>
    </Pressable>
  )
}

function OpenButton({ url, label = 'Tarayıcıda aç' }) {
  if (!url) return null
  return (
    <Pressable style={styles.button} onPress={() => Linking.openURL(assetUrl(url)).catch(() => {})} accessibilityRole="link">
      <Text style={styles.buttonText}>{label}  ↗</Text>
    </Pressable>
  )
}

// Video: önizleme karesi + sesli tam ekran oynatıcı
function VideoDetail({ item }) {
  const openVideoPlayer = useStore((s) => s.openVideoPlayer)
  const [poster, setPoster] = useState(null)
  const [meta, setMeta] = useState(null)
  useEffect(() => {
    let alive = true
    probeVideo(item.url)
      .then((p) => { if (alive) { setPoster(p.poster); setMeta(p) } })
      .catch(() => { if (alive) setMeta({ failed: true }) })
    return () => { alive = false }
  }, [item.url])
  const name = decodeURIComponent((item.url || '').split('/').pop() || 'Video').replace(/^\d{10,}-/, '')
  const play = () => openVideoPlayer({ mediaId: item.id, url: item.url, ratio: meta?.ratio ?? item.width / item.height, title: name })
  return (
    <>
      <Pressable onPress={play} accessibilityRole="button" accessibilityLabel="Videoyu oynat">
        {poster ? <FitImage uri={poster} /> : (
          <View style={[styles.videoEmpty, { aspectRatio: item.width / item.height || 16 / 9 }]}>
            {!meta && <ActivityIndicator color={colors.accent} />}
          </View>
        )}
        <View style={styles.playBadge} pointerEvents="none"><Icon name="play" size={30} /></View>
      </Pressable>
      <Text style={styles.caption}>
        {[name, meta?.duration ? formatTime(meta.duration) : null, meta?.width ? `${meta.width} × ${meta.height}` : null].filter(Boolean).join(' · ')}
      </Text>
      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={play} accessibilityRole="button">
          <Text style={styles.buttonText}>▶  Oynat (sesli)</Text>
        </Pressable>
        <EditButton item={item} />
        <ClipActions item={item} />
        <OpenButton url={item.url} label="Sistem oynatıcısı" />
      </View>
    </>
  )
}

function Body({ text }) {
  return <Text style={styles.body} selectable>{text || '—'}</Text>
}

function CanvasDetail({ item, onGo }) {
  const c = parseJson(item.content, { items: [] })
  // Senkron canvas'tan gidilirse hedef odada grubun üyesinin önüne doğulur
  const sync = item.syncGroupId ? { syncGroupId: item.syncGroupId, fromId: item.id } : null
  const items = c.items ?? []
  const rooms = items.filter((i) => i.type === 'room' && i.roomId)
  const images = items.filter((i) => i.type === 'image' && i.url)
  const links = items.filter((i) => ['link', 'youtube', 'insta', 'pdf', 'music'].includes(i.type) && i.url)
  const texts = items.filter((i) => i.type === 'text' && stripHtml(i.content))
  const { contentWidth } = useSheetLayout()
  const thumb = (contentWidth - space.sm * 2) / 3
  return (
    <>
      {rooms.length > 0 && (
        <>
          <SectionLabel>Oda linkleri</SectionLabel>
          {rooms.map((r) => <RoomRow key={r.id} name={r.roomName || 'Oda'} tone={colors.link} onPress={() => onGo(r.roomId, r.roomName, sync)} />)}
        </>
      )}
      {texts.length > 0 && (
        <>
          <SectionLabel>Metinler</SectionLabel>
          {texts.map((t) => <View key={t.id} style={styles.card}><Body text={stripHtml(t.content)} /></View>)}
        </>
      )}
      {images.length > 0 && (
        <>
          <SectionLabel>Görseller · {images.length}</SectionLabel>
          <View style={styles.grid}>
            {images.slice(0, 30).map((i) => (
              <Pressable key={i.id} onPress={() => Linking.openURL(assetUrl(i.url)).catch(() => {})}>
                <Image source={{ uri: assetUrl(i.url) }} style={{ width: thumb, height: thumb, borderRadius: radius.sm, backgroundColor: colors.surfaceHi }} />
              </Pressable>
            ))}
          </View>
        </>
      )}
      {links.length > 0 && (
        <>
          <SectionLabel>Bağlantılar</SectionLabel>
          {links.map((l) => (
            <RoomRow
              key={l.id}
              name={l.title || l.name || l.siteName || l.url}
              hint={l.type === 'youtube' ? 'YouTube' : l.siteName || l.type}
              tone="#f59e0b"
              onPress={() => Linking.openURL(assetUrl(l.url)).catch(() => {})}
            />
          ))}
        </>
      )}
      {!items.length && <Body text="Bu canvas boş." />}
    </>
  )
}

function Detail({ item, onGo }) {
  switch (item.type) {
    case 'image':
    case 'slide':
      return (
        <>
          <FitImage uri={assetUrl(item.url)} />
          <View style={styles.actions}>
            <OpenButton url={item.url} label="Tam boyut aç" />
            {item.type === 'image' && <EditButton item={item} />}
            <ClipActions item={item} />
          </View>
        </>
      )
    case 'youtube': {
      const thumb = youtubeThumb(item.url)
      return (
        <>
          {thumb && <FitImage uri={thumb} />}
          <OpenButton url={item.url} label="YouTube'da izle" />
        </>
      )
    }
    case 'video':
      return <VideoDetail item={item} />
    case 'embed':
    case 'projectview':
      return <><Body text={item.url} /><OpenButton url={item.url} /></>
    case 'markdown':
      return (
        <>
          <Body text={stripMarkdown(item.content)} />
          <View style={styles.actions}>
            <EditButton item={item} label="Düzenle · sil" edit primary />
            <ClipActions item={item} />
          </View>
        </>
      )
    case 'header':
      return <Text style={styles.headerText}>{parseJson(item.content).text || '—'}</Text>
    case 'defter': {
      const pages = parseJson(item.content, { pages: [] }).pages ?? []
      return (
        <>
          <SectionLabel>Sayfalar · {pages.length}</SectionLabel>
          {pages.map((p, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.cardTitle}>{p.title?.trim() || `Sayfa ${i + 1}`}</Text>
              <Text style={styles.caption}>{(p.blocks ?? []).length} blok</Text>
            </View>
          ))}
        </>
      )
    }
    case 'canvas':
      return (
        <>
          <View style={styles.actions}>
            <CanvasEditButton item={item} />
            <ClipActions item={item} />
            <DeleteButton item={item} />
          </View>
          <CanvasDetail item={item} onGo={onGo} />
        </>
      )
    default:
      return <Body text="Bu panel (Claude oturumu / proje) şimdilik yalnızca masaüstü sürümünde kullanılabiliyor." />
  }
}

export function MediaSheet({ onGo }) {
  const item = useStore((s) => s.selectedMedia)
  const selectMedia = useStore((s) => s.selectMedia)
  const close = () => selectMedia(null)
  const meta = item ? metaFor(item.type) : null
  const title = item?.type === 'header' ? null : meta?.label
  return (
    <Sheet visible={!!item} onClose={close} eyebrow={meta ? `${meta.label} · ${item.width}×${item.height}` : ''} title={title}>
      {item && <Detail item={item} onGo={(id, name, sync) => { close(); onGo(id, name, sync) }} />}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: type.body * 1.55, color: colors.text },
  headerText: { fontFamily: fonts.display, fontSize: type.hero, lineHeight: type.hero * 1.08, color: colors.text },
  card: { backgroundColor: colors.surfaceHi, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  cardTitle: { fontFamily: fonts.strong, fontSize: type.body, color: colors.text },
  caption: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  button: {
    marginTop: space.lg, alignSelf: 'flex-start', backgroundColor: colors.accent,
    paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill,
  },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  videoEmpty: { width: '100%', maxHeight: 420, borderRadius: radius.md, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -36, width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(10,10,18,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ghost: { backgroundColor: colors.surfaceHi },
  danger: { backgroundColor: 'rgba(248,113,113,0.12)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.4)' },
  copyOn: { backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1, borderColor: '#60a5fa' },
  cutOn: { backgroundColor: 'rgba(245,158,11,0.15)', borderWidth: 1, borderColor: '#f59e0b' },
  buttonText: { fontFamily: fonts.strong, fontSize: type.body, color: colors.accentInk },
})
