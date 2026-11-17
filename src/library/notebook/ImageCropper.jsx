import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets'

import { fonts, HAND_TAIL, notebook } from '../theme'

// Çerçevenin ekrandaki en küçük kenarı (px)
const MIN_SIDE = 56
// Kenara ya da köşeye bu kadar yakın dokunuş o kenarı tutar (içeriye ve dışarıya doğru)
const GRAB = 26
// Resim kırpma alanına sığdırılırken kenarlarda bırakılan boşluk; çerçevenin kenarları ve
// tutamaçları hep görünsün
const SIDE_GAP = 28
const TOP_GAP = 28
// Alttaki düğmelerin kapladığı yer
const ACTIONS_SPACE = 84
// Resim, ekrana sığdırılmış (tam ekrandaki) hâlinin en fazla bu katına büyütülür
const MAX_ZOOM = 6
// Kırpma alanına sığdırılmış hâlinin en fazla %5 altına küçülür
const MIN_ZOOM = 0.95
const FIT_MS = 260
const CORNER = 24
const THICK = 4
const EDGE_BAR = 28

// Tutulan yer: kenarlar birlikte tutulabilir (köşe iki kenardır); PAN resmin kendisi
const LEFT = 1
const RIGHT = 2
const TOP = 4
const BOTTOM = 8
const PAN = 16

function clamp(value, min, max) {
  'worklet'
  return Math.min(max, Math.max(min, value))
}

