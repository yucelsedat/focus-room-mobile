// Tile sayfası — web'de E ile açılan "Grid Düzenle" modalının mobil tasarımı.
// Dört tür: Resim (GIF dahil), Video, Metin (markdown) ve Canvas.
//  Resim: kaynak seç → duvarda nasıl duracağını gör → boyutu ayarla → "Duvara as"
//  Metin: yaz → duvardaki görünümünü canlı gör → "Duvara yaz". Web gibi yükseklik
//         5 birim sabit, genişlik metnin kapladığı sütun sayısından (sütun = 3 birim)
//  Video: galeri / kamera / bağlantı → önizleme karesi duvarda → "Duvara as" (dosya
//         olduğu gibi yüklenir, yeniden kodlanmaz). Duvarda önizleme karesi; dokununca sesli.
//  Canvas: arka plan rengi + boyut → "Canvas oluştur" (içerik web'de eklenir)
// Tile'da zaten medya varsa üstte listelenir (resim: boyut / sil, metin: düzenle / sil;
// resim / metin / canvas: kopyala / kes). Panoda öğe varsa en üstte "Yapıştır" şeridi.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Clipboard from 'expo-clipboard'
import { useStore } from '../store/useStore'
import { assetUrl } from '../api/client'
import {
  DEFAULT_HEIGHT, sizeFromRatio, imageSize, prepareLocalImage, clipboardImageToFile,
  fetchUrlToServer, addImageToTile, resizeMedia,
  videoFile, addVideoToTile, fetchVideoToServer,
  addTextToTile, updateMediaContent, addCanvasToTile,
} from '../api/media'
import { metaFor, stripMarkdown } from '../scene/media'
import { enqueueRender } from '../markdown/skia'
import { MD } from '../markdown/render'
import { CLIP_TYPES, clipLabel, pasteClipboard, removeTileMedia, toggleClip } from '../api/tileClipboard'
import { Sheet, SectionLabel, useSheetLayout } from './Sheet'
import { WallFit } from './WallFit'
import { probeVideo, formatTime } from '../video/video'
import { colors, fonts, type, space, radius } from '../theme'

const CLIP_COPY = '#60a5fa' // web: kopyala mavi, kes turuncu
const CLIP_CUT = '#f59e0b'
const KIND_LABEL = { wall: 'İç duvar', outer: '1. bahçe duvarı', outer2: '2. bahçe duvarı' }
const STEP = 0.5
const MIN = 0.5
const MAX = 40
const clamp = (v) => Math.max(MIN, Math.min(MAX, Number(v.toFixed(2))))
const isHttp = (s) => /^https?:\/\/\S+$/i.test(s.trim())

function Stepper({ label, value, onChange, disabled, hint }) {
  return (
    <View style={[styles.stepper, disabled && { opacity: 0.45 }]}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable disabled={disabled} onPress={() => onChange(clamp(value - STEP))} style={styles.stepBtn} hitSlop={6} accessibilityLabel={`${label} azalt`}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable disabled={disabled} onPress={() => onChange(clamp(value + STEP))} style={styles.stepBtn} hitSlop={6} accessibilityLabel={`${label} artır`}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
      {!!hint && <Text style={styles.stepHint}>{hint}</Text>}
    </View>
  )
}

function SourceTile({ glyph, label, onPress, active }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.source, active && styles.sourceActive, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Text style={[styles.sourceGlyph, active && { color: colors.accent }]}>{glyph}</Text>
      <Text style={styles.sourceLabel}>{label}</Text>
    </Pressable>
  )
}

function ClipButtons({ item, disabled }) {
  const clip = useStore((s) => s.tileClipboard)
  if (!CLIP_TYPES.has(item.type)) return null
  const copied = clip?.id === item.id && clip.mode === 'copy'
  const cut = clip?.id === item.id && clip.mode === 'cut'
  return (
    <>
      <Pressable disabled={disabled} onPress={() => toggleClip(item, 'copy')} style={[styles.miniBtn, copied && styles.copyOn]} accessibilityLabel="Kopyala" accessibilityState={{ selected: copied }}>
        <Text style={[styles.miniText, copied && { color: CLIP_COPY }]}>{copied ? '✓ Kopyalandı' : 'Kopyala'}</Text>
      </Pressable>
      <Pressable disabled={disabled} onPress={() => toggleClip(item, 'cut')} style={[styles.miniBtn, cut && styles.cutOn]} accessibilityLabel="Kes" accessibilityState={{ selected: cut }}>
        <Text style={[styles.miniText, cut && { color: CLIP_CUT }]}>{cut ? '✓ Kesildi' : 'Kes'}</Text>
      </Pressable>
    </>
  )
}

