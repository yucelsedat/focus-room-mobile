// Medya ekleme / düzenleme — web EditModal'ın kullandığı uç noktalarla aynı:
//   POST /api/fetch-url  { url }            → sunucu dış görseli indirir (CORS yok)
//   POST /api/upload     multipart          → tile'a medya ekler
//   POST /api/add-text   JSON               → tile'a metin (markdown) ekler
//   POST /api/canvas     JSON               → tile'a boş canvas ekler
//   POST /api/media/clone JSON              → başka tile'a kopyala / taşı (kes-yapıştır)
//   PUT  /api/media/:id  { width, height } / { content } → boyut / metin
//   DELETE /api/media/:id
import { Image } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { api, getServerUrl } from './client'

const MAX_SIDE = 2048 // kamera fotoğrafları (12 MP+) duvar için gereksiz büyük

export const DEFAULT_HEIGHT = 5 // web: yükseklik 5 tile, genişlik orandan

export const sizeFromRatio = (ratio, height = DEFAULT_HEIGHT) => ({
  width: Number((height * ratio).toFixed(2)),
  height,
})

export function imageSize(uri) {
  return new Promise((resolve, reject) => Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject))
}

const extOf = (s) => (String(s ?? '').match(/\.([a-z0-9]+)(?:\?|#|$)/i)?.[1] ?? '').toLowerCase()

/**
 * Seçilen yerel görseli yüklemeye hazırlar:
 *  - GIF olduğu gibi kalır (animasyon korunur)
 *  - HEIC/HEIF → JPEG (masaüstü tarayıcılar HEIC gösteremez)
 *  - uzun kenarı MAX_SIDE'ı aşan görsel küçültülür (PNG saydamlığı korunur)
 * → { uri, name, mime, width, height }
 */
export async function prepareLocalImage({ uri, fileName, mimeType, width, height }) {
  const ext = extOf(fileName) || extOf(uri)
  let mime = mimeType || (ext === 'jpg' ? 'image/jpeg' : ext ? `image/${ext}` : 'image/jpeg')
  const isGif = mime === 'image/gif' || ext === 'gif'
  if (isGif) return { uri, name: fileName || `gif-${Date.now()}.gif`, mime: 'image/gif', width, height }

  const isHeic = /heic|heif/.test(mime) || ext === 'heic' || ext === 'heif'
  const tooBig = Math.max(width || 0, height || 0) > MAX_SIDE
  if (!isHeic && !tooBig) {
    return { uri, name: fileName || `img-${Date.now()}.${ext || 'jpg'}`, mime, width, height }
  }

  const png = mime === 'image/png'
  const ctx = ImageManipulator.manipulate(uri)
  if (tooBig) ctx.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE })
  const ref = await ctx.renderAsync()
  const out = await ref.saveAsync({ format: png ? SaveFormat.PNG : SaveFormat.JPEG, compress: 0.9 })
  const base = (fileName || 'img').replace(/\.[^.]+$/, '')
  return {
    uri: out.uri,
    name: `${base}.${png ? 'png' : 'jpg'}`,
    mime: png ? 'image/png' : 'image/jpeg',
    width: out.width,
    height: out.height,
  }
}

// Panodaki görsel (data URI) → geçici PNG dosyası
export async function clipboardImageToFile(dataUri) {
  const base64 = dataUri.replace(/^data:image\/\w+;base64,/, '')
  const uri = `${FileSystem.cacheDirectory}pano-${Date.now()}.png`
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
  return uri
}

// Dış bağlantıyı sunucuya indirt → '/uploads/images/...'
export async function fetchUrlToServer(url) {
  const d = await api('/api/fetch-url', { method: 'POST', body: { url }, timeout: 60000 })
  if (!d?.localUrl) throw new Error(d?.error || 'Bağlantı indirilemedi')
  return d.localUrl
}

const UPLOAD_TIMEOUT = 120000

const parseUpload = (status, text) => {
  let data = {}
  try { data = JSON.parse(text) } catch { /* boş / HTML gövde */ }
  if (status >= 400) throw new Error(data.error || `Yükleme hatası (${status})`)
  return data
}

// Dosya: Expo SDK 58'de global fetch expo/fetch'tir ve RN'nin { uri, name, type }
// FormData parçasını desteklemez ("Unsupported FormDataPart implementation").
// Native yükleyici dosyayı JS belleğine almadan multipart olarak gönderir.
async function uploadMultipart(endpoint, file, fields = {}, { timeout = UPLOAD_TIMEOUT, onProgress } = {}) {
  const task = FileSystem.createUploadTask(endpoint, file.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType: file.mime,
    parameters: fields,
  }, onProgress ? (p) => {
    if (p.totalBytesExpectedToSend > 0) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend)
  } : undefined)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; task.cancelAsync().catch(() => {}) }, timeout)
  try {
    const res = await task.uploadAsync()
    if (!res) throw new Error(timedOut ? 'Yükleme zaman aşımına uğradı' : 'Yükleme iptal edildi')
    return parseUpload(res.status, res.body)
  } catch (err) {
    if (timedOut) throw new Error('Yükleme zaman aşımına uğradı')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Canvas içine resim yükler (web uploadImageFile) → '/uploads/images/...' */
export async function uploadCanvasImage(mediaId, file) {
  const d = await uploadMultipart(`${getServerUrl()}/api/canvas/${encodeURIComponent(mediaId)}/upload`, file)
  if (!d?.url) throw new Error('Yükleme yanıtı geçersiz')
  return d.url
}

/**
 * Tile'a resim ekler. source: { file: {uri,name,mime} } | { url: '/uploads/...' }
 * tile: hoveredTile ({ id, position, rotation })
 * roomId: sunucunun "aktif oda"sı web'de başka odaya geçilince değişir; oda açıkça
 * gönderilir ki resim telefonda bulunulan odaya yazılsın.
 * Dosya sunucuda public/uploads/images/ altına kaydedilir.
 */
export async function addImageToTile({ tile, source, width, height, roomId }) {
  const fields = {
    tileId: String(tile.id),
    type: 'image',
    width: String(width),
    height: String(height),
    position: JSON.stringify(tile.position),
    rotation: JSON.stringify(tile.rotation),
  }
  if (roomId) fields.roomId = String(roomId)
  const endpoint = `${getServerUrl()}/api/upload`
  if (source.file) return uploadMultipart(endpoint, source.file, fields)

  // Bağlantı (sunucu zaten indirdi): yalnız metin alanları — expo/fetch destekler
  const form = new FormData()
  for (const [k, v] of Object.entries({ ...fields, url: source.url })) form.append(k, v)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT)
  try {
    const res = await fetch(endpoint, { method: 'POST', body: form, signal: ctrl.signal })
    return parseUpload(res.status, await res.text())
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Yükleme zaman aşımına uğradı')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// --- Video -------------------------------------------------------------------

const VIDEO_MIME = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp', avi: 'video/x-msvideo' }
const VIDEO_TIMEOUT = 30 * 60 * 1000 // büyük videolar yerel ağda da uzun sürebilir

/** Seçilen videonun yükleme bilgisi — dosya olduğu gibi gider (yeniden kodlama yok, kalite korunur) */
export function videoFile({ uri, fileName, mimeType }) {
  const ext = extOf(fileName) || extOf(uri) || 'mp4'
  const mime = mimeType && mimeType.startsWith('video/') ? mimeType : VIDEO_MIME[ext] ?? 'video/mp4'
  return { uri, name: fileName || `video-${Date.now()}.${ext}`, mime }
}

/**
 * Tile'a video ekler (web EditModal "Video" sekmesi, aynı uç). source: { file } | { url: '/uploads/videos/…' }.
 * Sunucu dosyayı MIME türüne göre public/uploads/videos/ altına yazar.
 */
export async function addVideoToTile({ tile, source, width, height, roomId, onProgress }) {
  const fields = {
    tileId: String(tile.id),
    type: 'video',
    width: String(width),
    height: String(height),
    position: JSON.stringify(tile.position),
    rotation: JSON.stringify(tile.rotation),
  }
  if (roomId) fields.roomId = String(roomId)
  const endpoint = `${getServerUrl()}/api/upload`
  if (source.file) return uploadMultipart(endpoint, source.file, fields, { timeout: VIDEO_TIMEOUT, onProgress })
  const form = new FormData()
  for (const [k, v] of Object.entries({ ...fields, url: source.url })) form.append(k, v)
  const res = await fetch(endpoint, { method: 'POST', body: form })
  return parseUpload(res.status, await res.text())
}

/** Dış video bağlantısını sunucuya indirt → { url: '/uploads/videos/…' } (görsel geldiyse hata) */
export async function fetchVideoToServer(url) {
  const d = await api('/api/fetch-url', { method: 'POST', body: { url }, timeout: VIDEO_TIMEOUT })
  if (!d?.localUrl) throw new Error(d?.error || 'Bağlantı indirilemedi')
  if (d.type !== 'video') throw new Error('Bu bağlantı bir video dosyası değil (YouTube vb. sayfalar değil, doğrudan .mp4 gibi dosya bağlantısı gerekir).')
  return d.localUrl
}

/** Tile'a metin (markdown) ekler — web EditModal'ın "Metin" sekmesiyle aynı uç */
export const addTextToTile = ({ tile, content, width, height, roomId }) =>
  api('/api/add-text', {
    method: 'POST',
    timeout: 20000,
    body: {
      tileId: String(tile.id),
      content,
      width,
      height,
      position: JSON.stringify(tile.position),
      rotation: JSON.stringify(tile.rotation),
      ...(roomId ? { roomId: String(roomId) } : {}),
    },
  })

/** Tile'a boş canvas ekler — web EditModal'ın "Canvas" sekmesiyle aynı uç */
export const addCanvasToTile = ({ tile, width, height, bg, roomId }) =>
  api('/api/canvas', {
    method: 'POST',
    timeout: 20000,
    body: {
      tileId: String(tile.id),
      width,
      height,
      bg,
      position: JSON.stringify(tile.position),
      rotation: JSON.stringify(tile.rotation),
      ...(roomId ? { roomId: String(roomId) } : {}),
    },
  })

/**
 * Medyayı tile'a kopyalar (web EditModal "Yapıştır" ile aynı uç). mode: 'copy' |
 * 'move' (kes: senkron canvas'ın bağı korunur, değilse sunucu normal kopya yapar).
 * Dosyalar sunucuda çoğaltılır; boyut kaynağınkiyle aynı kalır.
 */
export const cloneMediaToTile = ({ sourceId, tile, mode = 'copy', roomId }) =>
  api('/api/media/clone', {
    method: 'POST',
    timeout: 60000,
    body: {
      sourceId: String(sourceId),
      tileId: String(tile.id),
      position: JSON.stringify(tile.position),
      rotation: JSON.stringify(tile.rotation),
      mode,
      ...(roomId ? { roomId: String(roomId) } : {}),
    },
  })

/** Metni günceller; body: { content, width? } (web gibi genişlik yalnız büyür) */
export const updateMediaContent = (id, body) =>
  api(`/api/media/${id}`, { method: 'PUT', body, timeout: 20000 })

export const resizeMedia = (id, width, height) =>
  api(`/api/media/${id}`, { method: 'PUT', body: { width, height } })

export const deleteMedia = (id) => api(`/api/media/${id}`, { method: 'DELETE' })

export const isGifUrl = (url) => typeof url === 'string' && url.toLowerCase().includes('.gif')
