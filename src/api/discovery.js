// Sunucuyu otomatik bulma. Sıra (ilk yanıt veren kazanır):
//  1) EXPO_PUBLIC_SERVER_URL (isteğe bağlı sabit adres)
//  2) Kaydedilmiş adres (önceki başarılı bağlantı)
//  3) Expo geliştirme sunucusunun çalıştığı bilgisayar — backend de oradadır
//  4) Emülatör adresleri (Android: 10.0.2.2, iOS simülatör: localhost)
//  5) Telefonun /24 alt ağını 5001 portunda tarama
// Doğrulama: GET /api/ping → { app: 'focus-room' }. Eski sunucularda ping yoksa
// /api/worlds'ün dizi dönmesi de kabul edilir.
import Constants from 'expo-constants'
import * as Network from 'expo-network'
import { Platform } from 'react-native'
import { getServerUrl, normalizeServerUrl, saveServerUrl } from './client'

const PORT = 5001
const SCAN_CONCURRENCY = 48
const SCAN_TIMEOUT = 1200

async function getJson(url, timeout, signal) {
  const ctrl = new AbortController()
  const abort = () => ctrl.abort()
  signal?.addEventListener?.('abort', abort)
  const timer = setTimeout(abort, timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return { status: res.status }
    return { status: res.status, body: await res.json() }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', abort)
  }
}

// Adres bu sunucu mu?
export async function probe(base, { timeout = 2500, signal } = {}) {
  try {
    const ping = await getJson(`${base}/api/ping`, timeout, signal)
    if (ping.body?.app === 'focus-room') return true
    if (ping.status === 404) {
      const worlds = await getJson(`${base}/api/worlds`, timeout, signal)
      return Array.isArray(worlds.body)
    }
  } catch {}
  return false
}

// Expo dev sunucusunun host'u ("192.168.1.20:8081" → "192.168.1.20")
function devHost() {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost
  const host = hostUri?.split(':')[0]
  if (!host || host === 'localhost' || host === '127.0.0.1') return null
  // Tünel modunda (exp.direct / ngrok) backend'e bu host'tan ulaşılamaz
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null
  return host
}

// İlk başarılı adayı döndürür; kalan istekler iptal edilir
async function firstAlive(bases, { concurrency, timeout }) {
  const ctrl = new AbortController()
  let found = null
  let next = 0
  const worker = async () => {
    while (!found && next < bases.length) {
      const base = bases[next++]
      if (await probe(base, { timeout, signal: ctrl.signal })) {
        if (!found) found = base
        ctrl.abort()
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, bases.length) }, worker))
  return found
}

async function subnetCandidates(exclude) {
  let ip = null
  try { ip = await Network.getIpAddressAsync() } catch {}
  const m = ip?.match(/^(\d+\.\d+\.\d+)\.(\d+)$/)
  if (!m || ip === '0.0.0.0') return []
  const [, prefix, own] = m
  const hosts = []
  for (let i = 1; i <= 254; i++) {
    if (String(i) === own) continue
    const base = `http://${prefix}.${i}:${PORT}`
    if (!exclude.has(base)) hosts.push(base)
  }
  // Yönlendirici/sunucu gibi sık kullanılan düşük ve yakın adresler önce
  const ownN = Number(own)
  return hosts.sort((a, b) => {
    const na = Number(a.split('.')[3].split(':')[0])
    const nb = Number(b.split('.')[3].split(':')[0])
    return Math.abs(na - ownN) - Math.abs(nb - ownN)
  })
}

/**
 * Sunucuyu bulur, kaydeder ve adresini döndürür; bulunamazsa null.
 * onStatus: aşama metni (arayüzde göstermek için)
 */
export async function discoverServer({ onStatus } = {}) {
  const tried = new Set()
  const tryOne = async (raw, label) => {
    const base = normalizeServerUrl(raw)
    if (!base || tried.has(base)) return null
    tried.add(base)
    onStatus?.(label)
    return (await probe(base)) ? base : null
  }

  const quick = [
    [process.env.EXPO_PUBLIC_SERVER_URL, 'Ayarlı adres deneniyor'],
    [getServerUrl(), 'Son bağlantı deneniyor'],
    [devHost(), 'Geliştirme bilgisayarı deneniyor'],
  ]
  for (const [raw, label] of quick) {
    const hit = await tryOne(raw, label)
    if (hit) return saveServerUrl(hit)
  }

  // Emülatörler: hızlı, paralel
  const emu = (Platform.OS === 'android' ? ['10.0.2.2'] : ['localhost'])
    .map((h) => normalizeServerUrl(h))
    .filter((b) => !tried.has(b))
  emu.forEach((b) => tried.add(b))
  const emuHit = emu.length ? await firstAlive(emu, { concurrency: emu.length, timeout: 800 }) : null
  if (emuHit) return saveServerUrl(emuHit)

  onStatus?.('Yerel ağ taranıyor')
  const hosts = await subnetCandidates(tried)
  const scanHit = hosts.length ? await firstAlive(hosts, { concurrency: SCAN_CONCURRENCY, timeout: SCAN_TIMEOUT }) : null
  if (scanHit) return saveServerUrl(scanHit)
  return null
}
