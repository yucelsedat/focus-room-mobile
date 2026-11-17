import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler'
import Animated, {
  Easing,
  scrollTo,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { scheduleOnRN } from 'react-native-worklets'

import { BarRule, SelectionBar, ToolRow } from './BottomBar'
import { HandDrawing, HandIcon } from './HandIcon'
import { PasteButton } from './PageTop'
import { SELECTION_PAD } from './StrokeLayer'
import { TornPaperMenu } from '../components/TornPaperMenu'
import {
  DRAW_COLORS,
  DRAW_SIZES,
  drawColorOf,
  drawWidthOf,
  moveStrokes,
  strokeHit,
  strokeInRect,
  strokesBounds,
} from '../lib/drawing'
import {
  clearStrokeClipboard,
  putStrokesOnClipboard,
  takeStrokesFromClipboard,
  useClipboardStrokes,
} from '../lib/strokeClipboard'
import { fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

// Sayfa en çok bu kadar büyür
const MAX_ZOOM = 8
// İki parmakla küçültülen sayfa bundan az büyümüş kalırsa tam yerine oturur
const SNAP_ZOOM = 1.05
// Bundan küçük çekilen alan (px) dokunuş sayılır, seçim olmaz
const MIN_AREA = 24
const ZOOM_TIMING = { duration: 320, easing: Easing.out(Easing.cubic) }
// Silginin ekrandaki yarıçapı (px); zoom ne olursa olsun ekranda aynı boyda
const ERASER_RADIUS = 12
// Seçim aracıyla dokunulan yerin bu kadar yakınındaki (ekranda, px) çizgiler seçilir
const TAP_RADIUS = 12
// Çoğaltılan çizgiler bu kadar sağa ve aşağıya kayar (içerik birimi)
const DUPLICATE_SHIFT = 24
// Seçimle yapılan işin yazısı bu kadar sonra kaybolur (ms)
const NOTICE_TIME = 1600

export function useCamera() {
  const k = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: k.get() }],
  }))
  const camera = useMemo(() => ({ k, x, y }), [k, x, y])
  return { camera, style }
}

// Kamera sayfanın dışını göstermesin: büyümüş sayfa ekranı her yandan örter
function clampCamera(cam, w, h) {
  'worklet'
  return {
    k: cam.k,
    x: Math.min(0, Math.max(w - cam.k * w, cam.x)),
    y: Math.min(0, Math.max(h - cam.k * h, cam.y)),
  }
}

export function moveCamera(camera, to, animated = true) {
  if (animated) {
    camera.k.set(withTiming(to.k, ZOOM_TIMING))
    camera.x.set(withTiming(to.x, ZOOM_TIMING))
    camera.y.set(withTiming(to.y, ZOOM_TIMING))
  } else {
    camera.k.set(to.k)
    camera.x.set(to.x)
    camera.y.set(to.y)
  }
}

// 2.5 → "2,5×"
function zoomLabel(k) {
  const rounded = Math.round(k * 10) / 10
  return `${String(rounded).replace('.', ',')}×`
}

