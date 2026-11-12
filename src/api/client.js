// Sunucu istemcisi. Mobil uygulama, bilgisayarda çalışan aynı Express sunucusuna
// (server.js, varsayılan port 5001) yerel ağ üzerinden bağlanır. Adres kalıcıdır.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'serverUrl'
let baseUrl = ''

export function normalizeServerUrl(input) {
  let url = String(input || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  url = url.replace(/\/+$/, '')
  // Port yazılmadıysa sunucunun varsayılan portu
  if (!/:\d+$/.test(url.replace(/^https?:\/\//i, ''))) url = `${url}:5001`
  return url
}

export async function loadServerUrl() {
  try { baseUrl = (await AsyncStorage.getItem(KEY)) || '' } catch { baseUrl = '' }
  return baseUrl
}

export async function saveServerUrl(url) {
  baseUrl = normalizeServerUrl(url)
  try { await AsyncStorage.setItem(KEY, baseUrl) } catch {}
  return baseUrl
}

export const getServerUrl = () => baseUrl

// Sunucudaki göreli yolları (/uploads/...) mutlak adrese çevirir
export function assetUrl(url) {
  if (!url) return null
  if (/^(https?:|file:|data:)/i.test(url)) return url
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`
}

export async function api(path, { method = 'GET', body, timeout = 8000 } = {}) {
  if (!baseUrl) throw new Error('Sunucu adresi ayarlanmadı')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    if (!res.ok) {
      // Sunucunun Türkçe hata iletisi ({ error }) varsa onu göster
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || `${res.status} ${path}`)
    }
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Sunucu yanıt vermedi')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
