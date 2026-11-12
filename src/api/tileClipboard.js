// Duvar tile'ı kes / kopyala / yapıştır — web EditModal'daki Kopyala / Kes / Yapıştır.
// Kopyala: panoya alınır, yapıştırınca bağımsız kopya (dosyalar çoğaltılır).
// Kes: yapıştırınca hedefte oluşur, kaynak silinir (taşıma; senkron canvas bağı korunur).
// Pano odalar arası geçerlidir: başka odada da yapıştırılabilir.
import { useStore } from '../store/useStore'
import { cloneMediaToTile, deleteMedia } from './media'

export const CLIP_TYPES = new Set(['image', 'video', 'markdown', 'canvas']) // şimdilik
export const CLIP_LABEL = { image: 'Resim', video: 'Video', markdown: 'Metin', canvas: 'Canvas' }

export const clipLabel = (clip) => CLIP_LABEL[clip?.type] ?? 'Medya'

/** Aynı öğe aynı kipte zaten panodaysa panoyu boşaltır (düğme açık/kapalı) */
export function toggleClip(item, mode) {
  const { tileClipboard: cur, setTileClipboard } = useStore.getState()
  const same = cur?.id === item.id && cur?.mode === mode
  // Resim adresi / metin de saklanır: tam ekran canvas'a yapıştırılabilsin (başka odada da)
  const snap = item.type === 'image' ? { url: item.url, width: item.width, height: item.height }
    : item.type === 'markdown' ? { content: item.content } : {}
  setTileClipboard(same ? null : { id: item.id, type: item.type, mode, ...snap })
}

/** Panodakini tile'a yapıştırır → yeni medya satırı. Hata → Error (Türkçe ileti). */
export async function pasteClipboard(tile) {
  const st = useStore.getState()
  const clip = st.tileClipboard
  if (!clip) throw new Error('Pano boş')
  let res
  try {
    res = await cloneMediaToTile({ sourceId: clip.id, tile, mode: clip.mode === 'cut' ? 'move' : 'copy', roomId: st.currentRoomId })
  } catch (err) {
    // Kaynak bu arada silinmiş: panoda bayat kayıt bırakma
    if (/bulunamadı|404/i.test(err.message)) st.setTileClipboard(null)
    throw err
  }
  const { source: _source, ...row } = res
  st.addMedia(row)
  if (clip.mode === 'cut') {
    try {
      const del = await deleteMedia(clip.id)
      st.removeMedia(clip.id)
      // Senkron grup: kalan üyelerin syncCount'u değişir (taşınan kopya dahil)
      del?.siblings?.forEach((m) => useStore.getState().updateMedia(m))
    } catch (err) {
      st.setTileClipboard(null)
      throw new Error(`Yapıştırıldı ama kaynak silinemedi (${err.message}); iki kopya var.`)
    }
  }
  st.setTileClipboard(null)
  return row
}

/**
 * Tile medyasını siler ve store'u tazeler: senkron canvas'ın kalan kopyaları güncel
 * syncCount'la gelir (tek kalanın bağı çözülür); silinen öğe panodaysa pano boşalır.
 */
export async function removeTileMedia(item) {
  const del = await deleteMedia(item.id)
  const st = useStore.getState()
  st.removeMedia(item.id)
  del?.siblings?.forEach((m) => useStore.getState().updateMedia(m))
  if (st.tileClipboard?.id === item.id) st.setTileClipboard(null)
}