// Çizim modu: sayfanın üstünü örten katman. Sayfadaki yazılar, düğmeler ve kaydırma kapanır;
// dokunuşlar seçili araca gider. Sayfa her araçta iki parmakla büyütülüp küçültülür ve kaydırılır.
// Sol üstteki X sayfayı büyümemiş hâline döndürür. Üstte fırça ve seçim durur: seçim açıkken
// çekilen alandaki (ya da dokunulan) çizgiler seçilir, kutularının içinden sürüklenerek taşınır,
// alt çubukta blok seçimindeki gibi kopyala,
// kes, çoğalt ve sil çıkar; kopyalanan çizgiler üstteki yapıştır düğmesiyle bu ya da başka bir
// sayfaya yapıştırılır. Seçim kapalıyken alt çubukta el (sayfayı her yöne kaydırır), kalem, silgi,
// kalemin rengi, geri al ve yinele durur.
export function DrawingOverlay({
  camera,
  origin,
  scrollRef,
  scrollY,
  viewport,
  content,
  live,
  strokes,
  tool,
  onToolChange,
  pen,
  onPenChange,
  hasStrokes,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onStroke,
  onAddStrokes,
  onRemoveStrokes,
  onMoveStrokes,
  onSelectionChange,
  onErase,
  onEraseEnd,
  onClose,
}) {
  const insets = useSafeAreaInsets()
  const frame = useSharedValue({ w: 0, h: 0 })
  // Sayfanın son iki parmak hareketinden sonraki büyüklüğü: X ve yazısı buna göre çıkar
  const [zoom, setZoom] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)
  const zoomed = zoom > 1
  const selecting = tool === 'select'
  // Seçili çizgiler (kendileri): geri alınan ya da silinen çizgi seçimden kendiliğinden düşer
  const [selected, setSelected] = useState(() => new Set())
  const [notice, setNotice] = useState(null)
  const clipboardStrokes = useClipboardStrokes()
  const picked = useMemo(() => strokes.filter((s) => selected.has(s)), [strokes, selected])
  // Seçim kapanınca dönülecek araç
  const toolBeforeSelect = useRef(tool === 'select' ? 'pen' : tool)
  // Hareketlerden çağrılan işler en son çizgileri ve seçimi görsün
  const strokesRef = useRef(strokes)
  const pickedRef = useRef(picked)
  useEffect(() => {
    strokesRef.current = strokes
    pickedRef.current = picked
  }, [strokes, picked])

  const toolValue = useSharedValue(tool)
  const penKey = useSharedValue(pen.color)
  const penColor = useSharedValue(drawColorOf(pen.color))
  const penWidth = useSharedValue(drawWidthOf(pen.size))

  // Seçim kutusu çizgilerin katmanında, sayfanın içinde çizilir (bkz. StrokeLayer): sayfayla aynı
  // anda büyür ve kayar
  const { selStart, selEnd, selShown, selBoxed: boxed, moving } = live
  // Silginin izi; elin sayfayı kaydırdığı yer
  const finger = useSharedValue({ x: 0, y: 0 })
  const erasing = useSharedValue(false)
  const lastErase = useSharedValue({ x: 0, y: 0 })
  const handScroll = useSharedValue(0)
  // İki parmak sayfadayken tek parmağın hareketi yok sayılır: başlamış çizgi ya da seçim atılır
  const pinching = useSharedValue(false)
  const panDropped = useSharedValue(false)
  const focal = useSharedValue({ x: 0, y: 0 })

  useEffect(() => {
    toolValue.set(tool)
  }, [tool, toolValue])

  // Seçili çizgilerin çevresinde kesik çizgili kutu durur
  function showBox(list) {
    const b = strokesBounds(list)
    if (!b) {
      selShown.set(false)
      return
    }
    selStart.set({ x: b.x0, y: b.y0 })
    selEnd.set({ x: b.x1, y: b.y1 })
    boxed.set(true)
    selShown.set(true)
  }

  const showPicked = useEffectEvent((list) => showBox(list))
  useEffect(() => {
    showPicked(picked)
  }, [picked])

  useEffect(() => {
    onSelectionChange(selected)
  }, [selected, onSelectionChange])

  // Çizim modu kapanınca seçim kutusu da kalkar
  useEffect(
    () => () => {
      live.selShown.set(false)
      live.moving.set(false)
      live.drag.set({ x: 0, y: 0 })
    },
    [live],
  )

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), NOTICE_TIME)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    penKey.set(pen.color)
    penColor.set(drawColorOf(pen.color))
    penWidth.set(drawWidthOf(pen.size))
  }, [pen, penKey, penColor, penWidth])

  // Ekrandaki nokta → kaydırılan içerikteki yer
  function toPage(vx, vy) {
    'worklet'
    const k = camera.k.get()
    const o = origin.get()
    return {
      x: (vx - camera.x.get()) / k - o.x,
      y: (vy - camera.y.get()) / k - o.y + scrollY.get(),
    }
  }

  // Kaydırılan içerikteki yer → ekrandaki nokta
  function toScreen(p) {
    'worklet'
    const k = camera.k.get()
    const o = origin.get()
    return {
      x: k * (p.x + o.x) + camera.x.get(),
      y: k * (p.y + o.y - scrollY.get()) + camera.y.get(),
    }
  }

  // Kamera (x, y)'ye kayar. Büyümüş sayfa kenarına kadar kayar; aşağı yukarı kenara dayanınca
  // kalanı sayfanın kaydırma alanını kaydırır (büyümemiş sayfada hep öyle)
  function panCamera(nx, ny) {
    'worklet'
    const { w, h } = frame.get()
    const k = camera.k.get()
    const next = clampCamera({ k, x: nx, y: ny }, w, h)
    camera.x.set(next.x)
    camera.y.set(next.y)
    const rest = ny - next.y
    if (rest !== 0) {
      const max = Math.max(0, content.get() - viewport.get())
      const scroll = Math.min(max, Math.max(0, handScroll.get() - rest / k))
      if (scroll !== handScroll.get()) {
        handScroll.set(scroll)
        scrollTo(scrollRef, 0, scroll, false)
      }
    }
  }

  function resetZoom() {
    setZoom(1)
    moveCamera(camera, { k: 1, x: 0, y: 0 })
  }

  // İki parmak kalktı: neredeyse büyümemiş sayfa yerine oturur
  function pinchEnded(k) {
    if (k < SNAP_ZOOM) resetZoom()
    else setZoom(k)
  }

  // Seçim açılır ya da kapanır; kapanınca seçimden önceki araca dönülür
  function changeSelecting(next) {
    setSelected(new Set())
    setNotice(null)
    if (next) {
      if (tool !== 'select') toolBeforeSelect.current = tool
      onToolChange('select')
    } else {
      onToolChange(toolBeforeSelect.current)
    }
  }

  // Çekilen alandaki çizgiler seçilir (ekranda iki köşe, kaydırılan içerikte)
  function selectArea(rect) {
    const list = strokesRef.current.filter((s) => strokeInRect(s, rect))
    setSelected(new Set(list))
    // Seçim değişmese de alanın kutusu seçili çizgilere oturur
    if (list.length === 0) selShown.set(false)
    else showBox(list)
  }

  // Dokunulan çizgiler seçime girer ya da çıkar; boş yere dokununca seçim kalkar
  function selectAt(x, y, r) {
    const hit = strokesRef.current.filter((s) => strokeHit(s, x, y, r))
    if (hit.length === 0) {
      setSelected(new Set())
      return
    }
    setSelected((prev) => {
      const next = new Set(prev)
      const allIn = hit.every((s) => next.has(s))
      for (const s of hit) {
        if (allIn) next.delete(s)
        else next.add(s)
      }
      return next
    })
  }

  // Kopyalanınca ya da kesilince seçim kapanır (bkz. blok seçimi)
  function copySelection() {
    if (picked.length === 0) return
    putStrokesOnClipboard(picked)
    changeSelecting(false)
  }

  function cutSelection() {
    if (picked.length === 0) return
    putStrokesOnClipboard(picked)
    onRemoveStrokes(new Set(picked))
    changeSelecting(false)
  }

  // Kopyalar biraz sağa ve aşağıya gelir; seçim kopyalara geçer
  function duplicateSelection() {
    if (picked.length === 0) return
    const copies = moveStrokes(picked, DUPLICATE_SHIFT, DUPLICATE_SHIFT)
    onAddStrokes(copies)
    setSelected(new Set(copies))
    setNotice('çoğaltıldı')
  }

  // Geri al ile geri getirilebilir
  function deleteSelection() {
    if (picked.length === 0) return
    onRemoveStrokes(new Set(picked))
    setSelected(new Set())
    setNotice('silindi')
  }

  // Panodaki çizgiler ekranın ortasına gelir, seçim açılır ve yapıştırılanlara geçer
  function pasteStrokes() {
    const list = takeStrokesFromClipboard()
    const b = strokesBounds(list)
    if (!b) return
    const { w, h } = frame.get()
    const center = toPage(w / 2, h / 2)
    const pasted = moveStrokes(list, center.x - (b.x0 + b.x1) / 2, center.y - (b.y0 + b.y1) / 2)
    onAddStrokes(pasted)
    if (tool !== 'select') toolBeforeSelect.current = tool
    onToolChange('select')
    setSelected(new Set(pasted))
    setNotice('yapıştırıldı')
  }

  function confirmClearClipboard() {
    Alert.alert('Panoyu boşalt', 'Kopyalanan çizim panodan silinsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Boşalt', style: 'destructive', onPress: clearStrokeClipboard },
    ])
  }

  // Sürüklenen çizgiler bırakıldıkları yere yazılır; seçim kaymış çizgilere geçer
  function commitMove(dx, dy) {
    const list = pickedRef.current
    if (list.length === 0) return
    setSelected(new Set(onMoveStrokes(list, dx, dy)))
  }

  // Alan çekilirken iki parmak değdi: kutu yine seçili çizgilere oturur
  function restoreBox() {
    showBox(pickedRef.current)
  }

  // Geri tuşu önce seçimi, sonra büyütmeyi kapatır, en son çizim modunu kapatır
  const onBack = useEffectEvent(() => {
    if (selecting) changeSelecting(false)
    else if (zoomed) resetZoom()
    else onClose()
  })

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack()
      return true
    })
    return () => sub.remove()
  }, [])

  // Kalem kâğıttan kalktı: çizgi kalıcı çizgilere geçer (noktalar onda bire yuvarlanır)
  function finishStroke(points, color, width) {
    if (points.length < 2) return
    onStroke({ c: color, w: width, p: points.map((v) => Math.round(v * 10) / 10) })
  }

  function erase(vx, vy, force) {
    'worklet'
    const last = lastErase.get()
    const dx = vx - last.x
    const dy = vy - last.y
    if (!force && dx * dx + dy * dy < 9) return
    lastErase.set({ x: vx, y: vy })
    const p = toPage(vx, vy)
    scheduleOnRN(onErase, p.x, p.y, ERASER_RADIUS / camera.k.get())
  }

  // Çizilmekte olan çizgi kalıcı çizgilere geçmeden silinir
  function dropLiveStroke() {
    'worklet'
    live.done.set(live.id.get())
    live.points.set([])
  }

  const pan = usePanGesture({
    minDistance: 1,
    maxPointers: 1,
    onActivate: (e) => {
      panDropped.set(pinching.get())
      if (pinching.get()) return
      const sx = e.x - e.translationX
      const sy = e.y - e.translationY
      const t = toolValue.get()
      if (t === 'pen') {
        const a = toPage(sx, sy)
        const b = toPage(e.x, e.y)
        live.id.set(live.id.get() + 1)
        live.color.set(penColor.get())
        live.width.set(penWidth.get())
        live.points.set([a.x, a.y, b.x, b.y])
      } else if (t === 'eraser') {
        erasing.set(true)
        finger.set({ x: e.x, y: e.y })
        erase(sx, sy, true)
        erase(e.x, e.y, true)
      } else if (t === 'select') {
        // Seçili çizgilerin kutusunun içinden başlayan sürükleme çizgileri taşır, dışından
        // başlayan yeni bir alan seçer
        const a = toPage(sx, sy)
        const slack = (SELECTION_PAD + TAP_RADIUS) / camera.k.get()
        const s0 = selStart.get()
        const s1 = selEnd.get()
        if (
          selShown.get() &&
          a.x >= Math.min(s0.x, s1.x) - slack &&
          a.x <= Math.max(s0.x, s1.x) + slack &&
          a.y >= Math.min(s0.y, s1.y) - slack &&
          a.y <= Math.max(s0.y, s1.y) + slack
        ) {
          const b = toPage(e.x, e.y)
          live.drag.set({ x: b.x - a.x, y: b.y - a.y })
          moving.set(true)
        } else {
          selStart.set(a)
          selEnd.set(toPage(e.x, e.y))
          boxed.set(false)
          selShown.set(true)
        }
      } else {
        handScroll.set(scrollY.get())
      }
    },
    onUpdate: (e) => {
      if (panDropped.get()) return
      const t = toolValue.get()
      if (t === 'pen') {
        const b = toPage(e.x, e.y)
        // Büyümüş sayfada noktalar sıklaşır, ince ayrıntı yumuşak çıkar
        const step = 0.8 / camera.k.get()
        live.points.modify((p) => {
          'worklet'
          const n = p.length
          const dx = b.x - p[n - 2]
          const dy = b.y - p[n - 1]
          if (dx * dx + dy * dy >= step * step) p.push(b.x, b.y)
          return p
        })
      } else if (t === 'eraser') {
        finger.set({ x: e.x, y: e.y })
        erase(e.x, e.y, false)
      } else if (t === 'select') {
        if (moving.get()) {
          const k = camera.k.get()
          const d = live.drag.get()
          live.drag.set({ x: d.x + e.changeX / k, y: d.y + e.changeY / k })
        } else {
          selEnd.set(toPage(e.x, e.y))
        }
      } else {
        panCamera(camera.x.get() + e.changeX, camera.y.get() + e.changeY)
      }
    },
    onDeactivate: (e) => {
      if (panDropped.get()) return
      const t = toolValue.get()
      if (t === 'pen') {
        // İkinci parmak değdi (Android'de tek parmaklı hareket o an iptal olur): çizgi atılır
        if (e.canceled) {
          dropLiveStroke()
          return
        }
        live.done.set(live.id.get())
        scheduleOnRN(finishStroke, live.points.get().slice(), penKey.get(), live.width.get())
      } else if (t === 'select' && moving.get()) {
        moving.set(false)
        const d = live.drag.get()
        // İptal olan (ikinci parmak değen) ya da hiç kıpırdamayan sürükleme çizgileri yerinde
        // bırakır
        if (e.canceled || (d.x === 0 && d.y === 0)) {
          live.drag.set({ x: 0, y: 0 })
          return
        }
        // Kutu hemen yeni yerine geçer; çizgiler React yeni yerlerini çizene dek kaymış durur
        const s0 = selStart.get()
        const s1 = selEnd.get()
        selStart.set({ x: s0.x + d.x, y: s0.y + d.y })
        selEnd.set({ x: s1.x + d.x, y: s1.y + d.y })
        scheduleOnRN(commitMove, d.x, d.y)
      } else if (t === 'select') {
        // Neredeyse hiç çekilmemiş alan seçim olmaz, kutu yine seçili çizgilere oturur
        const a = selStart.get()
        const b = selEnd.get()
        const s = toScreen(a)
        const f = toScreen(b)
        if (e.canceled || (Math.abs(f.x - s.x) < MIN_AREA && Math.abs(f.y - s.y) < MIN_AREA)) {
          scheduleOnRN(restoreBox)
        } else {
          scheduleOnRN(selectArea, {
            x0: Math.min(a.x, b.x),
            y0: Math.min(a.y, b.y),
            x1: Math.max(a.x, b.x),
            y1: Math.max(a.y, b.y),
          })
        }
      }
    },
    onFinalize: () => {
      panDropped.set(false)
      if (erasing.get()) {
        erasing.set(false)
        scheduleOnRN(onEraseEnd)
      }
    },
  })

  const tap = useTapGesture({
    onDeactivate: (e) => {
      if (e.canceled || pinching.get()) return
      const t = toolValue.get()
      if (t === 'pen') {
        const p = toPage(e.x, e.y)
        scheduleOnRN(finishStroke, [p.x, p.y], penKey.get(), penWidth.get())
      } else if (t === 'eraser') {
        erase(e.x, e.y, true)
        scheduleOnRN(onEraseEnd)
      } else if (t === 'select') {
        const p = toPage(e.x, e.y)
        scheduleOnRN(selectAt, p.x, p.y, TAP_RADIUS / camera.k.get())
      }
    },
  })

  // İki parmak: parmakların ortasındaki nokta parmakların altında kalarak sayfa büyür, küçülür ve
  // kayar. Tek parmakla başlamış çizgi, silgi ya da alan seçimi o an bırakılır; araç değişmez.
  const pinch = usePinchGesture({
    onActivate: (e) => {
      pinching.set(true)
      focal.set({ x: e.focalX, y: e.focalY })
      handScroll.set(scrollY.get())
      const t = toolValue.get()
      if (t === 'pen' && !panDropped.get()) dropLiveStroke()
      panDropped.set(true)
      if (erasing.get()) {
        erasing.set(false)
        scheduleOnRN(onEraseEnd)
      }
      if (moving.get()) {
        // Sürüklenen çizgiler yerlerine döner
        moving.set(false)
        live.drag.set({ x: 0, y: 0 })
      } else if (t === 'select') {
        scheduleOnRN(restoreBox)
      }
    },
    onUpdate: (e) => {
      const f = focal.get()
      focal.set({ x: e.focalX, y: e.focalY })
      // Parmaklardan biri kalkınca orta nokta sıçrar: o an sayfa yerinde durur
      if (e.numberOfPointers < 2) return
      const k = camera.k.get()
      const nk = Math.min(MAX_ZOOM, Math.max(1, k * e.scaleChange))
      const px = (f.x - camera.x.get()) / k
      const py = (f.y - camera.y.get()) / k
      camera.k.set(nk)
      panCamera(e.focalX - nk * px, e.focalY - nk * py)
    },
    onFinalize: () => {
      if (!pinching.get()) return
      pinching.set(false)
      scheduleOnRN(pinchEnded, camera.k.get())
    },
  })

  // Tek parmak ya kaydırır ya dokunur; iki parmak bunlarla aynı anda dinlenir
  const oneFinger = useCompetingGestures(pan, tap)
  const gestures = useSimultaneousGestures(pinch, oneFinger)

  const eraserStyle = useAnimatedStyle(() => {
    const f = finger.get()
    return {
      opacity: erasing.get() ? 1 : 0,
      transform: [{ translateX: f.x - ERASER_RADIUS }, { translateY: f.y - ERASER_RADIUS }],
    }
  })

  function confirmClear() {
    setMenuOpen(false)
    Alert.alert('Çizimi sil', 'Sayfadaki bütün çizim silinsin mi? Geri al ile geri getirilebilir.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: onClear },
    ])
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={gestures}>
        <Animated.View
          collapsable={false}
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout
            frame.set({ w: width, h: height })
          }}
        >
          <Animated.View pointerEvents="none" style={[styles.eraser, eraserStyle]} />
        </Animated.View>
      </GestureDetector>

      {/* Sabit üst çubuk: sayfa büyüse de yerinde durur */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 4 }]}>
        {zoomed ? (
          <Pressable
            onPress={resetZoom}
            accessibilityRole="button"
            accessibilityLabel="Büyütmeyi kapat"
            hitSlop={8}
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          >
            <HandDrawing shape="close" size={24} />
            <Text style={styles.chipText}>{zoomLabel(zoom) + HAND_TAIL}</Text>
          </Pressable>
        ) : (
          <View />
        )}
        {/* Çizim modunda üstte yalnızca yapıştır (panoda çizim varsa), seçim ve fırça durur */}
        <View style={[styles.actions, zoomed && styles.floating]}>
          {clipboardStrokes > 0 && (
            <PasteButton
              label="Kopyalanan çizimi yapıştır"
              onPress={pasteStrokes}
              onLongPress={confirmClearClipboard}
            />
          )}
          <HandIcon
            shape="select"
            label={selecting ? 'Çizim seçimini kapat' : 'Çizim seç'}
            size={28}
            selected={selecting}
            color={selecting ? notebook.selectionInk : undefined}
            onPress={() => changeSelecting(!selecting)}
          />
          <HandIcon
            shape="brush"
            label="Çizim modunu kapat"
            size={28}
            selected
            color={notebook.selectionInk}
            fill={notebook.drawingFill}
            onPress={onClose}
          />
        </View>
      </View>

      {selecting ? (
        <View style={styles.bar}>
          <SelectionBar
            bottomInset={insets.bottom}
            count={picked.length}
            notice={notice}
            noun="çizgi"
            idle="alan seç"
            onCopy={copySelection}
            onCut={cutSelection}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
          />
        </View>
      ) : (
        <DrawingBar
          bottomInset={insets.bottom}
          tool={tool}
          onToolChange={onToolChange}
          pen={pen}
          onPenPress={() => setMenuOpen(true)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      )}

      <DrawPenMenu
        visible={menuOpen}
        pen={pen}
        onChange={onPenChange}
        onClear={hasStrokes ? confirmClear : undefined}
        onClose={() => setMenuOpen(false)}
      />
    </View>
  )
}

