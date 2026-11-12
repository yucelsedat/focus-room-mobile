// Cihazın kendi ziyaret geçmişi. Sunucudaki Room.lastActiveAt web'in "son kullanılan"
// sırasıdır; mobil oraya yazmaz (activate { touch: false }), sırasını buradan kurar.
// Kayıt: en yeni başta [{ id, name, at }], oda başına tek satır.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getRootRoom } from '../shared/roomTree'

const KEY = 'visitHistory'
const LEGACY = ['lastRoomId', 'lastRoomName'] // eski sürümün tek "son oda" kaydı
const MAX = 100

// Yazmalar sıraya girer: kapılardan art arda geçişte iki oku-değiştir-yaz birbirini
// ezmesin; okuma da bekleyen yazmayı bekler (odadan hemen geri dönülse bile güncel).
let queue = Promise.resolve()

async function read() {
  try {
    const list = JSON.parse(await AsyncStorage.getItem(KEY))
    if (Array.isArray(list)) return list
  } catch { /* bozuk kayıt → boş geçmiş */ }
  try {
    const [[, id], [, name]] = await AsyncStorage.multiGet(LEGACY)
    return id ? [{ id, name: name || '', at: 0 }] : []
  } catch {
    return []
  }
}

export function getVisits() {
  return queue.then(read)
}

export function recordVisit(id, name) {
  const job = queue.then(async () => {
    const list = [{ id, name, at: Date.now() }, ...(await read()).filter((v) => v.id !== id)].slice(0, MAX)
    await AsyncStorage.setItem(KEY, JSON.stringify(list))
    AsyncStorage.multiRemove(LEGACY).catch(() => {})
    return list
  })
  queue = job.catch(() => {}) // bir yazma hatası sıradakileri durdurmasın
  return job
}

/** Dünyalar (kök odalar): sunucunun oda listesinden, oluşturulma sırasıyla */
export function worldsOf(rooms) {
  return rooms
    .filter((r) => !r.parent)
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
}

/**
 * Dünyalar son ziyarete göre: bir dünyanın herhangi bir odasına girmek onu en üste
 * taşır (kök, ziyaret anındaki değil güncel ağaçtan bulunur — oda başka dünyaya
 * bağlandıysa / koptuysa sıra da ona uyar). Hiç ziyaret edilmemişler sonda, sıraları korunur.
 */
export function orderWorlds(worlds, rooms, visits) {
  const known = new Set(rooms.map((r) => r.id))
  const rank = new Map()
  visits.forEach((v, i) => {
    if (!known.has(v.id)) return // silinmiş oda
    const root = getRootRoom(rooms, v.id).id
    if (!rank.has(root)) rank.set(root, i)
  })
  return worlds
    .map((w, i) => ({ w, i, r: rank.get(w.id) ?? Infinity }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map(({ w }) => w)
}

/** Son ziyaret edilen alt odalar (hâlâ var olanlar), en yeni başta */
export function recentRooms(rooms, visits, limit = 6) {
  const byId = new Map(rooms.map((r) => [r.id, r]))
  return visits.map((v) => byId.get(v.id)).filter((r) => r?.parent).slice(0, limit)
}

/** "Kaldığın yer": geçmişteki ilk, hâlâ var olan oda (adı güncel listeden) */
export function lastVisit(rooms, visits) {
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const room = visits.map((v) => byId.get(v.id)).find(Boolean)
  return room ? { id: room.id, name: room.name } : null
}
