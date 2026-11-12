// Canvas oda linki — web CanvasMesh'teki oda arama / child-ayrık seçimi ile aynı kurallar.
//  - Var olmayan oda: önce tür sorulur → child (bulunulan odanın altında) | ayrık
//  - Var olan kök oda (parent'ı yok): ilişki sorulur → child olarak bağla | parent ata | ayrık
//    Döngü oluşturacak ya da mevcut parent'ı ezecek seçenek kapalı gösterilir; hiçbiri
//    uygulanamıyorsa (ör. oda bu odanın kökü) soru sorulmadan doğrudan link eklenir.
import { api } from '../../api/client'
import { refreshRooms } from '../../api/loadRoom'

// Web BG_COLORS (oda linki + metin kutusu arka planı); null → varsayılan mavi ton
export const ROOM_DEFAULT_BG = 'rgba(96, 165, 250, 0.1)'
export const BG_COLORS = [
  'transparent',
  '#0f172a', '#1e293b', '#1e1b4b', '#14532d',
  '#450a0a', '#422006', '#1c1917', '#374151',
  '#312e81', '#1d4ed8', '#0f766e', '#166534',
  '#fbbf24', '#ef4444', '#ffffff',
]

export const newId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

// Web addRoomItem ile aynı ölçü
export const roomChipSize = (name) => ({ w: Math.max(260, String(name).length * 18 + 80), h: 72 })

export function makeRoomItem(roomId, roomName, center) {
  const { w, h } = roomChipSize(roomName)
  return { id: newId(), type: 'room', x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h, roomId, roomName }
}

export const roomMatches = (rooms, q) => {
  const s = q.trim().toLocaleLowerCase('tr')
  return s ? rooms.filter((r) => r.name.toLocaleLowerCase('tr').includes(s)) : rooms
}

/** Yeni oda: { name, roomId: null, choice, options } */
export const newRoomPlan = (name, here) => ({
  name,
  roomId: null,
  choice: 'child',
  options: [
    { key: 'child', icon: '↳', label: 'Child oda', hint: `“${here.name ?? ''}” odasının altında` },
    { key: 'detached', icon: '◇', label: 'Ayrık oda', hint: 'Bağımsız, kendi başına bir oda' },
  ],
})

/** Var olan oda: soru gerekmiyorsa null (doğrudan link), gerekiyorsa seçenekler */
export function existingRoomPlan(rooms, here, room) {
  const target = rooms.find((r) => r.id === room.id) ?? room
  const cur = rooms.find((r) => r.id === here.id)
  if (!cur || target.parent || target.id === here.id) return null
  const ancestors = new Set()
  for (let p = cur.parent?.id; p && !ancestors.has(p); p = rooms.find((r) => r.id === p)?.parent?.id) ancestors.add(p)
  const childOk = !ancestors.has(target.id)
  const parentOk = !cur.parent
  if (!childOk && !parentOk) return null
  return {
    name: target.name,
    roomId: target.id,
    choice: childOk ? 'child' : 'parent',
    options: [
      { key: 'child', icon: '↳', label: 'Child olarak bağla', disabled: !childOk,
        hint: childOk ? `“${here.name}” odasının altına girer` : `Bu oda “${here.name}” odasının kökü` },
      { key: 'parent', icon: '↰', label: 'Parent ata', disabled: !parentOk,
        hint: parentOk ? `“${here.name}” bu odanın altına girer` : `“${here.name}” odasının zaten parent'ı var: “${cur.parent?.name}”` },
      { key: 'detached', icon: '◇', label: 'Ayrık oda', hint: 'Hiyerarşi değişmez, yalnız link eklenir' },
    ],
  }
}

/**
 * Seçimi uygular → { roomId, roomName } (link eklenecek oda).
 * Yeni oda: oluşturulur (child ise parentId = bulunulan oda).
 * Var olan: child → hedefin parent'ı bu oda; parent → bu odanın parent'ı hedef.
 * Sunucu döngüyü reddeder ve defterleri uzlaştırır; ağaç değiştiği için oda listesi
 * baştan alınır. Hata → Error (sunucu iletisiyle).
 */
export async function applyRoomPlan(plan, choice, here) {
  if (!plan.roomId) {
    const created = await api('/api/rooms', {
      method: 'POST',
      timeout: 15000,
      body: { name: plan.name.trim(), roomType: 'room', parentId: choice === 'child' ? here.id : null },
    })
    await refreshRooms().catch(() => {})
    return { roomId: created.id, roomName: created.name }
  }
  if (choice !== 'detached') {
    const [id, parentId] = choice === 'child' ? [plan.roomId, here.id] : [here.id, plan.roomId]
    await api(`/api/rooms/${encodeURIComponent(id)}/settings`, { method: 'PUT', timeout: 15000, body: { parentId } })
    await refreshRooms().catch(() => {})
  }
  return { roomId: plan.roomId, roomName: plan.name }
}
