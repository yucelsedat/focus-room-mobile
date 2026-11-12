// Video yardımcıları.
//  - Önizleme karesi (poster) ve ölçü: expo-video-thumbnails (her yerde çalışır; kare
//    görüntüleneceği yönde, sıkıştırmasız). Diske önbelleklenir.
//  - Duvarda oynatma için kareler: Skia'nın yerel çözücüsü (Skia.Video). Expo Go'nun
//    Android sürümünde Skia video desteği derlenmemiştir ("only supported on API 26"):
//    bu bir kez anlaşılır, sonra denenmez (duvarda poster kalır). iOS'ta ve minSdk 26'lık
//    bir geliştirme derlemesinde çalışır.
//  - Kareler kodlandığı yönde gelir; telefonda dik çekilmiş videoda rotation 90'dır.
//    drawUpright kareyi görüntüleneceği yöne çevirerek çizer.
//  - FrameGrabber: kareyi (GPU'da) dik + hedef boyutta bir yüzeye çizer ve pikselleri
//    tek, yeniden kullanılan bir tampona okur (duvardaki 3D doku için; her karede yeni
//    bellek ayrılmaz).
//  - probeVideo: boyut / yön / süre + önizleme karesi (data URI).
import { Platform } from 'react-native'
import { Skia } from '@shopify/react-native-skia'
import * as FileSystem from 'expo-file-system/legacy'
import { getThumbnailAsync } from 'expo-video-thumbnails'
import { assetUrl } from '../api/client'

const FILTER_LINEAR = 1
const MIPMAP_NONE = 0
const RGBA_8888 = 4
const ALPHA_PREMUL = 2

// Skia video desteği: null → bilinmiyor, true / false → denendi
let skiaVideo = Platform.OS === 'web' ? false : null
export const skiaVideoAvailable = () => skiaVideo !== false

/** Skia.Video (yerel çözücü). Meta veriyi okurken JS'i kısa bir an bekletebilir. */
export async function openVideo(url) {
  if (skiaVideo === false) throw new Error('Bu uygulama sürümünde Skia video desteği yok')
  let v
  try {
    v = await Promise.resolve(Skia.Video(assetUrl(url)))
  } catch (err) {
    // Derleme sınırı (Expo Go Android): bir daha deneme
    if (/API 26|not supported|only support/i.test(String(err?.message ?? err))) skiaVideo = false
    throw err
  }
  if (!v) throw new Error('Video açılamadı')
  skiaVideo = true
  return v
}

// --- Poster (önizleme karesi) ----------------------------------------------------

const POSTER_DIR = `${FileSystem.cacheDirectory}video-poster/`
const posters = new Map() // url → Promise<{ uri, width, height } | null>
let posterChain = Promise.resolve() // aynı anda tek video okunur

