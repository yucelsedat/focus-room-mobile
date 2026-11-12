// Resim ekleme paneli (yatay tam ekran düzenleyici içinde) — web CanvasMesh'teki
// "🖼️ Resim" (bağlantı girişi), resim yapıştırma / sürükle-bırak ve "Tüm resimler" indirme.
//  - Galeri: birden çok resim / GIF seçilir, hepsi yüklenip ızgara olarak dizilir
//  - Kamera: fotoğraf çekilir ve eklenir
//  - Telefon panosu: kopyalanan resim ya da resim bağlantısı
//  - Bağlantı: resim adresi (Instagram gönderisi → dikey kart); görsel sunucuya indirilir
//  - Canvas'taki resimlerin tümü telefonun galerisine kaydedilir
import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Clipboard from 'expo-clipboard'
import { clipboardImageToFile, imageSize, uploadCanvasImage } from '../../api/media'
import { Icon } from '../../components/Icon'
import { colors, fonts, type, space, radius } from '../../theme'
import { buildInstaItem, fitImage, imageFromUrl, imageItemsAt, isInstaUrl, saveImageToPhone, uploadAssets } from './canvasMedia'

const isHttp = (s) => /^https?:\/\/\S+$/i.test(s.trim())
const PICK_LIMIT = 30

