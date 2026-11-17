import { useEffect, useLayoutEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import Svg, { G, Path, Rect } from 'react-native-svg'

import { drawColorOf, strokePath } from '../lib/drawing'
import { notebook } from '../theme'

const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedRect = Animated.createAnimatedComponent(Rect)

// Seçili çizgilerin çevresindeki kesik çizgili kutunun payı, çizgisinin kalınlığı ve kesiklerinin
// boyu (ekranda, px): zoom ne olursa olsun ekranda aynı durur
export const SELECTION_PAD = 6
const BOX_LINE = 1.5
const BOX_DASH = [5, 4]
const BOX_RADIUS = 3

export function useLiveStroke() {
  const points = useSharedValue([])
  const color = useSharedValue('#38383D')
  const width = useSharedValue(3)
  const id = useSharedValue(0)
  const done = useSharedValue(-1)
  const drag = useSharedValue({ x: 0, y: 0 })
  const selStart = useSharedValue({ x: 0, y: 0 })
  const selEnd = useSharedValue({ x: 0, y: 0 })
  const selShown = useSharedValue(false)
  const selBoxed = useSharedValue(false)
  const moving = useSharedValue(false)
  return { points, color, width, id, done, drag, selStart, selEnd, selShown, selBoxed, moving }
}

// Android'de her SVG kendi boyunda bir bitmap'e çizilir (react-native-svg). Sayfa boyunda bir SVG
// uzun sayfada yüzlerce MB tutar, Android onu çizmeyi reddeder ve uygulama kapanır. Bu yüzden
// kalıcı çizgiler TILE boyunda dilimlere bölünür, yalnızca çizgisi olan dilim kurulur.
const TILE = 1024

function tilesOf(list) {
  const tiles = new Map()
  for (const s of list) {
    let top = Infinity
    let bottom = -Infinity
    for (let i = 1; i < s.p.length; i += 2) {
      top = Math.min(top, s.p[i])
      bottom = Math.max(bottom, s.p[i])
    }
    if (top === Infinity) continue
    const from = Math.max(0, Math.floor((top - s.w) / TILE))
    const to = Math.max(from, Math.floor((bottom + s.w) / TILE))
    for (let t = from; t <= to; t++) {
      const tile = tiles.get(t)
      if (tile) tile.push(s)
      else tiles.set(t, [s])
    }
  }
  return [...tiles]
}

// Çizgiler dilim dilim: her dilim kendi yerinde durur, içindeki çizgiler dilimin üstüne göre kayar
function StrokeTiles({ list }) {
  const tiles = useMemo(() => tilesOf(list), [list])
  return tiles.map(([t, strokes]) => (
    <Svg key={t} style={[styles.tile, { top: t * TILE }]} height={TILE}>
      <G transform={`translate(0 ${-t * TILE})`}>{strokePaths(strokes)}</G>
    </Svg>
  ))
}

const NONE = new Set()

function strokePaths(list) {
  return list.map((s, i) => (
    <Path
      key={i}
      d={strokePath(s.p)}
      stroke={drawColorOf(s.c)}
      strokeWidth={s.w}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ))
}

// Sayfaya çizilen çizgiler: yazı alanının üstünde, notlarla birlikte kayar; dokunuşları geçirir
export function StrokeLayer({ strokes, live, lifted = NONE, zoom, drawing = false, scrollY, viewport }) {
  const resting = useMemo(
    () => (lifted.size > 0 ? strokes.filter((s) => !lifted.has(s)) : strokes),
    [strokes, lifted],
  )
  const raised = useMemo(
    () => (lifted.size > 0 ? strokes.filter((s) => lifted.has(s)) : null),
    [strokes, lifted],
  )

  useEffect(() => {
    if (live.done.get() === live.id.get()) live.points.set([])
  }, [strokes, live])

  // Sürüklenen çizgiler yeni yerlerine yazıldı: bu çizimde onlar yeni nesneler olduğundan seçili
  // katmanda değiller, kayma burada sıfırlanınca hiçbir çizgi yerinden oynamaz
  useLayoutEffect(() => {
    live.drag.set({ x: 0, y: 0 })
  }, [strokes, live])

  // Seçim kutusu sayfanın içinde, çizgilerle aynı yerde çizilir: sayfa büyürken kutu da aynı anda
  // ve aynı kadar büyür. Yalnızca çizgisi, kesikleri ve payı zoom'a bölünür, ekranda aynı kalır.
  const boxProps = useAnimatedProps(() => {
    const k = zoom ? zoom.get() : 1
    const d = live.moving.get() ? live.drag.get() : { x: 0, y: 0 }
    const a = live.selStart.get()
    const b = live.selEnd.get()
    const pad = live.selBoxed.get() ? SELECTION_PAD / k : 0
    const top = scrollY ? scrollY.get() : 0
    return {
      x: Math.min(a.x, b.x) + d.x - pad,
      y: Math.min(a.y, b.y) + d.y - pad - top,
      width: Math.abs(b.x - a.x) + pad * 2,
      height: Math.abs(b.y - a.y) + pad * 2,
      rx: BOX_RADIUS / k,
      strokeWidth: BOX_LINE / k,
      strokeDasharray: BOX_DASH.map((v) => v / k),
      opacity: live.selShown.get() ? 1 : 0,
    }
  })

  const liftedStyle = useAnimatedStyle(() => {
    const d = live.drag.get()
    return { transform: [{ translateX: d.x }, { translateY: d.y }] }
  })

  // Çizilmekte olan çizginin noktaları sayfanın içindedir; çizildiği katman ekranın gördüğü yerden
  // başlar
  const liveProps = useAnimatedProps(() => {
    const top = scrollY ? scrollY.get() : 0
    const p = live.points.get()
    return {
      d: strokePath(top === 0 ? p : p.map((v, i) => (i % 2 === 1 ? v - top : v))),
      stroke: live.color.get(),
      strokeWidth: live.width.get(),
    }
  })

  // Ekranın gördüğü yer: çizim modunda sayfa kaymaz, kamera bu yerin içinde büyür
  const screenStyle = useAnimatedStyle(() => ({
    height: viewport ? viewport.get() : 0,
    transform: [{ translateY: scrollY ? scrollY.get() : 0 }],
  }))

  return (
    <View pointerEvents="none" style={styles.layer}>
      <StrokeTiles list={resting} />
      {raised && (
        <Animated.View style={[StyleSheet.absoluteFill, liftedStyle]}>
          <StrokeTiles list={raised} />
        </Animated.View>
      )}
      {drawing && (
        <Animated.View style={[styles.screen, screenStyle]}>
          <Svg style={StyleSheet.absoluteFill}>
            <AnimatedPath
              animatedProps={liveProps}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <AnimatedRect
              animatedProps={boxProps}
              x={0}
              y={0}
              width={0}
              height={0}
              rx={BOX_RADIUS}
              stroke={notebook.marquee}
              strokeWidth={BOX_LINE}
              strokeDasharray={BOX_DASH}
              fill={notebook.marqueeFill}
              opacity={0}
            />
          </Svg>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // Notların ve resimlerin üstünde, blok seçiminin altında
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
  tile: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TILE,
  },
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
})