const TOOLS = [
  { tool: 'hand', shape: 'hand', label: 'Sayfayı kaydır' },
  { tool: 'pen', shape: 'pencil', label: 'Kalemle çiz' },
  { tool: 'eraser', shape: 'eraser', label: 'Silgi' },
]

// Çizim modunun alt çubuğu (seçim kapalıyken): araçlar, kalemin rengi ve kalınlığı, geri al ve
// yinele
function DrawingBar({ bottomInset, tool, onToolChange, pen, onPenPress, canUndo, canRedo, onUndo, onRedo }) {
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      <BarRule />
      <ToolRow>
        {TOOLS.map((t) => (
          <View key={t.tool} style={[styles.tool, tool === t.tool && styles.toolOn]}>
            <HandIcon
              shape={t.shape}
              label={t.label}
              size={30}
              selected={tool === t.tool}
              color={tool === t.tool ? notebook.selectionInk : undefined}
              onPress={() => onToolChange(t.tool)}
            />
          </View>
        ))}
        <View style={styles.divider} />
        <PenSwatch pen={pen} onPress={onPenPress} />
        <HandIcon shape="undo" label="Geri al" size={30} disabled={!canUndo} onPress={onUndo} />
        <HandIcon shape="redo" label="Yinele" size={30} disabled={!canRedo} onPress={onRedo} />
      </ToolRow>
    </View>
  )
}

