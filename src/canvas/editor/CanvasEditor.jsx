// Canvas tam ekran düzenleyici — duvardaki canvas'a basılı tutunca yatay açılır.
// Web CanvasMesh'in tam ekran düzenleme modunun mobil karşılığı:
//  - Tüm ekran canvas yüzeyidir; düğmeler üstünde sabit durur (araçlar sol üst, çıkış
//    sağ üst). Duvarda görünen çerçeve (1920 × pxH mantıksal px) ekrana sığdırılır,
//    dışı hafif karartılır. Tek parmak boşlukta kaydırır, iki parmak yakınlaştırır,
//    boşluğa çift dokunuş görünümü %100'e döndürür.
//  - Öğeye dokun → seç; sürükle → taşı; köşe tutamacı → orantılı boyutlandır (web gibi).
//  - Araçlar düğmesiyle açılır-kapanır yan menüden öğe eklenir (oda linki, resim).
//  - Boş bir yere dokunuş → orada yapıştır simgesi; canvas panosu (Kopyala / Kes),
//    duvarda kopyalanan resim / metin tile'ı ya da telefonun panosu o noktaya bırakılır.
//  - Seçili öğe: kopyala, kes, çoğalt, sil; odaya git (oda linki), arka plan rengi
//    (oda linki / metin); resimde tam ekran görüntüle, galeriye kaydet, panoya kopyala.
//  - GIF'ler kare kare oynar (GifLayer).
// Her değişiklik web ile aynı uçla kaydedilir (useCanvasDoc).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, BackHandler, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as ScreenOrientation from 'expo-screen-orientation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Canvas, Circle, Group, Picture, Rect, RoundedRect, Skia } from '@shopify/react-native-skia'
import { useStore } from '../../store/useStore'
import { getCanvasRenderer } from '../../markdown/skia'
import { canvasPxSize, hitTestItems, itemBox } from '../render'
import { colors, fonts, type, space, radius } from '../../theme'
import { useCanvasDoc } from './useCanvasDoc'
import { touches, useEditorImages, useItemLayers } from './usePictures'
import { GifItem, useGifClock } from './GifLayer'
import { RoomLinkPanel } from './RoomLinkPanel'
import { ImagePanel } from './ImagePanel'
import { ImageViewer, imageOrder } from './ImageViewer'
import { copyImageToPhone, pasteFrom, pasteSources, saveImageToPhone } from './canvasMedia'
import { Icon } from '../../components/Icon'
import { BG_COLORS, makeRoomItem, newId } from './roomLink'

const SIDEBAR = 248        // açık yan menü genişliği
const FAB = 44             // yüzen düğme çapı
const DOUBLE_TAP_MS = 320
const MOVE_SLOP = 6        // px — bundan az hareket dokunuştur
const HANDLE_HIT = 30      // px — köşe tutamacı isabet yarıçapı
const ZOOM_MIN = 0.15
const ZOOM_MAX = 8
const SEL = '#60a5fa'
const SYNC_RED = '#ef4444'
const BG_TYPES = new Set(['text', 'room'])
const DIM = 'rgba(0,0,0,0.38)' // duvarda görünmeyen alan
const VIEW_THROTTLE = 200 // ms — görünen alan (görsel yükleme / GIF oynatma) kaydırırken bu sıklıkla güncellenir
const PASTE_LIFT = 58          // yapıştır balonu dokunulan noktanın bu kadar üstünde (çift dokunuşu engellemesin)
const TYPE_LABEL = { image: 'Resim', text: 'Metin', room: 'Oda linki', link: 'Bağlantı', youtube: 'YouTube', insta: 'Instagram', music: 'Müzik', pdf: 'PDF', note: 'Not', notebook: 'Defter' }

const A4 = 297 / 210
const a4MaxH = (w) => Math.max(60, Math.round((w || 0) * A4))
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

const sidebarMemo = { open: true } // oturum boyunca hatırlanır

export function CanvasEditor({ onGo }) {
  const editor = useStore((s) => s.canvasEditor)
  if (!editor) return null
  return <EditorHost key={editor.mediaId} mediaId={editor.mediaId} onGo={onGo} />
}

// Yönü yataya kilitler, çizici + yazı tiplerini hazırlar; ikisi bitince düzenleyici açılır
function EditorHost({ mediaId, onGo }) {
  const [media] = useState(() => useStore.getState().worldMedia.find((m) => m.id === mediaId) ?? null)
  const { width, height } = useWindowDimensions()
  const [cv, setCv] = useState(null)
  const [waited, setWaited] = useState(false) // yön kilidi desteklenmiyorsa (iPad bölünmüş ekran) yine aç

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {})
    const t = setTimeout(() => setWaited(true), 1500)
    return () => {
      clearTimeout(t)
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!media) { useStore.getState().closeCanvasEditor(); return }
    let alive = true
    getCanvasRenderer()
      .then((r) => { if (alive) setCv(r) })
      .catch((err) => {
        Alert.alert('Canvas açılamadı', err?.message ?? String(err))
        useStore.getState().closeCanvasEditor()
      })
    return () => { alive = false }
  }, [media])

  const ready = media && cv && (width > height || waited)
  return (
    <View style={[StyleSheet.absoluteFill, styles.host]}>
      <StatusBar hidden />
      {ready ? <Editor media={media} cv={cv} onGo={onGo} /> : <ActivityIndicator color={colors.accent} size="large" />}
    </View>
  )
}

