// Oda menüsündeki ayarlar: bağlantı silme, oda silme, alt odalarıyla (kökleriyle) silme.
// Web MainMenu "Bağlantıyı Sil" / "Sadece Bu Odayı Sil" / "Kökleriyle Birlikte Sil" ile aynı uçlar;
// bağlantı silme için aktif odadan bağımsız POST /api/rooms/:id/disconnect kullanılır.
import { api } from './client'
import { loadRoom, refreshRooms } from './loadRoom'
import { useStore } from '../store/useStore'

/** Odanın tüm alt odaları (kendisi hariç) — rooms listesindeki parent bağlarından */
export function descendantIds(rooms, id) {
  const out = []
  const seen = new Set([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()
    for (const r of rooms) {
      if (r.parent?.id === cur && !seen.has(r.id)) {
        seen.add(r.id)
        out.push(r.id)
        stack.push(r.id)
      }
    }
  }
  return out
}

/**
 * İki oda arasındaki ilişki (bağlantı silme seçeneği için):
 * 'child' (other, room'un alt odası) | 'parent' | 'link' (bağlantı kapısı) | null
 */
export function relationOf(rooms, roomId, otherId, linkedIds = []) {
  if (!roomId || !otherId || roomId === otherId) return null
  const other = rooms.find((r) => r.id === otherId)
  const room = rooms.find((r) => r.id === roomId)
  if (other?.parent?.id === roomId) return 'child'
  if (room?.parent?.id === otherId) return 'parent'
  if (linkedIds.includes(otherId)) return 'link'
  return null
}

// Bulunulan oda etkilendiyse kapı / duvar verisi tazelenir (oyuncu yerinde kalır)
async function refreshCurrent() {
  const { currentRoomId, currentRoomName } = useStore.getState()
  if (currentRoomId) await loadRoom(currentRoomId, currentRoomName).catch(() => {})
}

export async function disconnectRooms(roomId, otherId) {
  const res = await api(`/api/rooms/${encodeURIComponent(roomId)}/disconnect`, { method: 'POST', body: { otherId }, timeout: 15000 })
  if (res?.rooms) useStore.getState().setRooms(res.rooms)
  const cur = useStore.getState().currentRoomId
  if (cur === roomId || cur === otherId) await refreshCurrent()
  return res?.removed
}

/**
 * Odayı siler (cascade: alt odalarıyla birlikte). → { deletedIds, currentDeleted, fallback }
 * Bulunulan oda silindiyse fallback: hayatta kalan en yakın üst oda, yoksa ilk oda.
 */
export async function deleteRoom(id, { cascade = false } = {}) {
  const before = useStore.getState().rooms
  const st = useStore.getState()
  const res = await api(`/api/rooms/${encodeURIComponent(id)}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE', timeout: 30000 })
  const deletedIds = res?.deletedIds ?? [id]
  const gone = new Set(deletedIds)
  const rooms = await refreshRooms().catch(() => before.filter((r) => !gone.has(r.id)))
  useStore.setState((s) => ({ roomHistory: s.roomHistory.filter((r) => !gone.has(r.id)) }))

  const currentDeleted = gone.has(st.currentRoomId)
  let fallback = null
  if (currentDeleted) {
    // En yakın hayatta kalan üst oda (silmeden önceki ağaçta yukarı çık)
    for (let p = before.find((r) => r.id === st.currentRoomId)?.parent?.id; p; p = before.find((r) => r.id === p)?.parent?.id) {
      if (!gone.has(p)) { fallback = rooms.find((r) => r.id === p) ?? null; break }
    }
    fallback = fallback ?? rooms.find((r) => r.id === 'default') ?? rooms[0] ?? null
  } else {
    await refreshCurrent() // silinen odaya giden kapılar duvardan kalkar
  }
  return { deletedIds, currentDeleted, fallback }
}
