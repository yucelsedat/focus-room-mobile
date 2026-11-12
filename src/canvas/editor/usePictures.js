// Düzenleyicinin çizim kaynakları: çözülmüş görseller + öğe katmanları.
//
// Görseller ekrana göre yüklenir (kalite düşürülmez, her görsel tam çözünürlükte):
//  - Yalnız görünen alanın (ve çevresinin) öğelerinin görselleri çözülür; ekranın
//    ortasına en yakın olan önce. Uzaklaşanlar bırakılır, geri gelince diskten
//    yeniden çözülür (indirme bir kez: images.js disk önbelleği).
//  - Aynı anda tek görsel çözülür; JS iş parçacığı nefes alır.
//  - GIF / animasyonlu WebP yalnız SkAnimatedImage olarak tutulur (ayrıca durağan
//    kopyası çözülmez); kare kare GifLayer'da oynar.
//
// Picture vektöreldir; pan/zoom yalnız matrisi değiştirir. Her öğe kendi picture'ına
// bir kez kaydedilir (öğe değişmedikçe yeniden kayıt yok); katmanlar bu hazır
// picture'lardan birleştirilir. Öğe sırası korunur: animasyonlu görsellerin arası
// ayrı katmanlara bölünür → [picture, gif, picture, …, oklar].
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Skia } from '@shopify/react-native-skia'
import { loadImageData } from '../images'
import { imageUrlOf, isAnimatedUrl, itemBox } from '../render'

const keepImage = () => {}
const LOAD_MARGIN = 0.6   // görünen alanın her yanından bu oran kadar ötesi de yüklenir
const KEEP_MARGIN = 1.6   // bunun dışına çıkan görsel bırakılır (gidip gelmede titremesin)
const BUMP_MS = 180       // art arda yüklenen görseller tek yeniden kayıtta toplansın

const grow = (r, k) => ({ x0: r.x0 - (r.x1 - r.x0) * k, y0: r.y0 - (r.y1 - r.y0) * k, x1: r.x1 + (r.x1 - r.x0) * k, y1: r.y1 + (r.y1 - r.y0) * k })
export const touches = (r, b) => !r || (b.x < r.x1 && b.x + b.w > r.x0 && b.y < r.y1 && b.y + b.h > r.y0)

/** Görünen alana göre url'ler: { want: yakından uzağa sıralı, keep: Set } */
function wantedUrls(items, rect) {
  if (!rect) return { want: [], keep: new Set() } // ekran ölçüsü bilinmeden hiçbir şey yükleme
  const load = grow(rect, LOAD_MARGIN)
  const keep = grow(rect, KEEP_MARGIN)
  const cx = (rect.x0 + rect.x1) / 2
  const cy = (rect.y0 + rect.y1) / 2
  const dist = new Map()
  const keepSet = new Set()
  for (const it of items) {
    const url = imageUrlOf(it)
    if (!url) continue
    const b = itemBox(it)
    if (touches(keep, b)) keepSet.add(url)
    if (!touches(load, b)) continue
    // Önce görünenler (merkeze yakından uzağa), sonra çevredekiler
    const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) + (touches(rect, b) ? 0 : 1e9)
    if (!dist.has(url) || d < dist.get(url)) dist.set(url, d)
  }
  return { want: [...dist.keys()].sort((a, b) => dist.get(a) - dist.get(b)), keep: keepSet }
}

/**
 * items + görünen alan (yüzey koordinatı, null → hepsi) → getImage / getAnim.
 * version her yükleme / bırakmada artar (picture'lar yeniden birleştirilsin).
 */
export function useEditorImages(items, viewRect) {
  const cache = useRef(new Map()) // url → { img } | { anim } | { failed: true }
  const queue = useRef([])
  const busy = useRef(false)
  const mounted = useRef(true)
  const bump = useRef(null)
  const [version, setVersion] = useState(0)

  const { want, keep } = useMemo(() => wantedUrls(items, viewRect), [items, viewRect])
  const wantKey = want.join('\n')
  const keepRef = useRef(keep)
  useEffect(() => { keepRef.current = keep }, [keep])

  const changed = useCallback(() => {
    clearTimeout(bump.current)
    bump.current = setTimeout(() => { if (mounted.current) setVersion((v) => v + 1) }, BUMP_MS)
  }, [])

  // Tek tek çöz: sıradaki (en yakın) görsel
  const drain = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      while (mounted.current && queue.current.length) {
        const url = queue.current.shift()
        if (cache.current.has(url) || !keepRef.current.has(url)) continue
        const data = await loadImageData(url, { high: true })
        let entry = { failed: true }
        if (data) {
          if (isAnimatedUrl(url)) {
            try {
              const anim = Skia.AnimatedImage.MakeAnimatedImageFromEncoded(data)
              if (anim && anim.getFrameCount() > 1) entry = { anim }
              else anim?.dispose?.()
            } catch { /* durağan olarak dene */ }
          }
          if (!entry.anim) {
            try {
              const img = Skia.Image.MakeImageFromEncoded(data)
              if (img) entry = { img }
            } catch { /* çözülemedi */ }
          }
          data.dispose?.() // görsel / çözücü baytlara kendi referansını tutar
        }
        if (!mounted.current || !keepRef.current.has(url)) { entry.img?.dispose?.(); entry.anim?.dispose?.(); continue }
        cache.current.set(url, entry)
        changed()
        await new Promise((r) => setTimeout(r, 0)) // bir kare nefes
      }
    } finally {
      busy.current = false
    }
  }, [changed])

  useEffect(() => {
    // Uzaklaşanları bırak (başarısızlar da: geri gelince yeniden denensin)
    let released = false
    for (const [url, e] of cache.current) {
      if (keep.has(url)) continue
      cache.current.delete(url)
      // Ekrandaki son çizim bu görsele komut referansıyla bağlı; JS sarmalayıcısı bırakılabilir
      e.img?.dispose?.()
      e.anim?.dispose?.()
      released = true
    }
    if (released) changed()
    // Yeni sıra: yakından uzağa; kuyruktaki eski istekler bu sıraya göre yeniden dizilir
    queue.current = want.filter((u) => !cache.current.has(u))
    drain()
  }, [wantKey, keep, changed, drain]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    mounted.current = false
    clearTimeout(bump.current)
    const all = [...cache.current.values()]
    cache.current.clear()
    // Kareler bir an daha çizilebilir: biraz sonra bırak
    setTimeout(() => all.forEach((e) => { e.img?.dispose?.(); e.anim?.dispose?.() }), 300)
  }, [])

  const getImage = useCallback((url) => cache.current.get(url)?.img ?? null, [])
  const getAnim = useCallback((url) => cache.current.get(url)?.anim ?? null, [])
  return { getImage, getAnim, version }
}