function Editor({ media, cv, onGo }) {
  const insets = useSafeAreaInsets()
  const doc = useCanvasDoc(media)
  const { items, view, setItems, setView, commitView, bg, flush, publish } = doc
  const currentRoomId = useStore((s) => s.currentRoomId)
  const { pxW, pxH } = canvasPxSize(media.width, media.height)

  const [size, setSize] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [live, setLiveState] = useState(null) // sürüklenen / boyutlanan öğenin anlık geometrisi
  const liveRef = useRef(null)
  const setLive = (v) => { liveRef.current = v; setLiveState(v) }
  const [sidebar, setSidebarState] = useState(sidebarMemo.open)
  const [panel, setPanel] = useState(null) // 'room' | 'image' | null
  const [palette, setPalette] = useState(false)
  const [undo, setUndo] = useState(null) // { item, index }
  const [closing, setClosing] = useState(false)
  const [pasteAt, setPasteAt] = useState(null)   // yüzey noktası: { x, y }
  const [pasteSrc, setPasteSrc] = useState(null) // null: bakılıyor | [{ key, label, hint }]
  const [pasteMenu, setPasteMenu] = useState(false)
  const [pasting, setPasting] = useState(false)
  const pasteToken = useRef(0)
  const pasteAtRef = useRef(null)
  useEffect(() => { pasteAtRef.current = pasteAt }, [pasteAt])
  const [toast, setToast] = useState(null) // { text, ok }
  const [viewer, setViewer] = useState(null) // resim görüntüleyici: dizin
  const [imgBusy, setImgBusy] = useState(null) // 'save' | 'copy'

  const selectedRef = useRef(null)
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  const setSidebar = (open) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setSidebarState(open)
  }
  useEffect(() => { sidebarMemo.open = sidebar }, [sidebar])

  // --- Çerçeve: duvarda görünen alan (pxW × pxH) güvenli alana sığdırılır ---
  const geo = useMemo(() => {
    if (!size) return null
    const left = insets.left
    const right = insets.right
    const top = 0
    const bottom = insets.bottom
    const aw = Math.max(1, size.w - left - right)
    const ah = Math.max(1, size.h - top - bottom)
    const k = Math.min(aw / pxW, ah / pxH)
    return { k, ox: left + (aw - pxW * k) / 2, oy: top + (ah - pxH * k) / 2 }
  }, [size, insets.left, insets.right, insets.bottom, pxW, pxH])
  const lastTap = useRef({ t: 0, x: 0, y: 0 })
  const lastItemTap = useRef({ t: 0, id: null })
  const geoRef = useRef(geo)
  useEffect(() => { geoRef.current = geo }, [geo])

  // --- Çizim: değişmeyen öğeler tek picture; hareket eden öğe ayrı (her harekette kaydı ucuz) ---
  // Görünen alan (yüzey koordinatı): yalnız buradaki görseller çözülür, GIF'ler oynar
  const rawRect = useMemo(() => {
    if (!geo || !size) return null
    const x0 = ((0 - geo.ox) / geo.k - view.pan.x) / view.zoom
    const y0 = ((0 - geo.oy) / geo.k - view.pan.y) / view.zoom
    return { x0, y0, x1: x0 + size.w / geo.k / view.zoom, y1: y0 + size.h / geo.k / view.zoom }
  }, [geo, size, view])
  const viewRect = useThrottled(rawRect, VIEW_THROTTLE)
  const { getImage, getAnim, version } = useEditorImages(items, viewRect)
  const liveId = live?.id ?? null
  const baseItems = useMemo(() => (liveId ? items.filter((it) => it.id !== liveId) : items), [items, liveId])
  const liveItems = useMemo(() => {
    if (!live) return []
    const it = items.find((i) => i.id === live.id)
    return it ? [{ ...it, ...live }] : []
  }, [items, live])
  const layerOpts = { getImage, getAnim, version, currentRoomId }
  const baseLayers = useItemLayers(cv, baseItems, layerOpts)
  const liveLayers = useItemLayers(cv, liveItems, layerOpts)

  // GIF'ler: adres başına tek oynatıcı
  const gifKey = useMemo(() => [...new Set(items.filter((it) => it.type === 'image' && it.url && getAnim(it.url)).map((it) => it.url))].sort().join('\n'), [items, getAnim, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const gifUrls = useMemo(() => (gifKey ? gifKey.split('\n') : []), [gifKey])
  const gifVisible = useMemo(() => {
    const set = new Set()
    for (const it of items) if (it.type === 'image' && it.url && touches(viewRect, itemBox(it))) set.add(it.url)
    for (const it of liveItems) if (it.type === 'image' && it.url) set.add(it.url) // sürüklenen GIF oynamaya devam etsin
    return set
  }, [items, liveItems, viewRect])
  const gifClock = useGifClock(gifUrls, getAnim, version, gifVisible)

  const images = useMemo(() => items.filter((it) => it.type === 'image' && it.url).sort(imageOrder), [items])

  const fitMatrix = useMemo(() => (geo ? Skia.Matrix().translate(geo.ox, geo.oy).scale(geo.k, geo.k) : Skia.Matrix()), [geo])
  const viewMatrix = useMemo(() => Skia.Matrix().translate(view.pan.x, view.pan.y).scale(view.zoom, view.zoom), [view])

  const selected = selectedId ? (liveItems[0]?.id === selectedId ? liveItems[0] : items.find((i) => i.id === selectedId)) : null
  const selBox = selected ? itemBox(selected) : null
  const s = geo ? geo.k * view.zoom : 1 // yüzey → ekran ölçeği

  // --- Koordinatlar ---
  const toSurface = (x, y) => {
    const g = geoRef.current
    const v = doc.viewRef.current
    return { x: ((x - g.ox) / g.k - v.pan.x) / v.zoom, y: ((y - g.oy) / g.k - v.pan.y) / v.zoom }
  }
  const toScreen = (sx, sy) => {
    const g = geoRef.current
    const v = doc.viewRef.current
    return { x: g.ox + (sx * v.zoom + v.pan.x) * g.k, y: g.oy + (sy * v.zoom + v.pan.y) * g.k }
  }
  // Görünen çerçevenin ortası (yeni öğe buraya)
  const centerSurface = () => {
    const v = doc.viewRef.current
    return { x: (pxW / 2 - v.pan.x) / v.zoom, y: (pxH / 2 - v.pan.y) / v.zoom }
  }

  // --- Dokunmatik: kaydır / yakınlaştır / taşı / boyutlandır ---
  const gest = useRef(null)

  const startPinch = (ts) => {
    const [a, b] = ts
    setLive(null) // iki parmak → öğe sürükleme iptal
    hidePaste()
    gest.current = {
      mode: 'pinch',
      d0: Math.max(1, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)),
      m0: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 },
      view0: doc.viewRef.current,
    }
  }

  const onTouchStart = (e) => {
    if (!geoRef.current) return
    const ts = e.nativeEvent.touches
    if (ts.length >= 2) { startPinch(ts); return }
    if (ts.length !== 1) return
    const { pageX: x, pageY: y } = ts[0]
    setPalette(false)
    const base = { x0: x, y0: y, moved: false, pan0: doc.viewRef.current.pan }
    const list = doc.itemsRef.current
    const sel = selectedRef.current ? list.find((i) => i.id === selectedRef.current) : null
    if (sel) {
      const b = itemBox(sel)
      const h = toScreen(b.x + b.w, b.y + b.h)
      if (Math.hypot(h.x - x, h.y - y) < HANDLE_HIT) {
        gest.current = { ...base, mode: 'resize', item: sel, box: b }
        return
      }
    }
    const p = toSurface(x, y)
    const hit = hitTestItems(list, p.x, p.y)
    if (hit) setSelectedId(hit.id)
    gest.current = { ...base, mode: hit ? 'drag' : 'pan', item: hit }
  }

  const onTouchMove = (e) => {
    const g = gest.current
    if (!g || !geoRef.current) return
    const ts = e.nativeEvent.touches
    const k = geoRef.current.k
    if (g.mode === 'pinch') {
      if (ts.length < 2) return
      const [a, b] = ts
      const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
      const m = { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }
      const { ox, oy } = geoRef.current
      const v0 = g.view0
      const zoom = clamp(v0.zoom * (d / g.d0), ZOOM_MIN, ZOOM_MAX)
      // Parmakların ortasındaki yüzey noktası parmakları izlesin
      const sx = ((g.m0.x - ox) / k - v0.pan.x) / v0.zoom
      const sy = ((g.m0.y - oy) / k - v0.pan.y) / v0.zoom
      setView({ zoom, pan: { x: (m.x - ox) / k - sx * zoom, y: (m.y - oy) / k - sy * zoom } })
      return
    }
    if (ts.length >= 2) { startPinch(ts); return }
    const t = ts[0]
    if (!t) return
    const dx = t.pageX - g.x0
    const dy = t.pageY - g.y0
    if (!g.moved && Math.hypot(dx, dy) < MOVE_SLOP) return
    if (!g.moved) hidePaste()
    g.moved = true
    const zs = k * doc.viewRef.current.zoom
    if (g.mode === 'pan') {
      setView({ zoom: doc.viewRef.current.zoom, pan: { x: g.pan0.x + dx / k, y: g.pan0.y + dy / k } })
    } else if (g.mode === 'drag') {
      setLive({ id: g.item.id, x: g.item.x + dx / zs, y: g.item.y + dy / zs })
    } else if (g.mode === 'resize') {
      // Web köşe tutamacı: genişlik serbest, yükseklik orantılı; metin/not puntosu da ölçeklenir
      const { box, item } = g
      const w = Math.max(40, box.w + dx / zs)
      const sc = w / box.w
      const next = { id: item.id, w, h: box.h * sc }
      if (item.type === 'text' || item.type === 'note') next.fontSize = Math.max(6, Math.round((item.fontSize || 30) * sc))
      if (item.type === 'text') next.h = Math.min(next.h, a4MaxH(w))
      setLive(next)
    }
  }

  const onTouchEnd = (e) => {
    const g = gest.current
    if (!g) return
    const rest = e.nativeEvent.touches
    if (g.mode === 'pinch') {
      if (rest.length === 1) {
        // Kalan parmakla kaydırmaya devam
        gest.current = { mode: 'pan', x0: rest[0].pageX, y0: rest[0].pageY, moved: true, pan0: doc.viewRef.current.pan }
      } else if (rest.length === 0) {
        gest.current = null
        commitView()
      }
      return
    }
    if (rest.length > 0) return
    gest.current = null
    if (g.mode === 'pan') {
      if (g.moved) { commitView(); return }
      setSelectedId(null) // boşluğa dokunuş → seçim kalkar
      const now = e.nativeEvent.timestamp ?? 0 // ms (dokunuş olayının zamanı)
      const prev = lastTap.current
      if (now - prev.t < DOUBLE_TAP_MS && Math.hypot(g.x0 - prev.x, g.y0 - prev.y) < 40) {
        lastTap.current = { t: 0, x: 0, y: 0 }
        hidePaste()
        resetView() // çift dokunuş → %100, kaydırma sıfır (web: yüzde etiketine tık)
      } else {
        lastTap.current = { t: now, x: g.x0, y: g.y0 }
        showPaste(toSurface(g.x0, g.y0)) // boş yere dokunuş → orada yapıştır simgesi
      }
      return
    }
    if (!g.moved) {
      // Öğeye dokunuş: seçildi (onTouchStart). Resme çift dokunuş → tam ekran (web: çift tık)
      hidePaste()
      const now = e.nativeEvent.timestamp ?? 0
      const prev = lastItemTap.current
      if (g.item?.type === 'image' && g.item.url && prev.id === g.item.id && now - prev.t < DOUBLE_TAP_MS) {
        lastItemTap.current = { t: 0, id: null }
        openViewer(g.item.id)
      } else {
        lastItemTap.current = { t: now, id: g.item?.id ?? null }
      }
      return
    }
    const cur = liveRef.current
    setLive(null)
    if (cur) setItems((prev) => prev.map((it) => (it.id === cur.id ? { ...it, ...cur } : it)))
  }

  const onTouchCancel = () => {
    gest.current = null
    setLive(null)
  }

  // --- Eylemler ---
  const closeRef = useRef(false)
  const retryRef = useRef(null)
  const close = useCallback(async (after) => {
    if (closeRef.current) return
    closeRef.current = true
    setClosing(true)
    const leave = () => {
      publish()
      useStore.getState().closeCanvasEditor()
      after?.()
    }
    if (await flush()) { leave(); return }
    closeRef.current = false
    setClosing(false)
    Alert.alert('Kaydedilemedi', 'Son değişiklikler sunucuya gönderilemedi. Sunucu açık mı?', [
      { text: 'Tekrar dene', onPress: () => retryRef.current?.(after) },
      { text: 'Yine de çık', style: 'destructive', onPress: leave },
    ])
  }, [flush, publish])
  useEffect(() => { retryRef.current = close }, [close])

  const goRoom = (it) => {
    const sync = media.syncGroupId ? { syncGroupId: media.syncGroupId, fromId: media.id } : null
    close(() => onGo?.(it.roomId, it.roomName, sync))
  }

  const addRoomLink = (roomId, roomName) => {
    const ni = makeRoomItem(roomId, roomName, centerSurface())
    setItems((prev) => [...prev, ni])
    setSelectedId(ni.id)
    setPanel(null)
    setSidebar(false)
  }

  const flash = (text, ok = true) => setToast({ text, ok })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.ok ? 1800 : 3600)
    return () => clearTimeout(t)
  }, [toast])

  // --- Yapıştır: boş yere dokununca çıkan simge ---
  function hidePaste() {
    pasteToken.current++
    setPasteAt(null)
    setPasteMenu(false)
  }
  function showPaste(pt) {
    const token = ++pasteToken.current
    setPasteAt(pt)
    setPasteMenu(false)
    setPasteSrc(null)
    pasteSources()
      .then((list) => { if (pasteToken.current === token) setPasteSrc(list) })
      .catch(() => { if (pasteToken.current === token) setPasteSrc([]) })
  }
  const doPaste = async (key) => {
    const pt = pasteAt
    if (!pt || pasting) return
    setPasting(true)
    setPasteMenu(false)
    try {
      const res = await pasteFrom(key, { mediaId: media.id, pt, textHeight: cv.textHeight })
      if (res.items.length) {
        setItems((prev) => [...prev, ...res.items])
        setSelectedId(res.items.length === 1 ? res.items[0].id : null)
      }
      flash(res.msg)
    } catch (err) {
      flash(err?.message ?? String(err), false)
    } finally {
      setPasting(false)
      hidePaste()
    }
  }
  const onPastePress = () => {
    if (!pasteSrc || pasting) return // pano hâlâ okunuyor
    if (!pasteSrc.length) { hidePaste(); flash('Pano boş — bir öğeyi Kopyala ya da Kes ile panoya al', false); return }
    if (pasteSrc.length === 1) doPaste(pasteSrc[0].key)
    else setPasteMenu((m) => !m)
  }

  // --- Kopyala / kes (web Ctrl+C / Ctrl+X; pano canvas'lar arası, uygulama kapansa da kalır) ---
  const copySel = (cut) => {
    if (!selected) return
    useStore.getState().setCanvasClipboard({ sourceId: media.id, items: [selected], mode: cut ? 'cut' : 'copy' })
    if (cut) {
      setItems((prev) => prev.filter((i) => i.id !== selected.id))
      setSelectedId(null)
      setPalette(false)
    }
    flash(`${TYPE_LABEL[selected.type] ?? 'Öğe'} ${cut ? 'kesildi' : 'kopyalandı'} · boş bir yere dokunup yapıştır`)
  }

  // --- Resim ---
  function openViewer(id) {
    const i = images.findIndex((it) => it.id === id)
    if (i >= 0) { hidePaste(); setViewer(i) }
  }
  const closeViewer = () => {
    // Kapanınca en son bakılan resim seçili kalsın (web gibi)
    if (viewer != null && images[viewer]) setSelectedId(images[viewer].id)
    setViewer(null)
  }
  const imageAction = async (kind) => {
    if (!selected?.url || imgBusy) return
    setImgBusy(kind)
    try {
      if (kind === 'save') { await saveImageToPhone(selected.url); flash('Galeriye kaydedildi') }
      else { await copyImageToPhone(selected.url); flash('Resim telefonun panosuna kopyalandı') }
    } catch (err) {
      flash(err?.message ?? String(err), false)
    } finally {
      setImgBusy(null)
    }
  }
  const addImages = (list, msg) => {
    setItems((prev) => [...prev, ...list])
    setSelectedId(list.length === 1 ? list[0].id : null)
    setPanel(null)
    setSidebar(false)
    flash(msg)
  }

  const duplicate = () => {
    if (!selected) return
    const copy = { ...selected, id: newId(), x: selected.x + 30, y: selected.y + 30 }
    setItems((prev) => [...prev, copy])
    setSelectedId(copy.id)
  }

  const remove = () => {
    if (!selected) return
    const index = items.findIndex((i) => i.id === selected.id)
    setUndo({ item: selected, index })
    setItems((prev) => prev.filter((i) => i.id !== selected.id))
    setSelectedId(null)
    setPalette(false)
  }
  const restore = () => {
    if (!undo) return
    setItems((prev) => { const next = [...prev]; next.splice(Math.min(undo.index, next.length), 0, undo.item); return next })
    setSelectedId(undo.item.id)
    setUndo(null)
  }
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(t)
  }, [undo])

  const applyBg = (color) => {
    if (!selected) return
    const id = selected.id
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it
      if (color == null) { const { bgColor: _drop, ...rest } = it; return rest }
      return { ...it, bgColor: color }
    }))
  }

  function resetView() { setView({ zoom: 1, pan: { x: 0, y: 0 } }); commitView() }

  // Android geri tuşu: önce açık katman kapanır
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewer != null) return false // görüntüleyici kendi geri tuşunu dinler
      if (panel) setPanel(null)
      else if (pasteAtRef.current) hidePaste()
      else if (palette) setPalette(false)
      else if (selectedRef.current) setSelectedId(null)
      else close()
      return true
    })
    return () => sub.remove()
  }, [panel, palette, close, viewer])

  const renderLayers = (layers, prefix) => layers.map((l) => (l.pic
    ? <Picture key={prefix + l.key} picture={l.pic} />
    : <GifItem key={prefix + l.key} item={l.gif} clock={gifClock} index={gifUrls.indexOf(l.url)} />))

  const edgeL = insets.left + space.md
  const edgeR = insets.right + space.md
  const panelLeft = sidebar ? edgeL + SIDEBAR + space.md : edgeL

  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {/* Tüm ekran: canvas yüzeyi + dokunmatik */}
      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {geo && size && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Canvas style={StyleSheet.absoluteFill}>
              <Rect x={0} y={0} width={size.w} height={size.h} color={bg} />
              <Group matrix={fitMatrix}>
                <Group matrix={viewMatrix}>
                  {renderLayers(baseLayers, '')}
                  {renderLayers(liveLayers, 'L')}
                </Group>
              </Group>
              {/* Duvarda görünmeyen kısım hafif karartılır */}
              <Rect x={0} y={0} width={size.w} height={geo.oy} color={DIM} />
              <Rect x={0} y={geo.oy + pxH * geo.k} width={size.w} height={Math.max(0, size.h - geo.oy - pxH * geo.k)} color={DIM} />
              <Rect x={0} y={geo.oy} width={geo.ox} height={pxH * geo.k} color={DIM} />
              <Rect x={geo.ox + pxW * geo.k} y={geo.oy} width={Math.max(0, size.w - geo.ox - pxW * geo.k)} height={pxH * geo.k} color={DIM} />
              <Group matrix={fitMatrix}>
                {media.syncGroupId && (
                  <RoundedRect x={0} y={0} width={pxW} height={pxH} r={4} style="stroke" strokeWidth={4 / geo.k} color={SYNC_RED} />
                )}
                {selBox && (
                  <Group matrix={viewMatrix}>
                    <Rect x={selBox.x} y={selBox.y} width={selBox.w} height={selBox.h} style="stroke" strokeWidth={2 / s} color={SEL} />
                    <Circle cx={selBox.x + selBox.w} cy={selBox.y + selBox.h} r={11 / s} color={SEL} />
                    <Circle cx={selBox.x + selBox.w} cy={selBox.y + selBox.h} r={5 / s} color="#ffffff" />
                  </Group>
                )}
              </Group>
            </Canvas>
          </View>
        )}
        {geo && !items.length && (
          <View pointerEvents="none" style={[styles.emptyWrap, { left: geo.ox, top: geo.oy, width: pxW * geo.k, height: pxH * geo.k }]}>
            <Text style={styles.emptyTitle}>Boş canvas</Text>
            <Text style={styles.emptyHint}>Araçlar menüsünden öğe ekle · boş bir yere dokun: yapıştır</Text>
          </View>
        )}
      </View>

      {/* Sağ üst: çıkış (kaydeder) */}
      <View style={[styles.fabRow, { top: space.md, right: edgeR }]} pointerEvents="box-none">
        {doc.status === 'error' && <Text style={styles.error}>kaydedilemedi</Text>}
        <Fab icon="close" label="Kapat" onPress={() => close()} busy={closing} />
      </View>

      {/* Sol üst: araçlar (yan menü) */}
      {!sidebar && (
        <View style={[styles.fabRow, { top: space.md, left: edgeL }]} pointerEvents="box-none">
          <Fab icon="tools" label="Araçları aç" onPress={() => setSidebar(true)} />
        </View>
      )}

      {/* Seçili öğe eylemleri */}
      {selected && !live && (
        <View style={[styles.selBar, { left: panelLeft, right: edgeR, bottom: insets.bottom + space.md }]} pointerEvents="box-none">
          {palette && BG_TYPES.has(selected.type) && (
            <View style={styles.palette}>
              <Swatch color={null} active={selected.bgColor === undefined} onPress={() => applyBg(null)} />
              {BG_COLORS.map((c) => <Swatch key={c} color={c} active={selected.bgColor === c} onPress={() => applyBg(c)} />)}
            </View>
          )}
          <View style={styles.selActions}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selScroll} keyboardShouldPersistTaps="handled">
              {selected.type === 'room' && (
                <Text style={styles.selName} numberOfLines={1}>🏠 {selected.roomName}</Text>
              )}
              {selected.type === 'room' && selected.roomId && (
                <ActionButton label="Odaya git" primary onPress={() => goRoom(selected)} />
              )}
              {selected.type === 'image' && selected.url && (
                <>
                  <ActionButton icon="expand" label="Tam ekran" primary onPress={() => openViewer(selected.id)} />
                  <ActionButton icon="download" label="Kaydet" busy={imgBusy === 'save'} onPress={() => imageAction('save')} />
                  <ActionButton icon="image" label="Telefona kopyala" busy={imgBusy === 'copy'} onPress={() => imageAction('copy')} />
                </>
              )}
              {BG_TYPES.has(selected.type) && <ActionButton label="Renk" active={palette} onPress={() => setPalette((p) => !p)} />}
              <ActionButton icon="copy" label="Kopyala" onPress={() => copySel(false)} />
              <ActionButton icon="cut" label="Kes" onPress={() => copySel(true)} />
              <ActionButton icon="duplicate" label="Çoğalt" onPress={duplicate} />
              <ActionButton icon="trash" label="Sil" danger onPress={remove} />
            </ScrollView>
          </View>
        </View>
      )}

      {undo && !selected && (
        <View style={[styles.undo, { bottom: insets.bottom + space.md, left: panelLeft }]}>
          <Text style={styles.undoText}>Silindi</Text>
          <Pressable onPress={restore} hitSlop={8} accessibilityRole="button">
            <Text style={styles.undoAction}>Geri al</Text>
          </Pressable>
        </View>
      )}

      {/* Boş yere dokunuş: yapıştır simgesi (dokunulan noktanın üstünde; nokta halkayla işaretli) */}
      {pasteAt && geo && !live && (() => {
        const px = geo.ox + (pasteAt.x * view.zoom + view.pan.x) * geo.k
        const py = geo.oy + (pasteAt.y * view.zoom + view.pan.y) * geo.k
        const empty = pasteSrc && !pasteSrc.length
        const one = pasteSrc?.length === 1 ? pasteSrc[0] : null
        const above = py - PASTE_LIFT > insets.top + 24
        const by = above ? py - PASTE_LIFT : py + PASTE_LIFT
        return (
          <>
            <View pointerEvents="none" style={[styles.pasteDot, { left: px - 9, top: py - 9 }]} />
            <View style={[styles.pasteWrap, { left: px - 120, top: by - 22 }]} pointerEvents="box-none">
              <Pressable
                onPress={onPastePress}
                hitSlop={8}
                style={({ pressed }) => [styles.pasteBtn, empty && styles.pasteEmpty, pressed && styles.fabPressed]}
                accessibilityRole="button"
                accessibilityLabel={one ? `Yapıştır: ${one.label}` : 'Yapıştır'}
              >
                {pasting || !pasteSrc ? <ActivityIndicator color={colors.text} size="small" /> : <Icon name="paste" size={20} color={empty ? colors.muted : colors.accent} />}
                {pasteSrc && !pasting && (
                  <Text style={[styles.pasteLabel, empty && { color: colors.muted }]} numberOfLines={1}>
                    {empty ? 'Pano boş' : one ? one.label : `Yapıştır · ${pasteSrc.length}`}
                  </Text>
                )}
              </Pressable>
              {pasteMenu && pasteSrc?.length > 1 && (
                <View style={[styles.pasteMenu, above ? { bottom: 50 } : { top: 50 }]}>
                  {pasteSrc.map((src) => (
                    <Pressable key={src.key} onPress={() => doPaste(src.key)} style={({ pressed }) => [styles.pasteItem, pressed && styles.pressed]} accessibilityRole="button">
                      <Text style={styles.pasteItemLabel} numberOfLines={1}>{src.label}</Text>
                      <Text style={styles.pasteItemHint} numberOfLines={1}>{src.hint}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </>
        )
      })()}

      {toast && (
        <View pointerEvents="none" style={[styles.toast, { top: space.md + FAB + space.sm, left: panelLeft, right: edgeR }]}>
          <Text style={[styles.toastText, { color: toast.ok ? '#4ade80' : colors.danger }]} numberOfLines={2}>{toast.text}</Text>
        </View>
      )}

      {/* Yan menü: canvas'ın üstünde yüzer */}
      {sidebar && (
        <View style={[styles.sidebar, { left: edgeL, top: space.md, bottom: insets.bottom + space.md }]}>
          <Pressable
            onPress={() => setSidebar(false)}
            style={({ pressed }) => [styles.sideHead, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Araçları kapat"
          >
            <Icon name="tools" size={20} color={colors.accent} />
            <Text style={styles.sideTitle}>Araçlar</Text>
            <Icon name="close" size={16} color={colors.muted} />
          </Pressable>
          <Text style={styles.sideSection}>EKLE</Text>
          <SideItem icon="home" label="Oda linki" hint="Var olan odaya bağla ya da yeni oda aç" onPress={() => setPanel('room')} />
          <SideItem icon="image" label="Resim" hint="Galeri, kamera, pano ya da bağlantı · GIF oynar" onPress={() => setPanel('image')} />
          <Text style={styles.sideNote}>{"Metin, not ve oklar şimdilik web'den eklenir."}</Text>
          <Text style={styles.sideTip}>{'Boş yere dokun: yapıştır · çift dokun: %100\nİki parmak: yakınlaştır · resme çift dokun: tam ekran'}</Text>
        </View>
      )}

      {panel === 'room' && <RoomLinkPanel left={panelLeft} onAdd={addRoomLink} onClose={() => setPanel(null)} />}
      {panel === 'image' && (
        <ImagePanel left={panelLeft} mediaId={media.id} center={centerSurface} images={images} onAdd={addImages} onClose={() => setPanel(null)} />
      )}
      {viewer != null && images.length > 0 && (
        <ImageViewer images={images} index={Math.min(viewer, images.length - 1)} onIndex={setViewer} onClose={closeViewer} />
      )}
    </View>
  )
}

/** Değer en fazla ms'de bir güncellenir; son değer her zaman uygulanır */
function useThrottled(value, ms) {
  const [out, setOut] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const wait = Math.max(0, last.current + ms - Date.now())
    const t = setTimeout(() => { last.current = Date.now(); setOut(value) }, wait)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

function Fab({ icon, label, onPress, busy }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={8}
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator color={colors.text} size="small" /> : <Icon name={icon} size={20} />}
    </Pressable>
  )
}

function SideItem({ icon, label, hint, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sideItem, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.sideIcon}><Icon name={icon} size={20} color="#93c5fd" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sideLabel}>{label}</Text>
        <Text style={styles.sideHint}>{hint}</Text>
      </View>
    </Pressable>
  )
}

function ActionButton({ label, icon, onPress, primary, danger, active, busy }) {
  const ink = primary ? colors.accentInk : danger ? colors.danger : colors.text
  return (
    <Pressable
      onPress={onPress}
      disabled={!!busy}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, active && styles.actionActive, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator color={ink} size="small" /> : icon ? <Icon name={icon} size={15} color={ink} /> : null}
      <Text style={[styles.actionText, { color: ink }]}>{label}</Text>
    </Pressable>
  )
}

function Swatch({ color, active, onPress }) {
  const none = color === 'transparent'
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={[styles.swatch, { backgroundColor: color == null ? 'rgba(96,165,250,0.18)' : none ? 'transparent' : color }, active && styles.swatchOn]}
      accessibilityRole="button"
      accessibilityLabel={color == null ? 'Varsayılan' : none ? 'Saydam' : color}
    >
      {color == null && <Text style={styles.swatchMark}>A</Text>}
      {none && <View style={styles.swatchSlash} />}
    </Pressable>
  )
}