function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}${str.length.toString(36)}`
}

/**
 * Videonun ilk karelerinden biri → { uri (file://, JPEG), width, height } (görüntülenecek
 * yönde, videonun kendi çözünürlüğünde). Bir kez üretilir, diskte kalır. Hata → null.
 */
export function getPoster(url) {
  if (!url) return Promise.resolve(null)
  const hit = posters.get(url)
  if (hit) return hit
  const job = (async () => {
    const dest = `${POSTER_DIR}${hash(url)}.jpg`
    const meta = `${dest}.json`
    const [img, m] = await Promise.all([
      FileSystem.getInfoAsync(dest).catch(() => ({ exists: false })),
      FileSystem.readAsStringAsync(meta).catch(() => null),
    ])
    if (img.exists && m) {
      try { return { uri: dest, ...JSON.parse(m) } } catch { /* yeniden üret */ }
    }
    const run = posterChain.then(async () => {
      // İlk kare çoğu zaman siyah geçiş karesidir: biraz ilerisi
      let t
      try { t = await getThumbnailAsync(assetUrl(url), { time: 500, quality: 1 }) } catch {
        t = await getThumbnailAsync(assetUrl(url), { time: 0, quality: 1 })
      }
      await FileSystem.makeDirectoryAsync(POSTER_DIR, { intermediates: true }).catch(() => {})
      await FileSystem.deleteAsync(dest, { idempotent: true })
      await FileSystem.moveAsync({ from: t.uri, to: dest })
      await FileSystem.writeAsStringAsync(meta, JSON.stringify({ width: t.width, height: t.height }))
      return { uri: dest, width: t.width, height: t.height }
    })
    posterChain = run.catch(() => {})
    return run
  })().catch((err) => {
    if (__DEV__) console.warn('[video] önizleme karesi alınamadı', url, err?.message ?? err)
    posters.delete(url) // sonra yeniden denenebilsin
    return null
  })
  posters.set(url, job)
  return job
}

const normRot = (r) => ((Math.round((r || 0) / 90) * 90) % 360 + 360) % 360

/** Görüntülenecek (dik) boyut: { w, h, rot } */
export function uprightOf(video) {
  const { width, height } = video.size()
  const rot = normRot(video.rotation())
  return rot % 180 ? { w: height, h: width, rot } : { w: width, h: height, rot }
}

/**
 * Kareyi (iw × ih, kodlandığı yön) rot derece saat yönünde çevirip W × H kutuya
 * gerdirerek çizer (kutu dik oranda olmalı).
 */
export function drawUpright(c, img, rot, W, H, paint = null) {
  const iw = img.width()
  const ih = img.height()
  c.save()
  if (rot === 90) { c.translate(W, 0); c.rotate(90, 0, 0); c.scale(H / iw, W / ih) }
  else if (rot === 270) { c.translate(0, H); c.rotate(-90, 0, 0); c.scale(H / iw, W / ih) }
  else if (rot === 180) { c.translate(W, H); c.rotate(180, 0, 0); c.scale(W / iw, H / ih) }
  else c.scale(W / iw, H / ih)
  const p = paint ?? Skia.Paint()
  c.drawImageRectOptions(img, Skia.XYWHRect(0, 0, iw, ih), Skia.XYWHRect(0, 0, iw, ih), FILTER_LINEAR, MIPMAP_NONE, p)
  c.restore()
}

/** Dik boyutu (w, h) uzun kenarı en fazla maxSide olacak şekilde küçültür (büyütmez) */
export function fitSide(w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h))
  return { w: Math.max(2, Math.round(w * k)), h: Math.max(2, Math.round(h * k)) }
}

export class FrameGrabber {
  constructor() {
    this.surface = null
    this.w = 0
    this.h = 0
    this.buffer = null
    this.paint = Skia.Paint()
    this.gpu = true
  }

  ensure(w, h) {
    if (this.surface && this.w === w && this.h === h) return
    this.surface?.dispose?.()
    this.surface = (this.gpu && Skia.Surface.MakeOffscreen(w, h)) || null
    if (!this.surface) { this.gpu = false; this.surface = Skia.Surface.Make(w, h) }
    this.w = w
    this.h = h
    this.buffer = new Uint8Array(w * h * 4)
  }

  /** img → dik, w × h RGBA pikseller (paylaşılan tampon) | null */
  grab(img, rot, w, h) {
    if (!img) return null
    this.ensure(w, h)
    // GPU yüzeyi yoksa (nadir) doku kareyi önce belleğe kopyala
    const src = this.gpu ? img : (img.makeNonTextureImage?.() ?? img)
    const c = this.surface.getCanvas()
    c.clear(Skia.Color('black'))
    drawUpright(c, src, rot, w, h, this.paint)
    if (src !== img) src.dispose?.()
    this.surface.flush()
    const snap = this.surface.makeImageSnapshot()
    const out = snap.readPixels(0, 0, { width: w, height: h, colorType: RGBA_8888, alphaType: ALPHA_PREMUL }, this.buffer, w * 4)
    snap.dispose?.()
    return out ? this.buffer : null
  }

  dispose() {
    this.surface?.dispose?.()
    this.surface = null
    this.buffer = null
  }
}

/**
 * Videonun ölçüleri ve önizleme karesi: { width, height, ratio, poster (file:// | null) }.
 * Ölçüler görüntülenecek yöndedir (dik çekilmiş video dik).
 */
export async function probeVideo(url) {
  const p = await getPoster(url)
  if (!p) throw new Error('Video okunamadı')
  return { width: p.width, height: p.height, ratio: p.width / p.height || 16 / 9, poster: p.uri }
}

export function formatTime(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
