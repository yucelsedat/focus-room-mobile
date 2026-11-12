// Canvas görselleri: kalıcı disk önbelleği + sınırlı eşzamanlı indirme.
//
// Eskiden her görselin kodlanmış baytı (SkData) bellekte bir LRU'da (80 adet) tutulur,
// bir canvas'ın bütün görselleri aynı anda indirilirdi; GIF'ler MB'larca olduğundan
// çok GIF'li canvas'ta bellek doluyor, uygulama kapanıyordu. Şimdi:
//  - Görsel bir kez indirilip cacheDirectory'ye yazılır (sonraki açılışlarda ağ yok)
//  - Aynı anda en fazla DOWNLOADS indirme; öncelikli istekler (görünen öğe) öne geçer
//  - Bayt yalnız çözülürken bellektedir: duvar çizimi her görseli diskten eşzamanlı
//    okuyup çözer, çizer ve hemen bırakır (aynı anda tek görsel)
// Görseller tam çözünürlükte çözülür; kalite düşürülmez.
import { Skia } from '@shopify/react-native-skia'
import * as FileSystem from 'expo-file-system/legacy'
import { File } from 'expo-file-system'
import { assetUrl } from '../api/client'

const DIR = `${FileSystem.cacheDirectory}canvas-img/`
const DOWNLOADS = 4

const local = new Map() // url → Promise<string | null> (file:// yolu)
const waiting = []      // { run, high }
let active = 0
let dirReady = null

// cyrb53: adres → kısa, çakışması pratikte olmayan dosya adı
function hash(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
const extOf = (url) => (String(url).match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i)?.[1] ?? 'img').toLowerCase()

function pump() {
  while (active < DOWNLOADS && waiting.length) {
    const job = waiting.shift()
    active++
    job.run().finally(() => { active--; pump() })
  }
}

function enqueue(run, high) {
  return new Promise((resolve) => {
    const job = { run: () => run().then(resolve, () => resolve(null)), high }
    if (high) {
      // Öncelikliler kendi aralarında sırayı korur, sıradan olanların önüne geçer
      const i = waiting.findIndex((j) => !j.high)
      waiting.splice(i < 0 ? waiting.length : i, 0, job)
    } else waiting.push(job)
    pump()
  })
}

/** Görselin diskteki kopyası (file://) — yoksa indirir. Hata → null. */
export function localImage(url, { high = false } = {}) {
  if (!url) return Promise.resolve(null)
  if (/^(file:|data:)/i.test(url)) return Promise.resolve(url)
  const hit = local.get(url)
  if (hit) return hit
  const path = `${DIR}${hash(url)}.${extOf(url)}`
  const job = (async () => {
    dirReady = dirReady ?? FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
    await dirReady
    const info = await FileSystem.getInfoAsync(path).catch(() => ({ exists: false }))
    if (info.exists && info.size > 0) return path
    return enqueue(async () => {
      const tmp = `${path}.part`
      const res = await FileSystem.downloadAsync(assetUrl(url), tmp)
      if (res.status >= 400) { FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {}); return null }
      await FileSystem.moveAsync({ from: tmp, to: path }) // yarım dosya önbellekte kalmasın
      return path
    }, high)
  })().catch(() => null)
  local.set(url, job)
  job.then((p) => { if (!p) local.delete(url) }) // başarısız → sonra yeniden denenebilsin
  return job
}

/** Diskteki görselin baytları (eşzamanlı; yalnız o an çözülecek görsel için) */
export function readImageDataSync(path) {
  try {
    if (path.startsWith('data:')) return null
    return Skia.Data.fromBytes(new File(path).bytesSync())
  } catch {
    return null
  }
}

/** Görselin baytları (zaman uyumsuz); çağıran işi bitince dispose eder */
export async function loadImageData(url, opts) {
  const path = await localImage(url, opts)
  if (!path) return null
  try { return await Skia.Data.fromURI(path) } catch { return null }
}

/**
 * Duvar çizimi için: görseller diske indirilir (sınırlı eşzamanlılık), çizimde
 * getImage(url) her çağrıda diskten okuyup çözer (çizici çizdikten sonra bırakır).
 */
export async function prepareImages(urls) {
  const paths = await Promise.all(urls.map((u) => localImage(u).then((p) => [u, p])))
  const map = new Map(paths.filter(([, p]) => p))
  return (url) => {
    const p = map.get(url)
    if (!p) return null
    const data = readImageDataSync(p)
    if (!data) return null
    try { return Skia.Image.MakeImageFromEncoded(data) } catch { return null } finally { data.dispose?.() }
  }
}