const glass = {
  backgroundColor: 'rgba(10,10,18,0.88)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.12)',
}

const styles = StyleSheet.create({
  host: { backgroundColor: '#06060b', alignItems: 'center', justifyContent: 'center', zIndex: 100, elevation: 100 },
  emptyWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.displayThin, fontSize: type.title, color: 'rgba(255,255,255,0.35)' },
  emptyHint: { fontFamily: fonts.body, fontSize: type.caption, color: 'rgba(255,255,255,0.3)', marginTop: space.xs },

  fabRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fab: { ...glass, width: FAB, height: FAB, borderRadius: FAB / 2, alignItems: 'center', justifyContent: 'center' },
  fabPressed: { backgroundColor: 'rgba(96,165,250,0.3)' },
  error: { ...glass, fontFamily: fonts.mono, fontSize: type.micro, color: colors.danger, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden' },

  selBar: { position: 'absolute', alignItems: 'center', gap: space.sm },
  selActions: { ...glass, maxWidth: '100%', borderRadius: radius.pill, borderColor: 'rgba(96,165,250,0.3)', overflow: 'hidden' },
  selScroll: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, paddingLeft: space.md },
  selName: { fontFamily: fonts.strong, fontSize: type.caption, color: '#93c5fd', maxWidth: 200, marginRight: space.xs },
  action: { paddingHorizontal: space.md, height: 34, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surfaceHi },
  actionPrimary: { backgroundColor: colors.accent },
  actionActive: { backgroundColor: 'rgba(96,165,250,0.25)' },
  actionText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text },
  palette: { ...glass, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, padding: space.sm, maxWidth: 520, borderRadius: radius.md },
  swatch: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  swatchOn: { borderWidth: 2, borderColor: colors.accent },
  swatchMark: { fontFamily: fonts.strong, fontSize: type.caption, color: '#93c5fd' },
  swatchSlash: { width: 36, height: 2, backgroundColor: colors.danger, transform: [{ rotate: '-45deg' }] },

  undo: { ...glass, position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill },
  undoText: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted },
  undoAction: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.accent },

  sidebar: { ...glass, position: 'absolute', width: SIDEBAR, borderRadius: radius.lg, paddingVertical: space.sm, overflow: 'hidden' },
  sideHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 44, paddingHorizontal: space.md, marginHorizontal: space.xs, borderRadius: radius.md },
  sideTitle: { flex: 1, fontFamily: fonts.display, fontSize: type.heading, color: colors.text },
  sideSection: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 2.4, color: colors.faint, marginHorizontal: space.lg, marginTop: space.md },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.sm, marginTop: space.xs, padding: space.sm, borderRadius: radius.sm },
  sideIcon: { width: 28, alignItems: 'center' },
  sideLabel: { fontFamily: fonts.strong, fontSize: type.body, color: '#93c5fd' },
  sideHint: { fontFamily: fonts.body, fontSize: type.micro, color: colors.muted, marginTop: 2 },
  sideNote: { fontFamily: fonts.body, fontSize: type.micro, color: colors.faint, marginHorizontal: space.lg, marginTop: space.xl },
  sideTip: { fontFamily: fonts.mono, fontSize: type.micro, color: colors.faint, marginHorizontal: space.lg, marginTop: 'auto', marginBottom: space.sm },
  pressed: { backgroundColor: 'rgba(96,165,250,0.12)' },

  pasteDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.accent, backgroundColor: 'rgba(0,242,255,0.15)' },
  pasteWrap: { position: 'absolute', width: 240, alignItems: 'center' },
  pasteBtn: { ...glass, height: 44, minWidth: 44, paddingHorizontal: space.md, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderColor: 'rgba(0,242,255,0.45)' },
  pasteEmpty: { borderColor: 'rgba(255,255,255,0.12)' },
  pasteLabel: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text, maxWidth: 170 },
  pasteMenu: { ...glass, position: 'absolute', width: 240, borderRadius: radius.md, padding: space.xs },
  pasteItem: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm },
  pasteItemLabel: { fontFamily: fonts.strong, fontSize: type.body, color: '#93c5fd' },
  pasteItemHint: { fontFamily: fonts.body, fontSize: type.micro, color: colors.muted, marginTop: 1 },

  toast: { position: 'absolute', alignItems: 'center' },
  toastText: { ...glass, fontFamily: fonts.strong, fontSize: type.caption, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, overflow: 'hidden', textAlign: 'center' },
})
