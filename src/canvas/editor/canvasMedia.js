// Canvas'a resim ekleme ve yapıştırma hattı — web canvasUtils karşılığı:
// uploadImageFile, layoutImageGrid, copyItemAssets, placeClipItems, buildPasteItems
// (metin / bağlantı / YouTube / Instagram / resim bağlantısı), saveImageItem,
// copyImageToClipboard. Öğeler state'e dokunmadan üretilir; ekleme düzenleyicide.
import * as FileSystem from 'expo-file-system/legacy'
import * as Clipboard from 'expo-clipboard'
import { api, assetUrl } from '../../api/client'
import { clipboardImageToFile, fetchUrlToServer, imageSize, prepareLocalImage, uploadCanvasImage } from '../../api/media'
import { removeTileMedia } from '../../api/tileClipboard'
import { useStore } from '../../store/useStore'
import { itemBox } from '../render'
import { newId } from './roomLink'

export const MAX_IMG_W = 800
const GRID_GAP = 24
const UPLOADS_AT_ONCE = 3

const isHttp = (s) => /^https?:\/\/\S+$/i.test(String(s).trim())

/** Doğal ölçü → canvas ölçüsü (web: genişlik en fazla 800, oran korunur) */
export function fitImage(w, h) {
  if (!(w > 0 && h > 0)) return { w: MAX_IMG_W, h: Math.round((MAX_IMG_W * 9) / 16) }
  const iw = Math.min(MAX_IMG_W, w)
  return { w: Math.round(iw), h: Math.round((iw * h) / w) }
}

// Web layoutImageGrid: ~kare ızgara, satır satır; blok pt'ye ortalanır → sol-üst köşeler
export function layoutImageGrid(sizes, pt) {
  const cols = Math.ceil(Math.sqrt(sizes.length))
  const rows = []
  for (let i = 0; i < sizes.length; i += cols) rows.push(sizes.slice(i, i + cols))
  const rowH = rows.map((r) => Math.max(...r.map((s) => s.h)))
  let y = pt.y - (rowH.reduce((a, b) => a + b, 0) + GRID_GAP * (rows.length - 1)) / 2
  return rows.flatMap((r, ri) => {
    let x = pt.x - (r.reduce((a, s) => a + s.w, 0) + GRID_GAP * (r.length - 1)) / 2
    const out = r.map((s) => {
      const p = { x: Math.round(x), y: Math.round(y + (rowH[ri] - s.h) / 2) }
      x += s.w + GRID_GAP
      return p
    })
    y += rowH[ri] + GRID_GAP
    return out
  })
}

/** [{ url, w, h }] → pt'ye ortalanmış ızgarada resim öğeleri */
export function imageItemsAt(sized, pt) {
  const pos = layoutImageGrid(sized, pt)
  return sized.map((s, i) => ({ id: newId(), type: 'image', x: pos[i].x, y: pos[i].y, w: s.w, h: s.h, url: s.url }))
}

/** Tek öğeyi pt'ye ortala */
const centered = (it, pt) => ({ ...it, x: Math.round(pt.x - it.w / 2), y: Math.round(pt.y - it.h / 2) })

/**
 * Seçilen yerel görselleri (galeri / kamera) yükler; sıra korunur, biri düşerse
 * diğerleri sürer. → { sized: [{url,w,h}], failed }
 */
export async function uploadAssets(mediaId, assets, onProgress = () => {}) {
  const out = new Array(assets.length).fill(null)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < assets.length) {
      const i = next++
      try {
        const file = await prepareLocalImage(assets[i])
        const url = await uploadCanvasImage(mediaId, file)
        out[i] = { url, ...fitImage(file.width ?? assets[i].width, file.height ?? assets[i].height) }
      } catch (err) {
        if (__DEV__) console.warn('[canvas] resim yüklenemedi', err?.message ?? err)
      }
      onProgress(++done, assets.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, assets.length) }, worker))
  const sized = out.filter(Boolean)
  return { sized, failed: assets.length - sized.length }
}

/**
 * Bağlantıdaki görsel → { url, w, h } | null (görsel değil). Görsel sunucuya
 * indirilir (kaynak silinse / hotlink engellese de canvas'ta kalsın, duvarda GIF
 * oynayabilsin); indirilemezse web gibi bağlantının kendisi kullanılır.
 */