// Panodaki öğeyi bu tile'a yapıştır (kesildiyse taşı)
function PasteBanner({ tile, close, busy, setBusy }) {
  const clip = useStore((s) => s.tileClipboard)
  const setClip = useStore((s) => s.setTileClipboard)
  const [error, setError] = useState(null)
  if (!clip) return null
  const isCut = clip.mode === 'cut'
  const paste = async () => {
    setBusy(true)
    setError(null)
    try {
      await pasteClipboard(tile)
      setBusy(false)
      close()
    } catch (err) {
      setBusy(false)
      setError(err?.message ?? String(err))
    }
  }
  return (
    <View style={[styles.paste, isCut && styles.pasteCut]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.pasteText}>
          <Text style={styles.pasteStrong}>{clipLabel(clip)}</Text>
          {isCut ? ' kesildi — bu duvara taşı' : ' kopyalandı — bu duvara yapıştır'}
        </Text>
        {!!error && <Text style={styles.pasteError}>{error}</Text>}
      </View>
      <Pressable disabled={busy} onPress={paste} style={[styles.pasteBtn, isCut && { backgroundColor: CLIP_CUT }]} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color={colors.accentInk} /> : <Text style={styles.pasteBtnText}>{isCut ? 'Taşı' : 'Yapıştır'}</Text>}
      </Pressable>
      <Pressable disabled={busy} onPress={() => setClip(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Panoyu boşalt">
        <Text style={styles.pasteClose}>✕</Text>
      </Pressable>
    </View>
  )
}

function ExistingItem({ item, onChanged, onEdit }) {
  const [busy, setBusy] = useState(false)
  const meta = metaFor(item.type)
  const ratio = item.width / item.height
  const isText = item.type === 'markdown'
  const thumb = item.type === 'image' ? assetUrl(item.url) : null
  const isVideo = item.type === 'video'
  const name = item.type === 'image' || isVideo
    ? decodeURIComponent((item.url || '').split('/').pop() || '').replace(/^\d{10,}-/, '')
    : isText ? (stripMarkdown(item.content).split('\n').find((l) => l.trim()) || 'Boş metin') : meta.label

  const resize = async (h) => {
    setBusy(true)
    try { onChanged(await resizeMedia(item.id, Number((h * ratio).toFixed(2)), h)) } catch (e) { Alert.alert('Boyut değişmedi', e.message) }
    setBusy(false)
  }
  const remove = () => Alert.alert('Silinsin mi?', `${meta.label} bu duvardan kaldırılacak.`, [
    { text: 'Vazgeç', style: 'cancel' },
    {
      text: 'Sil', style: 'destructive', onPress: async () => {
        setBusy(true)
        // Senkron kardeşler + pano da tazelenir (bkz. removeTileMedia)
        try { await removeTileMedia(item) } catch (e) { Alert.alert('Silinemedi', e.message); setBusy(false) }
      },
    },
  ])

  return (
    <View style={styles.existing}>
      {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} /> : (
        <View style={[styles.thumb, styles.thumbText, { backgroundColor: meta.tint }]}>
          {isText && <Text style={styles.thumbGlyph}>Aa</Text>}
          {isVideo && <Text style={[styles.thumbGlyph, { color: colors.text }]}>▶</Text>}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.existingName} numberOfLines={1}>{name}</Text>
        <Text style={styles.existingMeta}>{meta.label} · {item.width} × {item.height}</Text>
        <View style={styles.existingActions}>
          {isText ? (
            <Pressable disabled={busy} onPress={() => onEdit(item)} style={styles.miniBtn}><Text style={styles.miniText}>Düzenle</Text></Pressable>
          ) : (
            <>
              <Pressable disabled={busy} onPress={() => resize(clamp(item.height - STEP))} style={styles.miniBtn} accessibilityLabel="Küçült"><Text style={styles.miniText}>−</Text></Pressable>
              <Pressable disabled={busy} onPress={() => resize(clamp(item.height + STEP))} style={styles.miniBtn} accessibilityLabel="Büyüt"><Text style={styles.miniText}>+</Text></Pressable>
            </>
          )}
          <ClipButtons item={item} disabled={busy} />
          <Pressable disabled={busy} onPress={remove} style={[styles.miniBtn, styles.delBtn]}><Text style={[styles.miniText, { color: colors.danger }]}>Sil</Text></Pressable>
          {busy && <ActivityIndicator size="small" color={colors.accent} />}
        </View>
      </View>
    </View>
  )
}

// Her açılış yeni bir key → form durumu temiz başlar (efektle sıfırlamaya gerek yok)
export function TileSheet() {
  const tile = useStore((s) => s.tileSheet)
  const close = useStore((s) => s.closeTileSheet)
  if (!tile) return null
  return <TileSheetBody key={tile.openedAt} tile={tile} close={close} />
}

function TileSheetBody({ tile, close }) {
  const worldMedia = useStore((s) => s.worldMedia)
  const { updateMedia } = useStore.getState()
  const tileMedia = worldMedia.filter((m) => String(m.tileId) === String(tile.id))

  // Medya sayfasından "Düzenle" ile gelindiyse doğrudan o metin açılır
  const initialEdit = tile.editId ? worldMedia.find((m) => m.id === tile.editId && m.type === 'markdown') ?? null : null
  const [mode, setMode] = useState(initialEdit ? 'text' : 'image')
  const [busy, setBusy] = useState(false)

  const image = useImageForm({ tile, close, active: mode === 'image', setBusy })
  const video = useVideoForm({ tile, close, active: mode === 'video', setBusy })
  const text = useTextForm({ tile, close, active: mode === 'text', initialEdit, setBusy })
  const canvas = useCanvasForm({ tile, close, active: mode === 'canvas', setBusy })
  const form = { image, video, text, canvas }[mode]

  const editText = (item) => { setMode('text'); text.edit(item) }

  return (
    <Sheet
      visible
      tall
      onClose={busy ? () => {} : close}
      eyebrow={`${KIND_LABEL[tile.kind] ?? 'Duvar'} · ${tile.id}`}
      title={form.title}
      footer={form.footer}
    >
      <PasteBanner tile={tile} close={close} busy={busy} setBusy={setBusy} />
      {tileMedia.length > 0 && (
        <>
          <SectionLabel>{`Bu tile'da · ${tileMedia.length}`}</SectionLabel>
          {tileMedia.map((m) => (
            <ExistingItem key={m.id} item={m} onChanged={updateMedia} onEdit={editText} />
          ))}
        </>
      )}

      {!text.editing && (
        <View style={styles.modes} accessibilityRole="tablist">
          {[['image', 'Resim'], ['video', 'Video'], ['text', 'Metin'], ['canvas', 'Canvas']].map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => !busy && setMode(id)}
              style={[styles.mode, mode === id && styles.modeOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === id }}
            >
              <Text style={[styles.modeText, mode === id && styles.modeTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {form.body}
    </Sheet>
  )
}

// --- Resim -------------------------------------------------------------------

function useImageForm({ tile, close, active, setBusy }) {
  const { addMedia } = useStore.getState()
  const [source, setSource] = useState(null) // { kind, preview, file?, remote?, ratio }
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [width, setWidth] = useState(DEFAULT_HEIGHT)
  const [locked, setLocked] = useState(true)
  const [link, setLink] = useState('')
  const [step, setStep] = useState(null) // null | 'preparing' | 'downloading' | 'uploading'
  const [error, setError] = useState(null)

  const choose = (next) => {
    const s = sizeFromRatio(next.ratio, DEFAULT_HEIGHT)
    setSource(next); setError(null); setLocked(true)
    setHeight(s.height); setWidth(s.width)
  }

  const fromAsset = (asset, kind) => {
    if (!asset) return
    choose({ kind, preview: asset.uri, ratio: asset.width / asset.height || 1, asset })
  }

  const pickGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      // iOS: orijinal dosya — yoksa GIF JPEG'e çevrilip animasyon kaybolur (HEIC'i prepareLocalImage çevirir)
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    })
    if (!r.canceled) fromAsset(r.assets?.[0], 'gallery')
  }

  const pickCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { setError('Kamera izni verilmedi.'); return }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
    if (!r.canceled) fromAsset(r.assets?.[0], 'camera')
  }

  // Pano: önce görsel, yoksa bağlantı metni
  const pickClipboard = async () => {
    setError(null)
    try {
      if (await Clipboard.hasImageAsync()) {
        const img = await Clipboard.getImageAsync({ format: 'png' })
        if (img?.data) {
          const uri = await clipboardImageToFile(img.data)
          const { width: w, height: h } = img.size?.width ? img.size : await imageSize(uri)
          fromAsset({ uri, width: w, height: h, fileName: uri.split('/').pop(), mimeType: 'image/png' }, 'clipboard')
          return
        }
      }
      const text = (await Clipboard.getStringAsync()).trim()
      if (isHttp(text)) { setLink(text); await loadLink(text); return }
      setError('Panoda görsel ya da bağlantı yok.')
    } catch (e) {
      setError(`Pano okunamadı: ${e.message}`)
    }
  }

  const loadLink = async (value = link) => {
    const url = value.trim()
    if (!isHttp(url)) { setError('Geçerli bir http(s) bağlantısı gir.'); return }
    setError(null)
    try {
      const { width: w, height: h } = await imageSize(url)
      choose({ kind: 'link', preview: url, ratio: w / h || 1, remote: url })
    } catch {
      setError('Bu bağlantıda görsel bulunamadı.')
    }
  }

  const setH = (h) => { setHeight(h); if (locked && source) setWidth(clamp(h * source.ratio)) }
  const setW = (w) => { setWidth(w); if (locked && source) setHeight(clamp(w / source.ratio)) }
  const toggleLock = () => {
    const next = !locked
    setLocked(next)
    if (next && source) setWidth(clamp(height * source.ratio))
  }

  const apply = async () => {
    if (!source || step) return
    setError(null)
    setBusy(true)
    try {
      let src
      if (source.remote) {
        setStep('downloading')
        src = { url: await fetchUrlToServer(source.remote) }
      } else {
        setStep('preparing')
        src = { file: await prepareLocalImage(source.asset) }
      }
      setStep('uploading')
      const roomId = useStore.getState().currentRoomId
      const media = await addImageToTile({ tile, source: src, width, height, roomId })
      addMedia(media)
      close()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setStep(null)
      setBusy(false)
    }
  }

  if (!active) return { title: 'Resim as' }

  const stepLabel = { preparing: 'Hazırlanıyor', downloading: 'Sunucu indiriyor', uploading: 'Yükleniyor' }[step]
  const footer = (
    <Cta
      error={error}
      onPress={apply}
      disabled={!source || !!step}
      busyLabel={step && `${stepLabel}…`}
      label={source ? 'Duvara as' : 'Önce bir görsel seç'}
    />
  )

  const body = (
    <>
      <SectionLabel>Kaynak</SectionLabel>
      <View style={styles.sources}>
        <SourceTile glyph="▦" label="Galeri" onPress={pickGallery} active={source?.kind === 'gallery'} />
        <SourceTile glyph="◉" label="Kamera" onPress={pickCamera} active={source?.kind === 'camera'} />
        <SourceTile glyph="⎘" label="Pano" onPress={pickClipboard} active={source?.kind === 'clipboard'} />
      </View>
      <View style={styles.linkRow}>
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="veya görsel bağlantısı (https://…)"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={() => loadLink()}
          style={[styles.linkInput, source?.kind === 'link' && { borderColor: colors.accent }]}
        />
        <Pressable onPress={() => loadLink()} disabled={!link.trim()} style={[styles.linkBtn, !link.trim() && { opacity: 0.4 }]}>
          <Text style={styles.linkBtnText}>Getir</Text>
        </Pressable>
      </View>

      <SectionLabel>Duvarda</SectionLabel>
      <WallFit row={tile.row ?? 0} width={width} height={height} uri={source?.preview} />

      <View style={styles.sizeRow}>
        <Stepper label="Yükseklik" value={height} onChange={setH} />
        <Pressable onPress={toggleLock} style={[styles.lock, locked && styles.lockOn]} accessibilityRole="switch" accessibilityState={{ checked: locked }} accessibilityLabel="En-boy oranını kilitle">
          <Text style={[styles.lockText, locked && { color: colors.accentInk }]}>{locked ? '🔗' : '⛓︎'}</Text>
        </Pressable>
        <Stepper label="Genişlik" value={width} onChange={setW} hint={locked ? 'orana bağlı' : 'serbest'} />
      </View>
    </>
  )
  return { title: 'Resim as', body, footer }
}

// --- Video -------------------------------------------------------------------

function useVideoForm({ tile, close, active, setBusy }) {
  const { addMedia } = useStore.getState()
  const [source, setSource] = useState(null) // { kind, poster, ratio, duration, size, file?, remote? }
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [width, setWidth] = useState(DEFAULT_HEIGHT)
  const [locked, setLocked] = useState(true)
  const [link, setLink] = useState('')
  const [step, setStep] = useState(null) // null | 'probing' | 'downloading' | 'uploading'
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)

  const choose = (next) => {
    const s = sizeFromRatio(next.ratio, DEFAULT_HEIGHT)
    setSource(next); setError(null); setLocked(true)
    setHeight(s.height); setWidth(s.width)
  }

  // Ölçü + önizleme karesi Skia'nın yerel çözücüsünden (dik çekimde yön düzeltilmiş)
  const probe = async (url, extra, fallbackRatio) => {
    setStep('probing')
    try {
      const p = await probeVideo(url)
      choose({ ...extra, poster: p.poster, ratio: p.ratio, duration: p.duration, size: `${p.width} × ${p.height}` })
    } catch {
      if (!fallbackRatio) throw new Error('Video açılamadı (biçim desteklenmiyor olabilir).')
      choose({ ...extra, poster: null, ratio: fallbackRatio, duration: 0, size: null })
    } finally {
      setStep(null)
    }
  }

  const fromAsset = async (asset, kind) => {
    if (!asset) return
    setError(null)
    try {
      await probe(asset.uri, { kind, file: videoFile(asset) }, asset.width && asset.height ? asset.width / asset.height : null)
    } catch (e) { setError(e.message) }
  }

  const pickGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      // iOS: dosya olduğu gibi (yeniden kodlama / sıkıştırma yok)
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    })
    if (!r.canceled) fromAsset(r.assets?.[0], 'gallery')
  }

  const pickCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { setError('Kamera izni verilmedi.'); return }
    const r = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
    })
    if (!r.canceled) fromAsset(r.assets?.[0], 'camera')
  }

  // Bağlantı: sunucu indirir (web ile aynı), önizleme sunucudaki kopyadan
  const loadLink = async (value = link) => {
    const url = value.trim()
    if (!/^https?:\/\/\S+$/i.test(url)) { setError('Geçerli bir http(s) bağlantısı gir.'); return }
    setError(null)
    setBusy(true)
    setStep('downloading')
    try {
      const local = await fetchVideoToServer(url)
      await probe(local, { kind: 'link', remote: local }, 16 / 9)
    } catch (e) {
      setError(e.message || String(e))
      setStep(null)
    } finally {
      setBusy(false)
    }
  }

  const setH = (h) => { setHeight(h); if (locked && source) setWidth(clamp(h * source.ratio)) }
  const setW = (w) => { setWidth(w); if (locked && source) setHeight(clamp(w / source.ratio)) }
  const toggleLock = () => {
    const next = !locked
    setLocked(next)
    if (next && source) setWidth(clamp(height * source.ratio))
  }

  const apply = async () => {
    if (!source || step) return
    setError(null)
    setBusy(true)
    setStep('uploading')
    setProgress(0)
    try {
      const roomId = useStore.getState().currentRoomId
      const src = source.remote ? { url: source.remote } : { file: source.file }
      const media = await addVideoToTile({ tile, source: src, width, height, roomId, onProgress: setProgress })
      addMedia(media)
      close()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setStep(null)
      setBusy(false)
    }
  }

  if (!active) return { title: 'Video as' }

  const busyLabel = step === 'uploading' ? `Yükleniyor… ${Math.round(progress * 100)}%`
    : step === 'downloading' ? 'Sunucu indiriyor…' : step === 'probing' ? 'Video okunuyor…' : null
  const footer = (
    <Cta error={error} onPress={apply} disabled={!source || !!step} busyLabel={busyLabel} label={source ? 'Duvara as' : 'Önce bir video seç'} />
  )
  const body = (
    <>
      <SectionLabel>Kaynak</SectionLabel>
      <View style={styles.sources}>
        <SourceTile glyph="▦" label="Galeri" onPress={pickGallery} active={source?.kind === 'gallery'} />
        <SourceTile glyph="◉" label="Kamera" onPress={pickCamera} active={source?.kind === 'camera'} />
      </View>
      <View style={styles.linkRow}>
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="veya video dosyası bağlantısı (…/video.mp4)"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={() => loadLink()}
          style={[styles.linkInput, source?.kind === 'link' && { borderColor: colors.accent }]}
        />
        <Pressable onPress={() => loadLink()} disabled={!link.trim() || !!step} style={[styles.linkBtn, (!link.trim() || step) && { opacity: 0.4 }]}>
          <Text style={styles.linkBtnText}>Getir</Text>
        </Pressable>
      </View>

      <SectionLabel>Duvarda</SectionLabel>
      <WallFit row={tile.row ?? 0} width={width} height={height} uri={source?.poster ?? undefined} color={source && !source.poster ? '#111114' : undefined} />
      {!!source && (
        <Text style={styles.note}>
          {[source.size, source.duration ? formatTime(source.duration) : null, source.poster ? null : 'önizleme karesi alınamadı'].filter(Boolean).join(' · ')}
          {' — dokununca sesli izlenir.'}
        </Text>
      )}

      <View style={styles.sizeRow}>
        <Stepper label="Yükseklik" value={height} onChange={setH} />
        <Pressable onPress={toggleLock} style={[styles.lock, locked && styles.lockOn]} accessibilityRole="switch" accessibilityState={{ checked: locked }} accessibilityLabel="En-boy oranını kilitle">
          <Text style={[styles.lockText, locked && { color: colors.accentInk }]}>{locked ? '🔗' : '⛓︎'}</Text>
        </Pressable>
        <Stepper label="Genişlik" value={width} onChange={setW} hint={locked ? 'orana bağlı' : 'serbest'} />
      </View>
    </>
  )
  return { title: 'Video as', body, footer }
}

