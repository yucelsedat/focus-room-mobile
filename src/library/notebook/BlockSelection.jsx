import { StyleSheet } from 'react-native'
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler'
import Animated, {
  scrollTo,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { notebook } from '../theme'

// Parmak kaydırma alanının üst ya da alt kenarına bu kadar yaklaşınca sayfa o yöne kayar
const EDGE = 56
// Kenara iyice dayanınca sayfanın bir karede (~16 ms) kaydığı yol
const MAX_SPEED = 14

// Bloklardan hangisinin y yüksekliğinde durduğu; boş yerse -1
function blockAt(list, y) {
  'worklet'
  for (let i = 0; i < list.length; i++) {
    if (y >= list[i].top && y < list[i].top + list[i].height) return i
  }
  return -1
}

// Blok seçimi açıkken sayfanın üstünü örten saydam katman: bloklara tek tek dokunarak ya da
// parmakla kesik çizgili bir alan çekerek seçilir. Alan kaydırma alanının kenarına dayanınca sayfa
// kayar, alan da onunla uzar.
export function BlockSelection({ extents, selected, scrollRef, scrollY, viewport, content, onTap, onSweep }) {
  const sweeping = useSharedValue(false)
  // Alanın parmağın ilk değdiği köşesi (içerikte) ve parmağın şu anki yeri: yatayda katmanda,
  // dikeyde görünen alanda; içerikteki yeri sayfa ne kadar kaydıysa o kadar aşağıdadır
  const anchorX = useSharedValue(0)
  const anchorY = useSharedValue(0)
  const fingerX = useSharedValue(0)
  const fingerV = useSharedValue(0)
  // Alan çekilirken sayfanın kaydırıldığı yer ve kendiliğinden kayma hızı
  const top = useSharedValue(0)
  const speed = useSharedValue(0)
  const base = useSharedValue([])
  const lastKey = useSharedValue('')

  // Alanın değdiği bloklar seçilir; seçim değiştiyse haber verilir
  function sweep() {
    'worklet'
    const y = fingerV.get() + top.get()
    const y0 = Math.min(anchorY.get(), y)
    const y1 = Math.max(anchorY.get(), y)
    const list = extents.get()
    const before = base.get()
    const indices = []
    let key = ''
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      const inside = e.height > 0 && e.top < y1 && e.top + e.height > y0
      if (inside || before[i]) {
        indices.push(i)
        key += `${i},`
      }
    }
    if (key === lastKey.get()) return
    lastKey.set(key)
    scheduleOnRN(onSweep, indices)
  }

  const pan = usePanGesture({
    minDistance: 8,
    maxPointers: 1,
    onActivate: (e) => {
      const offset = scrollY.get()
      top.set(offset)
      anchorX.set(e.x - e.translationX)
      anchorY.set(e.y - e.translationY)
      fingerX.set(e.x)
      fingerV.set(e.y - offset)
      base.set(selected.get())
      lastKey.set('')
      sweeping.set(true)
      sweep()
    },
    onUpdate: (e) => {
      if (!sweeping.get()) return
      const v = e.y - top.get()
      fingerX.set(e.x)
      fingerV.set(v)
      const h = viewport.get()
      if (v < EDGE) speed.set(-MAX_SPEED * Math.min(1, (EDGE - v) / EDGE))
      else if (v > h - EDGE) speed.set(MAX_SPEED * Math.min(1, (v - h + EDGE) / EDGE))
      else speed.set(0)
      sweep()
    },
    onFinalize: () => {
      sweeping.set(false)
      speed.set(0)
    },
  })

  const tap = useTapGesture({
    onDeactivate: (e) => {
      if (e.canceled) return
      scheduleOnRN(onTap, blockAt(extents.get(), e.y))
    },
  })

  const gestures = useCompetingGestures(pan, tap)

  // Parmak kenarda durdukça sayfa kayar; alan da kayan sayfayla birlikte uzar
  useFrameCallback((frame) => {
    const s = speed.get()
    if (!sweeping.get() || s === 0) return
    const dt = (frame.timeSincePreviousFrame ?? 16) / 16
    const max = Math.max(0, content.get() - viewport.get())
    const next = Math.min(max, Math.max(0, top.get() + s * dt))
    if (next === top.get()) return
    top.set(next)
    scrollTo(scrollRef, 0, next, false)
    sweep()
  })

  const marqueeStyle = useAnimatedStyle(() => {
    const y = fingerV.get() + top.get()
    const x0 = Math.min(anchorX.get(), fingerX.get())
    const y0 = Math.min(anchorY.get(), y)
    return {
      opacity: sweeping.get() ? 1 : 0,
      left: x0,
      top: y0,
      width: Math.abs(fingerX.get() - anchorX.get()),
      height: Math.abs(y - anchorY.get()),
    }
  })

  return (
    <GestureDetector gesture={gestures}>
      <Animated.View collapsable={false} style={styles.layer}>
        <Animated.View pointerEvents="none" style={[styles.marquee, marqueeStyle]} />
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  // Notların, resimlerin ve sürüklenen notun üstünde
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
  },
  marquee: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: notebook.marquee,
    borderRadius: 3,
    backgroundColor: notebook.marqueeFill,
  },
})