export async function imageFromUrl(url) {
  const size = await imageSize(url).catch(() => null)
  if (!size) return null
  const local = await fetchUrlToServer(url).catch(() => null)
  return { url: local ?? url, ...fitImage(size.width, size.height) }
}

// --- Bağlantı kartları (web buildPasteItems / buildInstaItem) ---------------------

export const isInstaUrl = (text) => {
  try {
    const u = new URL(text)
    return /(^|\.)instagram\.com$/i.test(u.hostname) && /\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/i.test(u.pathname)
  } catch { return false }
}

const youtubeId = (text) => {
  try {
    const u = new URL(text)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || u.pathname.match(/\/shorts\/([\w-]+)/)?.[1] || null
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0] || null
  } catch { /* bağlantı değil */ }
  return null
}

async function linkMeta(url) {
  let host = ''
  try { host = new URL(url).hostname } catch { /* geçersiz */ }
  try {
    const d = await api(`/api/link-meta?url=${encodeURIComponent(url)}`, { timeout: 15000 })
    return { title: d?.title || '', thumbUrl: d?.image || '', siteName: d?.siteName || host }
  } catch {
    return { title: '', thumbUrl: '', siteName: host }
  }
}

export async function buildInstaItem(url, pt) {
  const m = await linkMeta(url)
  return centered({ id: newId(), type: 'insta', w: 320, h: 560, url, thumbUrl: m.thumbUrl, title: m.title, siteName: m.siteName || 'instagram' }, pt)
}

async function buildYoutubeItem(url, videoId, pt) {
  let title = ''
  let thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  try {
    const d = await api(`/api/youtube-meta?url=${encodeURIComponent(url)}`, { timeout: 15000 })
    title = d?.title || ''
    if (d?.thumbnail_url) thumbUrl = d.thumbnail_url
  } catch { /* başlıksız kart */ }
  return centered({ id: newId(), type: 'youtube', w: 480, h: 270, url, videoId, thumbUrl, title }, pt)
}

async function buildLinkItem(url, pt) {
  return centered({ id: newId(), type: 'link', w: 480, h: 300, url, ...(await linkMeta(url)) }, pt)
}

/**
 * Metin / bağlantı → öğe (web buildPasteItems'ın metin dalı). textHeight: çizicinin
 * metin yüksekliği ölçüsü (seçim çerçevesi içerikle örtüşsün).
 */
export async function itemFromText(text, pt, textHeight) {
  const s = text.trim()
  if (!s) return null
  const yt = youtubeId(s)
  if (yt) return buildYoutubeItem(s, yt, pt)
  if (isInstaUrl(s)) return buildInstaItem(s, pt)
  if (isHttp(s)) {
    let pathname = ''
    try { pathname = new URL(s).pathname } catch { /* geçersiz */ }
    if (/\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(pathname)) {
      const img = await imageFromUrl(s)
      if (img) return centered({ id: newId(), type: 'image', ...img }, pt)
    }
    return buildLinkItem(s, pt) // görsel açılmadı (hotlink / ölü bağlantı) → bağlantı kartı
  }
  const it = { id: newId(), type: 'text', w: 500, h: 220, content: s, fontSize: 30 }
  it.h = textHeight ? textHeight(it) : 220
  return centered(it, pt)
}

// --- Pano kaynakları ---------------------------------------------------------------

// Başka yüzeye yapıştırırken /uploads altındaki dosyaları çoğaltır (web copyItemAssets):
// kaynak öğe silinince (dosyası da silinir) kopya kırık kalmasın.
export async function copyItemAssets(items) {
  const urls = items.flatMap((it) => {
    const out = []
    if ((it.type === 'image' || it.type === 'music' || it.type === 'pdf') && it.url?.startsWith('/uploads/')) out.push(it.url)
    if (it.type === 'music' && it.coverUrl?.startsWith('/uploads/')) out.push(it.coverUrl)
    if (it.type === 'note') for (const u of it.images || []) if (u.startsWith('/uploads/')) out.push(u)
    return out
  })
  if (!urls.length) return items
  const d = await api('/api/canvas/copy-images', { method: 'POST', body: { urls }, timeout: 30000 })
  const m = d?.mapping
  if (!m) return items
  return items.map((it) => {
    if ((it.type === 'image' || it.type === 'pdf') && m[it.url]) return { ...it, url: m[it.url] }
    if (it.type === 'music') return { ...it, ...(m[it.url] ? { url: m[it.url] } : {}), ...(m[it.coverUrl] ? { coverUrl: m[it.coverUrl] } : {}) }
    if (it.type === 'note' && it.images?.length) return { ...it, images: it.images.map((u) => m[u] || u) }
    return it
  })
}