// --- Metin -------------------------------------------------------------------

const PREVIEW_COLS = 3       // önizlemede gösterilen en fazla sütun
const PREVIEW_SCALE = 0.45   // önizleme çözünürlüğü (duvardaki çizimin oranı)
const PREVIEW_DELAY = 350    // yazarken önizleme gecikmesi (ms)

// Duvardaki çizimin küçük bir kopyası + metnin kapladığı sütun sayısı
function useTextPreview(text, enabled) {
  const [preview, setPreview] = useState(null) // { uri, cols, shown }
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const timer = setTimeout(() => {
      enqueueRender((R) => {
        if (!alive) return
        const cols = Math.round(R.measureWidth(text) / 3)
        const shown = Math.min(cols, PREVIEW_COLS)
        const [chunk] = R.render(text, shown * 3, MD.HEIGHT, { scale: PREVIEW_SCALE, keepImage: true })
        const uri = `data:image/png;base64,${chunk.image.encodeToBase64()}`
        chunk.image.dispose?.()
        if (alive) setPreview({ uri, cols, shown })
      }).catch(() => {})
    }, PREVIEW_DELAY)
    return () => { alive = false; clearTimeout(timer) }
  }, [text, enabled])
  return preview
}

const TOOLS = [
  { label: 'Başlık', line: '## ' },
  { label: 'Kalın', wrap: '**', hint: 'kalın' },
  { label: 'İtalik', wrap: '_', hint: 'italik' },
  { label: 'Liste', line: '- ' },
  { label: 'Görev', line: '- [ ] ' },
  { label: 'Kod', wrap: '`', hint: 'kod' },
]

