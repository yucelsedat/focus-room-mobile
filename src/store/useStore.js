import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Duvar tile panosu (web: localStorage 'tileClipboard') — oda değişse de, uygulama
// kapanıp açılsa da kalır. { id, type, mode: 'copy' | 'cut' }
const CLIP_KEY = 'tileClipboard'
// Canvas öğe panosu (web: canvasUtils canvasClipboard) — tam ekran düzenleyicide
// Kopyala / Kes ile dolar; başka canvas'a da yapıştırılabilir. { sourceId, items, mode }
const CANVAS_CLIP_KEY = 'canvasClipboard'

// Web store'unun (src/store/useStore.js) gezinme için gereken alt kümesi.
// Düzenleme modalları mobilde henüz yok; sahne yalnızca okur.
export const useStore = create((set) => ({
  rooms: [],
  worldMedia: [],
  hiddenWalls: [],
  hiddenOuterWalls: [],
  hiddenOuterWalls2: [],
  floorTexture: 'zemin.jpg',
  currentRoomId: null,
  currentRoomName: '',
  currentRoomType: 'room',
  specialDoors: [],
  outerSpecialDoors: [],
  outerSpecialDoors2: [],
  roomLinks: [],
  outerRoomLinks: [],
  outerRoomLinks2: [],
  roomHistory: [],
  loading: false,
  error: null,
  selectedMedia: null, // dokunulan panel → detay sayfası
  roomSheet: false,
  hoveredTile: null,   // + işaretinin baktığı tile: { id, position, rotation } (web ile aynı şekil)

  tileSheet: null,     // dokunulan tile → medya ekleme sayfası (web E modalı)
  tileClipboard: null,
  canvasClipboard: null,
  canvasEditor: null,  // basılı tutulan canvas → yatay tam ekran düzenleyici: { mediaId }
  videoPlayer: null,   // video tile → sesli tam ekran oynatıcı: { mediaId, url, ratio, title }

  setHoveredTile: (hoveredTile) => set({ hoveredTile }),
  openTileSheet: (tile) => set({ tileSheet: { ...tile, openedAt: Date.now() }, selectedMedia: null }),
  closeTileSheet: () => set({ tileSheet: null }),
  setTileClipboard: (clip) => {
    (clip ? AsyncStorage.setItem(CLIP_KEY, JSON.stringify(clip)) : AsyncStorage.removeItem(CLIP_KEY)).catch(() => {})
    set({ tileClipboard: clip })
  },
  loadTileClipboard: async () => {
    try { set({ tileClipboard: JSON.parse(await AsyncStorage.getItem(CLIP_KEY)) || null }) } catch { /* bozuk kayıt */ }
  },
  setCanvasClipboard: (clip) => {
    (clip ? AsyncStorage.setItem(CANVAS_CLIP_KEY, JSON.stringify(clip)) : AsyncStorage.removeItem(CANVAS_CLIP_KEY)).catch(() => {})
    set({ canvasClipboard: clip })
  },
  loadCanvasClipboard: async () => {
    try { set({ canvasClipboard: JSON.parse(await AsyncStorage.getItem(CANVAS_CLIP_KEY)) || null }) } catch { /* bozuk kayıt */ }
  },
  openCanvasEditor: (mediaId) => set({ canvasEditor: { mediaId }, selectedMedia: null, tileSheet: null }),
  closeCanvasEditor: () => set({ canvasEditor: null }),
  openVideoPlayer: (video) => set({ videoPlayer: video, selectedMedia: null, tileSheet: null }),
  closeVideoPlayer: () => set({ videoPlayer: null }),
  addMedia: (item) => set((s) => ({ worldMedia: [...s.worldMedia, item] })),
  removeMedia: (id) => set((s) => ({ worldMedia: s.worldMedia.filter((m) => m.id !== id) })),
  updateMedia: (item) => set((s) => ({ worldMedia: s.worldMedia.map((m) => (m.id === item.id ? item : m)) })),

  setRooms: (rooms) => set({ rooms }),
  setRoomData: (data) => set(data),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  selectMedia: (selectedMedia) => set({ selectedMedia }),
  setRoomSheet: (roomSheet) => set({ roomSheet }),
  addToHistory: (id, name) => set((s) => ({
    roomHistory: [...s.roomHistory.filter((r) => r.id !== id), { id, name }].slice(-30),
  })),
}))
