import { useEffect, useState } from 'react'
import * as THREE from 'three'
import * as FileSystem from 'expo-file-system/legacy'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

// Zemin/duvar dokuları uygulamayla paketlenir (web'de public/textures'tan gelir;
// Express sunucusu bu klasörü servis etmez). Bilinmeyen ad → oda zemini.
//
// DİKKAT: expo-gl görüntüyü stb_image ile çözer ve yalnız JPEG + PNG ile
// derlenmiştir (STBI_ONLY_JPEG/STBI_ONLY_PNG) — GIF, BMP, WebP, HEIC çözülemez;
// doku boş kalır (opak malzemede siyah, saydamda görünmez). Uzantıya bakılmaz,
// içerik önemlidir: web'deki duvar.jpg aslında WebP'dir. Uzak görseller bu
// yüzden önce koklanır ve gerekirse çevrilir; paketlenen dokular
// `npm run check:textures` ile denetlenir.
const BUNDLED = {
  'zemin.jpg': require('../../assets/textures/zemin.jpg'),
  'asfalt.jpg': require('../../assets/textures/asfalt.jpg'),
  'duvar.jpg': require('../../assets/textures/duvar.jpg'),
  'grass.png': require('../../assets/textures/grass.png'),
}

export const bundledTexture = (name) => BUNDLED[name] ?? BUNDLED['zemin.jpg']

const loader = new THREE.TextureLoader()

// --- Uzak görseller: indir → biçimi kokla → gerekirse JPEG'e çevir -----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function b64Bytes(s) {
  const out = []
  let buf = 0
  let bits = 0
  for (const ch of s.replace(/=+$/, '')) {
    const v = B64.indexOf(ch)
    if (v < 0) continue
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff) }
  }
  return out
}

// İçerikten biçim: { ext, gl } — gl: expo-gl doğrudan çözebilir mi (yalnız JPEG/PNG)
// alpha: çevrilirken saydamlık korunmalı mı (PNG'ye çevrilir)
export function sniffImage(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', gl: true }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', gl: true }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', gl: false, alpha: true } // ilk kare
  if (String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return { ext: 'webp', gl: false, alpha: true }
  if (b[0] === 0x42 && b[1] === 0x4d) return { ext: 'bmp', gl: false }
  if (String.fromCharCode(...b.slice(4, 8)) === 'ftyp') return { ext: 'heic', gl: false }
  return { ext: 'img', gl: false }
}

function hashUrl(url) {
  let h = 5381
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const prepared = new Map() // url → Promise<file:// uri>

export function prepareRemoteImage(url) {
  if (prepared.has(url)) return prepared.get(url)
  const job = (async () => {
    const base = `${FileSystem.cacheDirectory}tex-${hashUrl(url)}`
    const { uri, status } = await FileSystem.downloadAsync(url, `${base}.download`)
    if (status >= 400) throw new Error(`HTTP ${status}`)
    const head = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64, position: 0, length: 12,
    })
    const kind = sniffImage(b64Bytes(head))
    // Doğru uzantı: platform çözücüleri (çevirme için) uzantıya da bakabilir
    const dest = `${base}.${kind.ext}`
    // Önceki oturumdan kalan dosya varsa iOS'ta moveAsync "zaten var" hatası verir
    await FileSystem.deleteAsync(dest, { idempotent: true })
    await FileSystem.moveAsync({ from: uri, to: dest })
    if (kind.gl) return dest
    // Platform çözücüsüyle aç (GIF → ilk kare), expo-gl'in okuyabildiği biçime çevir
    const ref = await ImageManipulator.manipulate(dest).renderAsync()
    const out = await ref.saveAsync(kind.alpha ? { format: SaveFormat.PNG } : { format: SaveFormat.JPEG, compress: 0.9 })
    FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {})
    return out.uri
  })()
  job.catch(() => prepared.delete(url)) // başarısızsa sonraki denemede yeniden indir
  prepared.set(url, job)
  return job
}

// source: require() modül numarası ya da mutlak URL. @react-three/fiber/native
// TextureLoader'ı, dosyayı EXGL'e { localUri } olarak veren bir polyfill'le değiştirir.
// setup her yüklemede ayrı Texture objesine uygulanır (repeat paylaşılmasın).
export function useTexture(source, setup) {
  const [texture, setTexture] = useState(null)
  useEffect(() => {
    if (source == null) return undefined
    let alive = true
    let loaded = null
    const fail = (err) => {
      if (__DEV__) console.warn('[texture]', typeof source === 'string' ? source : 'bundled', err?.message ?? err)
      if (alive) setTexture(null)
    }
    const resolved = typeof source === 'string' && /^https?:/i.test(source)
      ? prepareRemoteImage(source)
      : Promise.resolve(source)
    resolved.then((src) => {
      if (!alive) return
      loader.load(
        src,
        (t) => {
          if (!alive) { t.dispose(); return }
          // colorSpace burada ayarlanmaz: R3F, `map` prop'una atanınca sRGB'yi
          // kendisi işaretler (web sürümüyle aynı davranış). anisotropy web ile aynı.
          t.anisotropy = 4
          setup?.(t)
          t.needsUpdate = true
          loaded = t
          setTexture(t)
        },
        undefined,
        fail,
      )
    }, fail)
    return () => {
      alive = false
      loaded?.dispose()
      setTexture(null)
    }
    // setup bilerek bağımlılık dışı: çağıran taraf satır içi fonksiyon verir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])
  return texture
}

export const repeatWrap = (x = 1, y = x) => (t) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(x, y)
}