// Panodaki öğeleri yeni kimliklerle, sınır kutusu pt'ye ortalanacak şekilde kaydırır (web placeClipItems)
export function placeClipItems(items, pt) {
  const boxes = items.filter((it) => it.type !== 'arrow').map(itemBox)
  let ox = 0
  let oy = 0
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.w))
    const y1 = Math.max(...boxes.map((b) => b.y + b.h))
    ox = pt.x - (x0 + x1) / 2
    oy = pt.y - (y0 + y1) / 2
  }
  return items.map((it) => ({
    ...it,
    id: newId(),
    x: (it.x ?? 0) + ox,
    y: (it.y ?? 0) + oy,
    ...(it.type === 'arrow' ? { x1: it.x1 + ox, y1: it.y1 + oy, x2: it.x2 + ox, y2: it.y2 + oy } : {}),
  }))
}

const plural = (n, one) => (n === 1 ? one : `${n} öğe`)

/**
 * Şu an yapıştırılabilecek kaynaklar (öncelik sırasıyla):
 *   canvas — düzenleyicide Kopyala / Kes ile alınan öğeler (canvas'lar arası)
 *   tile   — duvarda kopyalanan / kesilen resim ya da metin tile'ı
 *   phone  — telefonun panosu (resim, bağlantı ya da metin)
 * → [{ key, label, hint }]
 */
export async function pasteSources() {
  const st = useStore.getState()
  const out = []
  const cc = st.canvasClipboard
  if (cc?.items?.length) {
    const n = cc.items.length
    const kind = n === 1 ? ({ image: 'Resim', text: 'Metin', room: 'Oda linki', link: 'Bağlantı', youtube: 'YouTube', insta: 'Instagram' }[cc.items[0].type] ?? 'Öğe') : `${n} öğe`
    out.push({ key: 'canvas', label: plural(n, kind), hint: cc.mode === 'cut' ? 'kesildi' : 'kopyalandı' })
  }
  const tc = st.tileClipboard
  if (tc && (tc.type === 'image' || tc.type === 'markdown')) {
    out.push({ key: 'tile', label: tc.type === 'image' ? 'Duvardaki resim' : 'Duvardaki metin', hint: tc.mode === 'cut' ? 'kesildi · taşınır' : 'kopyalandı' })
  }
  const [img, str] = await Promise.all([Clipboard.hasImageAsync().catch(() => false), Clipboard.hasStringAsync().catch(() => false)])
  if (img) out.push({ key: 'phone-image', label: 'Telefon panosu', hint: 'resim' })
  else if (str) out.push({ key: 'phone-text', label: 'Telefon panosu', hint: 'bağlantı / metin' })
  return out
}

/** Tile panosundaki medya: önce panoya kopyalanırken alınan anlık bilgi, yoksa bu odadaki satır */
function tileSource(tc) {
  const row = useStore.getState().worldMedia.find((m) => m.id === tc.id)
  return { url: tc.url ?? row?.url, content: tc.content ?? row?.content, width: tc.width ?? row?.width, height: tc.height ?? row?.height }
}

/**
 * Kaynağı pt noktasına yapıştırır → { items, msg } (items düzenleyiciye eklenir).
 * Hata → Error (Türkçe ileti).
 */