// Kırpma ekranı. Çerçeve ekranda durur, resim altında hareket eder:
// - çerçevenin köşelerinden ve kenarlarından çekilerek boyu ve oranı değişir; bırakılınca çerçeve
//   alanın ortasına geçip büyür, resim de onunla birlikte yakınlaşır
// - tek parmakla (çerçevenin içinden ya da dışından) resim kaydırılır
// - iki parmakla resim büyütülüp küçültülür
// Resim çerçeveyi her zaman kaplar; çerçeve ekranın kenarlarından içeride durur.
export function ImageCropper({ fit, insets, scale, tx, ty, busy, onCancel, onApply }) {
  const [box, setBox] = useState(null)

  // Ekranın boyu, resmin tam ekrandaki boyu ve çerçevenin dolaşabileceği alan
  const layout = useSharedValue({ bw: 0, bh: 0, fw: fit.w, fh: fit.h, l: 0, t: 0, w: 0, h: 0 })
  // Çerçeve, ekranda
  const fl = useSharedValue(0)
  const ft = useSharedValue(0)
  const fw = useSharedValue(0)
  const fh = useSharedValue(0)
  const mode = useSharedValue(0)
  const start = useSharedValue({ l: 0, t: 0, r: 0, b: 0, tx: 0, ty: 0 })
  // İki parmak değince tek parmakla yapılan iş bırakılır
  const pinching = useSharedValue(false)
  const pinchStart = useSharedValue({ scale: 1, tx: 0, ty: 0, fx: 0, fy: 0, e0: 1 })

  // Resmin ekrandaki yeri
  function imageRect() {
    'worklet'
    const a = layout.get()
    const s = scale.get()
    const w = a.fw * s
    const h = a.fh * s
    return { l: a.bw / 2 + tx.get() - w / 2, t: a.bh / 2 + ty.get() - h / 2, w, h }
  }

  // Resmin bütün hâliyle kırpma alanına sığdığı büyütme
  function baseScale() {
    'worklet'
    const a = layout.get()
    return Math.min(a.w / a.fw, a.h / a.fh)
  }

  // Resim kırpma alanına sığdırılır, çerçeve bütün resmi kaplar
  function fitWhole(animated) {
    'worklet'
    const a = layout.get()
    const s = baseScale()
    const w = a.fw * s
    const h = a.fh * s
    const cx = a.l + a.w / 2
    const cy = a.t + a.h / 2
    const to = (v) => (animated ? withTiming(v, { duration: FIT_MS }) : v)
    scale.set(to(s))
    tx.set(to(cx - a.bw / 2))
    ty.set(to(cy - a.bh / 2))
    fl.set(to(cx - w / 2))
    ft.set(to(cy - h / 2))
    fw.set(to(w))
    fh.set(to(h))
  }

  // Açılınca ve telefon döndürülünce resim yeniden alana sığdırılır. Paylaşılan değerler JS
  // tarafında yazılınca UI tarafına gecikmeli geçer, hemen okunursa eski değer gelir; bu yüzden
  // yerleşim de sığdırma da UI tarafında, art arda yapılır.
  useEffect(() => {
    if (!box) return
    const l = insets.left + SIDE_GAP
    const t = insets.top + TOP_GAP
    const next = {
      bw: box.w,
      bh: box.h,
      fw: fit.w,
      fh: fit.h,
      l,
      t,
      w: box.w - l - insets.right - SIDE_GAP,
      h: box.h - t - insets.bottom - ACTIONS_SPACE,
    }
    scheduleOnUI(() => {
      'worklet'
      layout.set(next)
      fitWhole(true)
    })
    // fitWhole yalnızca paylaşılan değerleri değiştirir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, fit.w, fit.h, insets.left, insets.top, insets.right, insets.bottom])

  // Kayma, resim çerçeveyi kaplamaya devam edecek kadar olabilir
  function clampTx(value, s) {
    'worklet'
    const a = layout.get()
    const half = (a.fw * s) / 2
    const min = fl.get() + fw.get() - half - a.bw / 2
    const max = fl.get() + half - a.bw / 2
    return clamp(value, Math.min(min, max), Math.max(min, max))
  }

  function clampTy(value, s) {
    'worklet'
    const a = layout.get()
    const half = (a.fh * s) / 2
    const min = ft.get() + fh.get() - half - a.bh / 2
    const max = ft.get() + half - a.bh / 2
    return clamp(value, Math.min(min, max), Math.max(min, max))
  }

  // Resmin küçülebileceği en alt sınır: çerçeveyi kaplamalı ve alana sığdığı hâlinin %95'inden
  // küçük olmamalı
  function minScale() {
    'worklet'
    const a = layout.get()
    return Math.max(baseScale() * MIN_ZOOM, fw.get() / a.fw, fh.get() / a.fh)
  }

  // Çerçeve bırakılınca alanın ortasına geçip alanı dolduracak kadar büyür; resim aynı oranda
  // büyür, çerçevenin içinde kalan yer değişmez
  function fitFrame() {
    'worklet'
    const a = layout.get()
    const img = imageRect()
    const s = scale.get()
    const w = fw.get()
    const h = fh.get()
    const k = Math.min(a.w / w, a.h / h, MAX_ZOOM / s)
    const nw = w * k
    const nh = h * k
    const nl = a.l + (a.w - nw) / 2
    const nt = a.t + (a.h - nh) / 2
    const ns = s * k
    // Resmin yeni sol üst köşesi: çerçeveye göre yeri k katı büyür
    const il = nl - (fl.get() - img.l) * k
    const it = nt - (ft.get() - img.t) * k
    const opts = { duration: FIT_MS, easing: Easing.out(Easing.cubic) }
    scale.set(withTiming(ns, opts))
    tx.set(withTiming(il + (a.fw * ns) / 2 - a.bw / 2, opts))
    ty.set(withTiming(it + (a.fh * ns) / 2 - a.bh / 2, opts))
    fl.set(withTiming(nl, opts))
    ft.set(withTiming(nt, opts))
    fw.set(withTiming(nw, opts))
    fh.set(withTiming(nh, opts))
  }

  const pan = usePanGesture({
    enabled: !busy,
    maxPointers: 1,
    onBegin: (e) => {
      const l = fl.get()
      const t = ft.get()
      const r = l + fw.get()
      const b = t + fh.get()
      const nearY = e.y > t - GRAB && e.y < b + GRAB
      const nearX = e.x > l - GRAB && e.x < r + GRAB
      const dl = Math.abs(e.x - l)
      const dr = Math.abs(e.x - r)
      const dt = Math.abs(e.y - t)
      const db = Math.abs(e.y - b)
      let m = 0
      if (nearY && Math.min(dl, dr) < GRAB) m |= dl <= dr ? LEFT : RIGHT
      if (nearX && Math.min(dt, db) < GRAB) m |= dt <= db ? TOP : BOTTOM
      mode.set(m === 0 ? PAN : m)
      start.set({ l, t, r, b, tx: tx.get(), ty: ty.get() })
    },
    onUpdate: (e) => {
      const m = mode.get()
      if (m === 0 || pinching.get()) return
      const st = start.get()
      if (m === PAN) {
        const s = scale.get()
        tx.set(clampTx(st.tx + e.translationX, s))
        ty.set(clampTy(st.ty + e.translationY, s))
        return
      }
      // Kenar, resmin ve alanın dışına çıkmaz; çerçeve en küçük boyunun altına inmez
      const a = layout.get()
      const img = imageRect()
      const minL = Math.max(a.l, img.l)
      const maxR = Math.min(a.l + a.w, img.l + img.w)
      const minT = Math.max(a.t, img.t)
      const maxB = Math.min(a.t + a.h, img.t + img.h)
      let l = st.l
      let r = st.r
      let t = st.t
      let b = st.b
      if (m & LEFT) l = clamp(st.l + e.translationX, minL, r - MIN_SIDE)
      if (m & RIGHT) r = clamp(st.r + e.translationX, l + MIN_SIDE, maxR)
      if (m & TOP) t = clamp(st.t + e.translationY, minT, b - MIN_SIDE)
      if (m & BOTTOM) b = clamp(st.b + e.translationY, t + MIN_SIDE, maxB)
      fl.set(l)
      ft.set(t)
      fw.set(Math.max(1, r - l))
      fh.set(Math.max(1, b - t))
    },
    onFinalize: () => {
      const m = mode.get()
      mode.set(0)
      if (m !== 0 && m !== PAN && !pinching.get()) fitFrame()
    },
  })

  // İki parmak: parmakların arasındaki nokta resmin üstünde yerinde kalır; parmaklar birlikte
  // kayınca resim de kayar. Resim çerçeveyi kaplamaya devam eder.
  const pinch = usePinchGesture({
    enabled: !busy,
    onActivate: (e) => {
      const a = layout.get()
      pinching.set(true)
      mode.set(0)
      pinchStart.set({
        scale: scale.get(),
        tx: tx.get(),
        ty: ty.get(),
        fx: e.focalX - a.bw / 2,
        fy: e.focalY - a.bh / 2,
        e0: e.scale || 1,
      })
    },
    onUpdate: (e) => {
      if (!pinching.get()) return
      const a = layout.get()
      const p = pinchStart.get()
      const next = clamp((p.scale * e.scale) / p.e0, minScale(), MAX_ZOOM)
      const k = next / p.scale
      const fx = e.focalX - a.bw / 2
      const fy = e.focalY - a.bh / 2
      scale.set(next)
      tx.set(clampTx(fx - (p.fx - p.tx) * k, next))
      ty.set(clampTy(fy - (p.fy - p.ty) * k, next))
    },
    onFinalize: () => {
      pinching.set(false)
    },
  })

  const gestures = useSimultaneousGestures(pinch, pan)

  const topDim = useAnimatedStyle(() => ({ height: Math.max(0, ft.get()) }))
  const bottomDim = useAnimatedStyle(() => ({ top: ft.get() + fh.get() }))
  const leftDim = useAnimatedStyle(() => ({
    top: ft.get(),
    height: fh.get(),
    width: Math.max(0, fl.get()),
  }))
  const rightDim = useAnimatedStyle(() => ({
    top: ft.get(),
    height: fh.get(),
    left: fl.get() + fw.get(),
  }))
  const frame = useAnimatedStyle(() => ({
    left: fl.get(),
    top: ft.get(),
    width: fw.get(),
    height: fh.get(),
  }))

  // Çerçevenin resimdeki yeri UI tarafında okunur (değerler orada günceldir), sonuç JS tarafına
  // gönderilir; çerçeve bütün resmi kaplıyorsa kırpılacak bir şey yok
  function finishCrop(rect) {
    if (rect) onApply(rect)
    else onCancel()
  }

  function apply() {
    scheduleOnUI(() => {
      'worklet'
      const img = imageRect()
      const x = (fl.get() - img.l) / img.w
      const y = (ft.get() - img.t) / img.h
      const width = fw.get() / img.w
      const height = fh.get() / img.h
      const whole = x < 0.002 && y < 0.002 && width > 0.996 && height > 0.996
      scheduleOnRN(
        finishCrop,
        whole
          ? null
          : {
              x: clamp(x, 0, 1),
              y: clamp(y, 0, 1),
              width: clamp(width, 0, 1 - Math.max(0, x)),
              height: clamp(height, 0, 1 - Math.max(0, y)),
            },
      )
    })
  }

  function reset() {
    scheduleOnUI(() => {
      'worklet'
      fitWhole(true)
    })
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gestures}>
        <View
          style={StyleSheet.absoluteFill}
          onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          {/* Ekranın boyu ölçülmeden çerçevenin yeri bilinmez */}
          {box && (
            <>
              <Animated.View pointerEvents="none" style={[styles.dim, styles.dimTop, topDim]} />
              <Animated.View pointerEvents="none" style={[styles.dim, styles.dimBottom, bottomDim]} />
              <Animated.View pointerEvents="none" style={[styles.dim, styles.dimLeft, leftDim]} />
              <Animated.View pointerEvents="none" style={[styles.dim, styles.dimRight, rightDim]} />

              <Animated.View pointerEvents="none" style={[styles.frame, frame]}>
                {/* Üçte birlik kılavuz çizgileri */}
                <View style={[styles.guideV, { left: '33.33%' }]} />
                <View style={[styles.guideV, { left: '66.66%' }]} />
                <View style={[styles.guideH, { top: '33.33%' }]} />
                <View style={[styles.guideH, { top: '66.66%' }]} />
                {/* Köşe ve kenar tutamaçları */}
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
                <View style={[styles.barH, styles.barTop]} />
                <View style={[styles.barH, styles.barBottom]} />
                <View style={[styles.barV, styles.barLeft]} />
                <View style={[styles.barV, styles.barRight]} />
              </Animated.View>
            </>
          )}
        </View>
      </GestureDetector>

      <View
        style={[
          styles.actions,
          { bottom: insets.bottom + 16, left: insets.left + 16, right: insets.right + 16 },
        ]}
      >
        <TextButton label="Vazgeç" onPress={onCancel} disabled={busy} />
        <TextButton label="Sıfırla" onPress={reset} disabled={busy} />
        <TextButton label={busy ? 'kırpılıyor' : 'Kırp'} onPress={apply} disabled={busy} strong />
      </View>
    </View>
  )
}

function TextButton({ label, onPress, disabled, strong = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, strong && styles.buttonStrong]}>{label + HAND_TAIL}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(14, 11, 7, 0.66)',
  },
  dimTop: { top: 0, left: 0, right: 0 },
  dimBottom: { left: 0, right: 0, bottom: 0 },
  dimLeft: { left: 0 },
  dimRight: { right: 0 },
  frame: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: notebook.paper,
  },
  guideV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(251, 247, 236, 0.55)',
  },
  guideH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(251, 247, 236, 0.55)',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: notebook.paper,
  },
  cornerTL: {
    top: -THICK,
    left: -THICK,
    borderTopWidth: THICK,
    borderLeftWidth: THICK,
  },
  cornerTR: {
    top: -THICK,
    right: -THICK,
    borderTopWidth: THICK,
    borderRightWidth: THICK,
  },
  cornerBL: {
    bottom: -THICK,
    left: -THICK,
    borderBottomWidth: THICK,
    borderLeftWidth: THICK,
  },
  cornerBR: {
    bottom: -THICK,
    right: -THICK,
    borderBottomWidth: THICK,
    borderRightWidth: THICK,
  },
  barH: {
    position: 'absolute',
    left: '50%',
    marginLeft: -EDGE_BAR / 2,
    width: EDGE_BAR,
    height: THICK,
    borderRadius: THICK / 2,
    backgroundColor: notebook.paper,
  },
  barTop: { top: -THICK + 0.5 },
  barBottom: { bottom: -THICK + 0.5 },
  barV: {
    position: 'absolute',
    top: '50%',
    marginTop: -EDGE_BAR / 2,
    width: THICK,
    height: EDGE_BAR,
    borderRadius: THICK / 2,
    backgroundColor: notebook.paper,
  },
  barLeft: { left: -THICK + 0.5 },
  barRight: { right: -THICK + 0.5 },
  actions: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  button: {
    minWidth: 92,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: notebook.paper,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  pressed: {
    backgroundColor: '#F3EEDF',
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontFamily: fonts.hand,
    fontSize: 22,
    lineHeight: 30,
    color: notebook.graphite,
  },
  buttonStrong: {
    fontFamily: fonts.handBold,
  },
})