function useTextForm({ tile, close, active, initialEdit, setBusy }) {
  const { addMedia, updateMedia } = useStore.getState()
  const { contentWidth: previewW } = useSheetLayout()
  const [editing, setEditing] = useState(initialEdit)
  const [text, setText] = useState(initialEdit?.content ?? '')
  const [step, setStep] = useState(null) // null | 'saving'
  const [error, setError] = useState(null)
  const sel = useRef({ start: 0, end: 0 })
  const preview = useTextPreview(text, active)

  const edit = (item) => { setEditing(item); setText(item.content ?? ''); setError(null) }

  const insert = (tool) => {
    const { start, end } = sel.current
    const a = Math.min(start, text.length)
    const b = Math.min(end, text.length)
    if (tool.line) {
      const lineStart = text.lastIndexOf('\n', a - 1) + 1
      setText(text.slice(0, lineStart) + tool.line + text.slice(lineStart))
    } else {
      const inner = text.slice(a, b) || tool.hint
      setText(text.slice(0, a) + tool.wrap + inner + tool.wrap + text.slice(b))
    }
  }

  const paste = async () => {
    const clip = await Clipboard.getStringAsync().catch(() => '')
    if (!clip) { setError('Panoda metin yok.'); return }
    const { start, end } = sel.current
    setText(text.slice(0, start) + clip + text.slice(end))
    setError(null)
  }

  const apply = async () => {
    if (!text.trim() || step) return
    setError(null)
    setStep('saving')
    setBusy(true)
    try {
      const need = await enqueueRender((R) => R.measureWidth(text))
      if (editing) {
        // Web gibi: metin uzadıysa tile sütun sütun genişler, elle verilen genişlik küçültülmez
        const body = need > editing.width ? { content: text, width: need } : { content: text }
        updateMedia(await updateMediaContent(editing.id, body))
      } else {
        const roomId = useStore.getState().currentRoomId
        addMedia(await addTextToTile({ tile, content: text, width: need, height: MD.HEIGHT, roomId }))
      }
      close()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setStep(null)
      setBusy(false)
    }
  }

  const title = editing ? 'Metni düzenle' : 'Metin yaz'
  if (!active) return { title, edit, editing }

  const cols = preview?.cols ?? 1
  const wallWidth = editing ? Math.max(editing.width, cols * 3) : cols * 3
  const previewH = preview ? previewW / ((preview.shown * MD.COL_PX) / (MD.HEIGHT * MD.PX_PER_UNIT)) : 0

  const footer = (
    <Cta
      error={error}
      onPress={apply}
      disabled={!text.trim() || !!step}
      busyLabel={step && 'Kaydediliyor…'}
      label={!text.trim() ? 'Önce bir şey yaz' : editing ? 'Kaydet' : 'Duvara yaz'}
    />
  )

  const body = (
    <>
      <SectionLabel>Metin · markdown</SectionLabel>
      <View style={styles.tools}>
        {TOOLS.map((t) => (
          <Pressable key={t.label} onPress={() => insert(t)} style={styles.tool} hitSlop={4}>
            <Text style={[styles.toolText, t.label === 'Kalın' && { fontFamily: fonts.strong }]}>{t.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={paste} style={styles.tool} hitSlop={4}>
          <Text style={styles.toolText}>⎘ Pano</Text>
        </Pressable>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        onSelectionChange={(e) => { sel.current = e.nativeEvent.selection }}
        multiline
        textAlignVertical="top"
        placeholder={'# Başlık\nDüz metin, **kalın**, _italik_\n- madde'}
        placeholderTextColor={colors.faint}
        autoCapitalize="sentences"
        style={styles.editor}
      />

      <SectionLabel>{`Duvarda · ${cols} sütun · ${wallWidth} × ${MD.HEIGHT}`}</SectionLabel>
      {preview ? (
        <>
          <Image source={{ uri: preview.uri }} style={{ width: previewW, height: previewH, borderRadius: radius.sm }} resizeMode="contain" />
          {preview.cols > preview.shown && (
            <Text style={styles.previewNote}>{`İlk ${preview.shown} sütun gösteriliyor · toplam ${preview.cols}`}</Text>
          )}
        </>
      ) : (
        <View style={[styles.previewEmpty, { width: previewW }]}><ActivityIndicator color={colors.muted} /></View>
      )}
      <View style={{ marginTop: space.md }}>
        <WallFit row={tile.row ?? 0} width={wallWidth} height={MD.HEIGHT} uri={preview && preview.cols === preview.shown ? preview.uri : undefined} />
      </View>
    </>
  )
  return { title, body, footer, edit, editing }
}

// --- Canvas ------------------------------------------------------------------

// Web varsayılanı #1a1a2e; yanına birkaç koyu ton ve bir açık zemin
const CANVAS_BGS = ['#1a1a2e', '#0f172a', '#111827', '#1f2937', '#14281f', '#2a1520', '#f4f1ea']
const CANVAS_W = 10 // web varsayılanı 10 × 5
const CANVAS_H = 5

function useCanvasForm({ tile, close, active, setBusy }) {
  const { addMedia } = useStore.getState()
  const [bg, setBg] = useState(CANVAS_BGS[0])
  const [width, setWidth] = useState(CANVAS_W)
  const [height, setHeight] = useState(CANVAS_H)
  const [step, setStep] = useState(null)
  const [error, setError] = useState(null)

  const apply = async () => {
    if (step) return
    setError(null)
    setStep('saving')
    setBusy(true)
    try {
      const roomId = useStore.getState().currentRoomId
      addMedia(await addCanvasToTile({ tile, width, height, bg, roomId }))
      close()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setStep(null)
      setBusy(false)
    }
  }

  if (!active) return { title: 'Canvas oluştur' }

  const footer = (
    <Cta error={error} onPress={apply} disabled={!!step} busyLabel={step && 'Oluşturuluyor…'} label="Canvas oluştur" />
  )
  const body = (
    <>
      <SectionLabel>Arka plan</SectionLabel>
      <View style={styles.swatches}>
        {CANVAS_BGS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setBg(c)}
            style={[styles.swatch, { backgroundColor: c }, bg === c && styles.swatchOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: bg === c }}
            accessibilityLabel={`Arka plan ${c}`}
          />
        ))}
      </View>

      <SectionLabel>{`Duvarda · ${width} × ${height}`}</SectionLabel>
      <WallFit row={tile.row ?? 0} width={width} height={height} color={bg} />
      <View style={styles.sizeRow}>
        <Stepper label="Yükseklik" value={height} onChange={setHeight} />
        <Stepper label="Genişlik" value={width} onChange={setWidth} />
      </View>
      <Text style={styles.note}>
        {"Canvas boş oluşur. Resim, metin ve oda bağlantılarını şimdilik bilgisayarda canvas'a çift tıklayarak eklersin; telefonda odaya yeniden girince görünür."}
      </Text>
    </>
  )
  return { title: 'Canvas oluştur', body, footer }
}

function Cta({ error, onPress, disabled, busyLabel, label }) {
  return (
    <View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [styles.cta, disabled && !busyLabel && styles.ctaOff, pressed && { transform: [{ scale: 0.99 }] }]}
        accessibilityRole="button"
      >
        {busyLabel ? (
          <View style={styles.ctaRow}><ActivityIndicator color={colors.accentInk} /><Text style={styles.ctaText}>{busyLabel}</Text></View>
        ) : (
          <Text style={[styles.ctaText, disabled && { color: colors.muted }]}>{label}</Text>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.pill, padding: 4, marginTop: space.sm, marginBottom: space.xs },
  mode: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  modeOn: { backgroundColor: colors.surfaceHi },
  modeText: { fontFamily: fonts.body, fontSize: type.body, color: colors.muted },
  modeTextOn: { fontFamily: fonts.strong, color: colors.text },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.line },
  swatchOn: { borderColor: colors.accent, transform: [{ scale: 1.08 }] },
  note: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: type.caption * 1.5, color: colors.muted, marginTop: space.md },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2, marginBottom: space.sm },
  tool: { height: 32, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.surfaceHi, justifyContent: 'center' },
  toolText: { fontFamily: fonts.body, fontSize: type.caption + 1, color: colors.text },
  editor: {
    minHeight: 190, maxHeight: 340, borderRadius: radius.md, backgroundColor: colors.bg, color: colors.text,
    padding: space.md, fontFamily: fonts.mono, fontSize: 14, lineHeight: 21,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  previewEmpty: { height: 120, borderRadius: radius.sm, backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center' },
  previewNote: { fontFamily: fonts.body, fontSize: type.micro + 1, color: colors.faint, marginTop: space.xs },
  thumbText: { alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontFamily: fonts.display, fontSize: type.heading + 3, color: '#1d1b18' },
  sources: { flexDirection: 'row', gap: space.sm },
  source: {
    flex: 1, height: 84, borderRadius: radius.md, backgroundColor: colors.surfaceHi,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'transparent',
  },
  sourceActive: { borderColor: colors.accent, backgroundColor: 'rgba(0,242,255,0.06)' },
  sourceGlyph: { fontSize: 24, color: colors.text, fontFamily: fonts.bodyThin },
  sourceLabel: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text },
  linkRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  linkInput: {
    flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.bg, color: colors.text,
    paddingHorizontal: space.md, fontFamily: fonts.body, fontSize: type.body - 1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  linkBtn: { height: 46, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: colors.surfaceHi, justifyContent: 'center' },
  linkBtnText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  stepper: { flex: 1, backgroundColor: colors.surfaceHi, borderRadius: radius.md, padding: space.md },
  stepLabel: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 1.2, color: colors.faint, textTransform: 'uppercase' },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: colors.text, fontSize: 18, fontFamily: fonts.strong, marginTop: -2 },
  stepValue: { fontFamily: fonts.display, fontSize: type.heading + 3, color: colors.text },
  stepHint: { fontFamily: fonts.body, fontSize: type.micro, color: colors.faint, marginTop: 4, textAlign: 'center' },
  lock: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center' },
  lockOn: { backgroundColor: colors.accent },
  lockText: { fontSize: 16, color: colors.muted },
  existing: { flexDirection: 'row', gap: space.md, backgroundColor: colors.surfaceHi, borderRadius: radius.md, padding: space.sm, marginBottom: space.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.bg },
  existingName: { fontFamily: fonts.strong, fontSize: type.caption + 1, color: colors.text },
  existingMeta: { fontFamily: fonts.body, fontSize: type.micro + 1, color: colors.muted, marginTop: 2 },
  existingActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  copyOn: { backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1, borderColor: CLIP_COPY },
  cutOn: { backgroundColor: 'rgba(245,158,11,0.15)', borderWidth: 1, borderColor: CLIP_CUT },
  paste: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginBottom: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(96,165,250,0.45)', backgroundColor: 'rgba(96,165,250,0.08)',
  },
  pasteCut: { borderColor: 'rgba(245,158,11,0.5)', backgroundColor: 'rgba(245,158,11,0.08)' },
  pasteText: { fontFamily: fonts.body, fontSize: type.caption + 1, color: colors.muted },
  pasteStrong: { fontFamily: fonts.strong, color: colors.text },
  pasteError: { fontFamily: fonts.body, fontSize: type.micro + 1, color: colors.danger, marginTop: 4 },
  pasteBtn: { height: 38, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', minWidth: 92 },
  pasteBtnText: { fontFamily: fonts.strong, fontSize: type.caption + 1, color: colors.accentInk },
  pasteClose: { fontFamily: fonts.strong, fontSize: type.body, color: colors.faint },
  miniBtn: { minWidth: 32, height: 28, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  miniText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text },
  delBtn: { backgroundColor: 'rgba(248,113,113,0.12)' },
  error: { fontFamily: fonts.body, fontSize: type.caption, color: colors.danger, marginBottom: space.sm },
  cta: { height: 54, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { backgroundColor: colors.line },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ctaText: { fontFamily: fonts.strong, fontSize: type.body + 1, color: colors.accentInk },
})