/**
 * Öğe başına picture önbelleği: öğe nesnesi, görseli ve "bulunulan oda" aynı kaldıkça
 * yeniden kaydedilmez (metin yerleşimi pahalı). Kayıt düzenleyici açıkken yaşar.
 */
function useItemPictureCache(cv) {
  const cache = useRef(new Map()) // id → { item, img, room, pic }
  useEffect(() => () => {
    const pics = [...cache.current.values()].map((e) => e.pic)
    cache.current.clear()
    setTimeout(() => pics.forEach((p) => p?.dispose?.()), 400)
  }, [])
  const record = useCallback((it, { getImage, currentRoomId }) => {
    const url = imageUrlOf(it)
    const img = url ? getImage(url) : null
    const room = it.type === 'room' ? currentRoomId : null
    const hit = cache.current.get(it.id)
    if (hit && hit.item === it && hit.img === img && hit.room === room) return hit.pic
    let pic = null
    try {
      pic = cv.recordItems([it], { getImage: () => img, releaseImage: keepImage, currentRoomId })
    } catch (err) {
      if (__DEV__) console.warn('[canvas-editor] kayıt', err?.message ?? err)
    }
    if (hit?.pic) setTimeout(() => hit.pic.dispose?.(), 400) // eski kayıt ekrandan inene kadar
    cache.current.set(it.id, { item: it, img, room, pic })
    return pic
  }, [cv])
  // Artık olmayan öğelerin kayıtları bırakılır
  const prune = useCallback((ids) => {
    for (const [id, e] of cache.current) {
      if (ids.has(id)) continue
      cache.current.delete(id)
      if (e.pic) setTimeout(() => e.pic.dispose?.(), 400)
    }
  }, [])
  return { record, prune }
}

function joinPictures(pics) {
  if (pics.length === 1) return { pic: pics[0], own: false }
  const rec = Skia.PictureRecorder()
  const c = rec.beginRecording(Skia.XYWHRect(-1e5, -1e5, 2e5, 2e5))
  for (const p of pics) c.drawPicture(p)
  const pic = rec.finishRecordingAsPicture()
  rec.dispose?.()
  return { pic, own: true }
}

/**
 * items → katmanlar: { key, pic } | { key, gif: item, url }. Oklar en üstte (web
 * ArrowLayer gibi). Birleştirilmiş picture'lar yenileri ekrana geçtikten sonra bırakılır.
 */
export function useItemLayers(cv, items, { getImage, getAnim, version, currentRoomId }) {
  const { record: itemPic, prune } = useItemPictureCache(cv)
  useEffect(() => { prune(new Set(items.map((it) => it.id))) }, [items, prune])
  const layers = useMemo(() => {
    if (!cv || !items.length) return []
    const opts = { getImage, currentRoomId }
    const out = []
    let run = []
    const flush = (key) => {
      const pics = run.filter(Boolean)
      run = []
      if (!pics.length) return
      const { pic, own } = joinPictures(pics)
      out.push({ key, pic, own })
    }
    for (const it of items) {
      if (it.type === 'arrow') continue
      const url = it.type === 'image' ? it.url : null
      if (url && getAnim(url)) {
        flush(`p${out.length}`)
        out.push({ key: `g:${it.id}`, gif: it, url })
      } else run.push(itemPic(it, opts))
    }
    flush(`p${out.length}`)
    run = items.filter((it) => it.type === 'arrow').map((it) => itemPic(it, opts))
    flush('arrows')
    return out
  }, [cv, items, getImage, getAnim, version, currentRoomId, itemPic]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    const own = layers.filter((l) => l.own).map((l) => l.pic)
    if (own.length) setTimeout(() => own.forEach((p) => p.dispose?.()), 400)
  }, [layers])
  return layers
}