export async function pasteFrom(key, { mediaId, pt, textHeight }) {
  const st = useStore.getState()

  if (key === 'canvas') {
    const cc = st.canvasClipboard
    if (!cc?.items?.length) throw new Error('Pano boş')
    // Başka canvas'tan geliyorsa dosyaları çoğalt (kaynak silinince kopya kırılmasın)
    let items = cc.items
    if (String(cc.sourceId) !== String(mediaId)) items = await copyItemAssets(items).catch(() => items)
    // Kesilen öğe bir kez yapıştırılır (web: kes → pano kalır; mobilde kopyala gibi tekrarlanabilir)
    if (cc.mode === 'cut') st.setCanvasClipboard({ ...cc, mode: 'copy', items: cc.items })
    return { items: placeClipItems(items, pt), msg: 'Yapıştırıldı' }
  }

  if (key === 'tile') {
    const tc = st.tileClipboard
    if (!tc) throw new Error('Pano boş')
    const src = tileSource(tc)
    let item
    if (tc.type === 'image') {
      if (!src.url) throw new Error('Kopyalanan resim bulunamadı; duvarda yeniden kopyala.')
      let url = src.url
      if (url.startsWith('/uploads/')) {
        const d = await api('/api/canvas/copy-images', { method: 'POST', body: { urls: [url] }, timeout: 30000 })
        url = d?.mapping?.[url]
        if (!url) throw new Error('Resim dosyası sunucuda bulunamadı')
      }
      const size = await imageSize(assetUrl(url)).catch(() => null)
      const fit = size ? fitImage(size.width, size.height) : fitImage(src.width, src.height)
      item = centered({ id: newId(), type: 'image', url, ...fit }, pt)
    } else {
      if (!src.content) throw new Error('Kopyalanan metin bulunamadı; duvarda yeniden kopyala.')
      const it = { id: newId(), type: 'text', w: 800, h: 220, content: src.content, fontSize: 30, markdown: true }
      it.h = textHeight ? textHeight(it) : 220
      item = centered(it, pt)
    }
    // Kes: duvardaki tile canvas'a taşınır
    if (tc.mode === 'cut') {
      try { await removeTileMedia({ id: tc.id }) } catch (err) {
        st.setTileClipboard(null)
        return { items: [item], msg: `Yapıştırıldı ama duvardaki tile silinemedi (${err.message})` }
      }
      st.setTileClipboard(null)
      return { items: [item], msg: 'Duvardan taşındı' }
    }
    return { items: [item], msg: 'Yapıştırıldı' }
  }

  if (key === 'phone-image') {
    const img = await Clipboard.getImageAsync({ format: 'png' })
    if (!img?.data) throw new Error('Panodaki resim okunamadı')
    const uri = await clipboardImageToFile(img.data)
    const size = img.size?.width ? img.size : await imageSize(uri)
    const url = await uploadCanvasImage(mediaId, { uri, name: uri.split('/').pop(), mime: 'image/png' })
    return { items: [centered({ id: newId(), type: 'image', url, ...fitImage(size.width, size.height) }, pt)], msg: 'Resim yapıştırıldı' }
  }

  if (key === 'phone-text') {
    const text = await Clipboard.getStringAsync()
    const it = await itemFromText(text, pt, textHeight)
    if (!it) throw new Error('Panoda yapıştırılacak metin yok')
    return { items: [it], msg: 'Yapıştırıldı' }
  }

  throw new Error('Bilinmeyen pano kaynağı')
}

// --- Resmi telefona kaydet / panoya kopyala ------------------------------------

const extOf = (url) => (String(url).match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i)?.[1] ?? 'jpg').toLowerCase()

async function downloadToCache(url) {
  const ext = extOf(url).replace('jpeg', 'jpg')
  const dest = `${FileSystem.cacheDirectory}canvas-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { status, uri } = await FileSystem.downloadAsync(assetUrl(url), dest)
  if (status >= 400) throw new Error(`Resim indirilemedi (HTTP ${status})`)
  return uri
}

/** Resmi telefonun galerisine kaydeder (web: indir). GIF animasyonuyla kalır. */
export async function saveImageToPhone(url) {
  // Yalnız kaydederken yüklenir: yerel modül yoksa / uyuşmazsa düzenleyici açılışta düşmesin
  let lib
  try { lib = await import('expo-media-library') } catch { throw new Error('Galeriye kaydetme bu uygulama sürümünde kullanılamıyor') }
  const { Asset, requestPermissionsAsync } = lib
  if (typeof requestPermissionsAsync !== 'function' || typeof Asset?.create !== 'function') throw new Error('Galeriye kaydetme bu uygulama sürümünde kullanılamıyor')
  const perm = await requestPermissionsAsync(true)
  if (!perm.granted) throw new Error('Galeriye kaydetme izni verilmedi')
  const local = await downloadToCache(url)
  try { await Asset.create(local) } finally { FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {}) }
}

/** Resmi görsel olarak telefonun panosuna kopyalar (web: resmi panoya kopyala) */
export async function copyImageToPhone(url) {
  const local = await downloadToCache(url)
  try {
    const b64 = await FileSystem.readAsStringAsync(local, { encoding: FileSystem.EncodingType.Base64 })
    await Clipboard.setImageAsync(b64)
  } finally {
    FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {})
  }
}
