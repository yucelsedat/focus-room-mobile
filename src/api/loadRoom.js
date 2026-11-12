// Web'deki src/utils/loadRoom.js'in mobil karşılığı: odayı sunucuda aktifleştirir,
// medya + kapı + bağlantı verisini çekip store'a yazar.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from './client'
import { useStore } from '../store/useStore'

const byLayer = (rows, layer) => rows.filter((r) => r.layer === layer)

export async function loadRoom(id, name) {
  const { setRoomData, setLoading, setError, addToHistory } = useStore.getState()
  setLoading(true)
  setError(null)
  try {
    // Sunucu "aktif oda"yı global tutar; sonraki GET'ler bu odaya göre döner
    const { room } = await api(`/api/rooms/${encodeURIComponent(id)}/activate`, { method: 'POST' })
    const roomType = room?.roomType ?? 'room'

    const [media, doors, floor, specialDoors, roomLinks] = await Promise.all([
      api('/api/media'),
      api('/api/doors'),
      api('/api/floor'),
      api('/api/special-doors'),
      api('/api/room-links'),
    ])

    const doorIds = (layer) => byLayer(doors, layer).map((d) => d.id)
    const hidden = (layer) => [
      ...doorIds(layer),
      ...byLayer(specialDoors, layer).flatMap((sd) => sd.instanceIds),
      ...byLayer(roomLinks, layer).flatMap((l) => l.instanceIds),
    ]

    const roomName = room?.name ?? name
    setRoomData({
      worldMedia: media,
      hiddenWalls: hidden(0),
      hiddenOuterWalls: hidden(1),
      hiddenOuterWalls2: hidden(2),
      floorTexture: floor?.texture || 'zemin.jpg',
      specialDoors: byLayer(specialDoors, 0),
      outerSpecialDoors: byLayer(specialDoors, 1),
      outerSpecialDoors2: byLayer(specialDoors, 2),
      roomLinks: byLayer(roomLinks, 0),
      outerRoomLinks: byLayer(roomLinks, 1),
      outerRoomLinks2: byLayer(roomLinks, 2),
      currentRoomId: id,
      currentRoomName: roomName,
      currentRoomType: roomType,
      selectedMedia: null,
    })
    addToHistory(id, roomName)
    AsyncStorage.multiSet([['lastRoomId', id], ['lastRoomName', roomName]]).catch(() => {})
  } catch (err) {
    setError(err.message || String(err))
    throw err
  } finally {
    setLoading(false)
  }
}

export async function refreshRooms() {
  const rooms = await api('/api/rooms')
  useStore.getState().setRooms(rooms)
  return rooms
}