export function ImagePanel({ left, mediaId, center, images, onAdd, onClose }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(null) // { label, done?, total? }
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  const run = async (label, job) => {
    if (busy) return
    setError(null)
    setSaved(null)
    setBusy({ label })
    try { await job() } catch (e) { setError(e?.message ?? String(e)) } finally { setBusy(null) }
  }

  const addAssets = (assets) => run('Yükleniyor', async () => {
    const { sized, failed } = await uploadAssets(mediaId, assets, (done, total) => setBusy({ label: 'Yükleniyor', done, total }))
    if (!sized.length) throw new Error('Resimler yüklenemedi. Sunucu açık mı?')
    onAdd(imageItemsAt(sized, center()), failed ? `${sized.length} resim eklendi, ${failed} tanesi yüklenemedi` : `${sized.length > 1 ? `${sized.length} resim` : 'Resim'} eklendi`)
  })

  const pickGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: PICK_LIMIT,
      orderedSelection: true,
      // iOS: orijinal dosya — yoksa GIF JPEG'e çevrilip animasyon kaybolur
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    })
    if (!r.canceled && r.assets?.length) addAssets(r.assets)
  }

  const pickCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { setError('Kamera izni verilmedi.'); return }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
    if (!r.canceled && r.assets?.[0]) addAssets([r.assets[0]])
  }

  const addLink = (value = link) => run('Bağlantı açılıyor', async () => {
    const url = value.trim()
    if (!isHttp(url)) throw new Error('Geçerli bir http(s) bağlantısı gir.')
    if (isInstaUrl(url)) {
      onAdd([await buildInstaItem(url, center())], 'Instagram kartı eklendi')
    } else {
      const img = await imageFromUrl(url)
      if (!img) throw new Error('Bu bağlantıda görsel bulunamadı.')
      onAdd(imageItemsAt([img], center()), 'Resim eklendi')
    }
    setLink('')
  })

  // Pano: önce görsel, yoksa bağlantı
  const fromClipboard = async () => {
    setError(null)
    try {
      if (await Clipboard.hasImageAsync()) {
        await run('Panodaki resim yükleniyor', async () => {
          const img = await Clipboard.getImageAsync({ format: 'png' })
          if (!img?.data) throw new Error('Panodaki resim okunamadı.')
          const uri = await clipboardImageToFile(img.data)
          const size = img.size?.width ? img.size : await imageSize(uri)
          const url = await uploadCanvasImage(mediaId, { uri, name: uri.split('/').pop(), mime: 'image/png' })
          onAdd(imageItemsAt([{ url, ...fitImage(size.width, size.height) }], center()), 'Resim eklendi')
        })
        return
      }
      const text = (await Clipboard.getStringAsync()).trim()
      if (isHttp(text)) { setLink(text); addLink(text); return }
      setError('Panoda resim ya da bağlantı yok.')
    } catch (e) {
      setError(`Pano okunamadı: ${e.message}`)
    }
  }

  const saveAll = () => run('Galeriye kaydediliyor', async () => {
    let ok = 0
    for (let i = 0; i < images.length; i++) {
      setBusy({ label: 'Galeriye kaydediliyor', done: i, total: images.length })
      try { await saveImageToPhone(images[i].url); ok++ } catch (e) {
        if (/izni/.test(e.message)) throw e
      }
    }
    if (!ok) throw new Error('Resimler kaydedilemedi.')
    setSaved(ok === images.length ? `✓ ${ok} resim galeriye kaydedildi` : `${ok}/${images.length} resim kaydedildi, kalanı alınamadı`)
  })

  return (
    <KeyboardAvoidingView style={StyleSheet.absoluteFill} behavior="padding" pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={busy ? undefined : onClose} accessibilityLabel="Kapat" />
      <View style={[styles.panel, { left }]}>
        <View style={styles.head}>
          <Text style={styles.eyebrow}>RESİM EKLE</Text>
          <Pressable onPress={onClose} disabled={!!busy} hitSlop={12} accessibilityRole="button" accessibilityLabel="Kapat">
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.sm }}>
          <View style={styles.sources}>
            <Source icon="gallery" label="Galeri" hint={`birden çok · GIF dahil`} onPress={pickGallery} />
            <Source icon="camera" label="Kamera" hint="fotoğraf çek" onPress={pickCamera} />
            <Source icon="paste" label="Telefon panosu" hint="resim ya da bağlantı" onPress={fromClipboard} />
          </View>

          <Text style={styles.section}>BAĞLANTIDAN</Text>
          <View style={styles.linkRow}>
            <Icon name="link" size={18} color={colors.muted} />
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="Resim, GIF ya da Instagram bağlantısı"
              placeholderTextColor={colors.faint}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => addLink()}
              disableFullscreenUI
              selectionColor={colors.accent}
            />
            <Pressable onPress={() => addLink()} disabled={!link.trim() || !!busy} style={({ pressed }) => [styles.addBtn, (!link.trim() || busy) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Text style={styles.addText}>Ekle</Text>
            </Pressable>
          </View>

          {images.length > 0 && (
            <>
              <Text style={styles.section}>{`CANVAS'TAKİ RESİMLER · ${images.length}`}</Text>
              <Pressable onPress={saveAll} disabled={!!busy} style={({ pressed }) => [styles.saveRow, pressed && styles.pressed]} accessibilityRole="button">
                <Icon name="download" size={18} color={colors.accent} />
                <Text style={styles.saveText}>{images.length > 1 ? `Tümünü galeriye kaydet (${images.length})` : 'Galeriye kaydet'}</Text>
              </Pressable>
            </>
          )}

          {!!saved && <Text style={styles.ok}>{saved}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.tip}>
            {"GIF'ler canvas'ta ve duvarda oynar. Boş bir yere dokunup çıkan yapıştır simgesiyle panodaki resmi tam o noktaya da bırakabilirsin."}
          </Text>
        </ScrollView>
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.busyText}>{busy.total ? `${busy.label} · ${busy.done}/${busy.total}` : `${busy.label}…`}</Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

function Source({ icon, label, hint, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.source, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={26} color="#93c5fd" />
      <Text style={styles.sourceLabel}>{label}</Text>
      <Text style={styles.sourceHint}>{hint}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(5,5,10,0.55)' },
  panel: {
    position: 'absolute', top: space.md, bottom: space.md, right: space.md, maxWidth: 640,
    backgroundColor: 'rgba(12,12,20,0.98)', borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)',
    padding: space.lg, overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  eyebrow: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 2.4, color: colors.muted },
  sources: { flexDirection: 'row', gap: space.md },
  source: { flex: 1, minHeight: 104, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, gap: space.xs },
  sourceLabel: { fontFamily: fonts.strong, fontSize: type.body, color: colors.text, marginTop: space.xs },
  sourceHint: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted },
  section: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 2.4, color: colors.faint, marginTop: space.lg, marginBottom: space.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceHi, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingLeft: space.md, paddingRight: 4 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.text, paddingVertical: Platform.OS === 'ios' ? space.md : space.sm },
  addBtn: { height: 36, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  addText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.accentInk },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  saveText: { fontFamily: fonts.strong, fontSize: type.body, color: colors.text },
  pressed: { backgroundColor: 'rgba(96,165,250,0.12)' },
  ok: { fontFamily: fonts.body, fontSize: type.caption, color: '#4ade80', marginTop: space.md },
  error: { fontFamily: fonts.body, fontSize: type.caption, color: colors.danger, marginTop: space.md },
  tip: { fontFamily: fonts.body, fontSize: type.micro, color: colors.faint, marginTop: space.lg },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,10,0.7)', alignItems: 'center', justifyContent: 'center', gap: space.md },
  busyText: { fontFamily: fonts.mono, fontSize: type.caption, color: colors.text },
})