// Kalemin rengiyle boyanmış kare; ortasında kalınlığı kadar bir nokta
function PenSwatch({ pen, onPress }) {
  const width = drawWidthOf(pen.size)
  return (
    <View style={styles.swatch}>
      <HandIcon
        shape="swatch"
        label="Kalemin rengi ve kalınlığı"
        size={30}
        fill={drawColorOf(pen.color)}
        onPress={onPress}
      />
      <View
        pointerEvents="none"
        style={[styles.sizeDot, { width: width + 3, height: width + 3, borderRadius: (width + 3) / 2 }]}
      />
    </View>
  )
}

// Çizim kalemi: yırtık kâğıtta renkler ve kalınlıklar
function DrawPenMenu({ visible, pen, onChange, onClear, onClose }) {
  return (
    <TornPaperMenu
      visible={visible}
      title="Çizim kalemi"
      onClose={onClose}
      options={onClear ? [{ label: 'Sayfadaki çizimi sil', danger: true, onPress: onClear }] : []}
    >
      <Text style={styles.section}>{'Renk' + HAND_TAIL}</Text>
      <View style={styles.samples}>
        {DRAW_COLORS.map((c) => (
          <Sample
            key={c.key}
            label={c.name}
            selected={pen.color === c.key}
            onPress={() => onChange({ ...pen, color: c.key })}
          >
            <View style={[styles.colorDot, { backgroundColor: c.color }]} />
          </Sample>
        ))}
      </View>
      <Text style={styles.section}>{'Kalınlık' + HAND_TAIL}</Text>
      <View style={styles.samples}>
        {DRAW_SIZES.map((s) => (
          <Sample
            key={s.key}
            label={`${s.name} kalem`}
            selected={pen.size === s.key}
            onPress={() => onChange({ ...pen, size: s.key })}
          >
            <Svg width={34} height={20}>
              <Path
                d="M4 12 C12 7 20 15 30 8"
                stroke={drawColorOf(pen.color)}
                strokeWidth={s.width}
                strokeLinecap="round"
                fill="none"
              />
            </Svg>
          </Sample>
        ))}
      </View>
    </TornPaperMenu>
  )
}

