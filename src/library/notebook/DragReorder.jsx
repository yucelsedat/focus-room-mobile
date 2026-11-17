import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { notebook } from '../theme'

// Sürüklemeye başlamak için tutamağa bu kadar basılı tutulur; kısa dokunuş tutamağın kendi işini
// yapar (kutu işaretlenir), basılı tutmadan kaydırmak sayfayı kaydırır
const HOLD_MS = 280
// Bırakılan kalem yeni yerine bu sürede kayar
const SETTLE_MS = 140

export function useReorder({ onMove, onDragChange }) {
  const extents = useSharedValue([])
  const active = useSharedValue(-1)
  const offset = useSharedValue(0)
  const target = useSharedValue(-1)
  // Tutamaçlara her çizimde aynı işlevler verilir; içleri son haline bakar
  const latest = useRef({ onMove, onDragChange })
  useEffect(() => {
    latest.current = { onMove, onDragChange }
  })

  const onStart = useCallback((index) => {
    latest.current.onDragChange?.(index)
  }, [])

  // Bırakılan kalem yeni sıra çizilene kadar bırakıldığı yerde durur; sürükleme durumu yeni
  // sırayla aynı çizimde sıfırlanır, yoksa kalem bir an eski yerine sıçrar
  const [settled, setSettled] = useState(0)
  useLayoutEffect(() => {
    if (settled === 0) return
    active.set(-1)
    offset.set(0)
    target.set(-1)
  }, [settled, active, offset, target])

  const onEnd = useCallback((from, to) => {
    if (from !== to) latest.current.onMove(from, to)
    latest.current.onDragChange?.(null)
    setSettled((n) => n + 1)
  }, [])

  return { extents, active, offset, target, onStart, onEnd }
}

// Parmağın götürdüğü kalemin ortası hangi kalemlerin ortasını geçtiyse onların arkasına girer
function dropIndex(list, from, dy) {
  'worklet'
  const own = list[from]
  if (!own) return from
  const center = own.top + own.height / 2 + dy
  let to = 0
  for (let i = 0; i < list.length; i++) {
    if (i !== from && list[i].top + list[i].height / 2 < center) to++
  }
  return to
}

// Kalemin bırakılınca gireceği yer: yeni sırasında önüne geleceği kalemin üstü, en sona giderse
// son kalemin altı
function dropLineY(list, from, to) {
  'worklet'
  const others = list.filter((_, i) => i !== from)
  if (others.length === 0) return list[from]?.top ?? 0
  if (to < others.length) return others[to].top
  const last = others[others.length - 1]
  return last.top + last.height
}

// Bırakılan kalemin yeni yerinin üstü, eski yerine göre
function settleOffset(list, from, to) {
  'worklet'
  const own = list[from]
  if (!own || to === from) return 0
  const y = dropLineY(list, from, to)
  return (to > from ? y - own.height : y) - own.top
}

// Basılı tutulup yukarı aşağı sürüklenen tutamaç (notun saati, satırın kutusu)
export function DragHandle({ reorder, index, enabled = true, hitSlop, style, children }) {
  const { extents, active, offset, target, onStart, onEnd } = reorder

  const pan = usePanGesture({
    enabled,
    activateAfterLongPress: HOLD_MS,
    hitSlop,
    onActivate: () => {
      active.set(index)
      offset.set(0)
      target.set(index)
      scheduleOnRN(onStart, index)
    },
    onUpdate: (e) => {
      const list = extents.get()
      const own = list[index]
      if (active.get() !== index || !own || list.length === 0) return
      // Kalemin ortası listenin ilk kaleminin üstüyle son kaleminin altı arasında kalır
      const center = own.top + own.height / 2
      const first = list[0].top
      const last = list[list.length - 1].top + list[list.length - 1].height
      const dy = Math.min(last - center, Math.max(first - center, e.translationY))
      offset.set(dy)
      target.set(dropIndex(list, index, dy))
    },
    onFinalize: (e) => {
      if (active.get() !== index) return
      const to = e.canceled ? index : target.get()
      offset.set(
        withTiming(settleOffset(extents.get(), index, to), { duration: SETTLE_MS }, () => {
          scheduleOnRN(onEnd, index, to)
        }),
      )
    },
  })

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  )
}

// Sürüklenen kalem parmakla birlikte yürür
export function useDraggedStyle(reorder, index) {
  const { active, offset } = reorder
  return useAnimatedStyle(() => {
    const dragged = active.get() === index
    return {
      transform: [{ translateY: dragged ? offset.get() : 0 }],
      opacity: dragged ? 0.9 : 1,
    }
  })
}

// Bırakılınca kalemin gireceği yeri gösteren kurşun kalem çizgisi
export function DropLine({ reorder, left = 0 }) {
  const { extents, active, target } = reorder
  const style = useAnimatedStyle(() => {
    const from = active.get()
    const to = target.get()
    const visible = from !== -1 && to !== -1 && to !== from
    return {
      opacity: visible ? 1 : 0,
      top: visible ? dropLineY(extents.get(), from, to) - 1.5 : 0,
    }
  })
  return <Animated.View pointerEvents="none" style={[styles.line, { left }, style]} />
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    right: 16,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: notebook.graphite,
    opacity: 0,
  },
})