const SAMPLE = 50

function Sample({ label, selected, onPress, children }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.sample, pressed && styles.samplePressed]}
    >
      {children}
      {selected && (
        <View style={styles.ring} pointerEvents="none">
          <HandDrawing shape="ring" size={SAMPLE} />
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  eraser: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: ERASER_RADIUS * 2,
    height: ERASER_RADIUS * 2,
    borderRadius: ERASER_RADIUS,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 56, 61, 0.6)',
    backgroundColor: 'rgba(251, 247, 236, 0.5)',
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  // Fırça, sayfanın üst çubuğundaki yerinde durur: en sağdaki üç noktanın solunda; seçim ve
  // yapıştır onun solundadır
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: 32 + 12,
    borderRadius: 18,
  },
  // Sayfa büyüyünce düğmeler kâğıttan bir yuvarlağın üstünde durur, yazıların üstünde seçilsin
  floating: {
    backgroundColor: notebook.paper,
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 36,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 18,
    backgroundColor: notebook.paper,
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  chipPressed: {
    backgroundColor: '#F3EEDF',
  },
  chipText: {
    marginRight: -handTailWidth(20),
    fontFamily: fonts.handBold,
    fontSize: 20,
    color: notebook.graphite,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: notebook.paper,
  },
  tool: {
    borderRadius: 19,
  },
  toolOn: {
    backgroundColor: notebook.selectionTint,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(56, 56, 61, 0.2)',
  },
  swatch: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeDot: {
    position: 'absolute',
    backgroundColor: notebook.paper,
  },
  // Kâğıdın kırmızı kenar çizgisinin sağından başlar (bkz. TornPaperMenu)
  section: {
    alignSelf: 'flex-start',
    marginLeft: 42,
    marginRight: -handTailWidth(20),
    fontFamily: fonts.hand,
    fontSize: 20,
    color: 'rgba(56, 56, 61, 0.6)',
  },
  samples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    paddingLeft: 42,
    paddingRight: 12,
    paddingBottom: 6,
  },
  sample: {
    width: SAMPLE,
    height: SAMPLE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SAMPLE / 2,
  },
  samplePressed: {
    backgroundColor: 'rgba(56, 56, 61, 0.08)',
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  ring: {
    position: 'absolute',
  },
})
