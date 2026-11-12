// Dikey ekran dokunmatik katmanı (tam ekran, sayfa koordinatları — Canvas da tam
// ekran olduğundan pick() ile aynı uzay). Tek katman, çoklu dokunuşu
// identifier ile ayırır (aynı anda yürü + bak):
//  - Alt-sol bölgede başlayan dokunuş → yüzen joystick (başladığı yer merkez)
//  - Diğer her dokunuş → sürükleyerek bakış
//  - Kısa dokunuş → panel seç (detay sayfası); zemine çift dokunuş → oraya ışınlan
//  - Canvas'ta: oda çipi → o odaya git, link/YouTube/PDF/müzik kartı → tarayıcıda aç
//    (web'de duvardaki canvas'ta da bu kartlar tıklanabilir)
//  - Canvas'a basılı tutma → yatay tam ekran düzenleyici
import { useRef, useState } from 'react'
import { Animated, Linking, StyleSheet, View } from 'react-native'
import { input } from './input'
import { pick, pickTileAt } from '../scene/RoomScene'
import { useStore } from '../store/useStore'
import { assetUrl } from '../api/client'
import { canvasHitTest } from '../canvas/render'
import { colors } from '../theme'

const JOY_RADIUS = 56
const TAP_MOVE = 10
const TAP_MS = 260
const DOUBLE_TAP_MS = 320
const LONG_PRESS_MS = 450

const OPENABLE = new Set(['link', 'youtube', 'insta', 'pdf', 'music'])

export function TouchLayer({ onGo }) {
  const touches = useRef(new Map()) // id → { kind, x0, y0, x, y, t0, moved, timer, long }
  const size = useRef({ w: 1, h: 1 })
  const lastTap = useRef({ t: 0, x: 0, y: 0 })
  const [joyBase] = useState(() => new Animated.ValueXY({ x: -999, y: -999 }))
  const [joyKnob] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }))
  const [joyOpacity] = useState(() => new Animated.Value(0))

  const inJoystickZone = (x, y) => x < size.current.w * 0.55 && y > size.current.h * 0.58

  const onTap = (x, y) => {
    const now = Date.now()
    const st = useStore.getState()
    const hit = pick(x, y)
    const prev = lastTap.current
    const isDouble = now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < 40
    lastTap.current = { t: now, x, y }

    // 1) Panel → detay sayfası
    if (hit?.kind === 'media') {
      const item = st.worldMedia.find((m) => m.id === hit.mediaId)
      if (!item) return
      if (item.type === 'canvas' && hit.uv) {
        const el = canvasHitTest(item.content, item.width, item.height, hit.uv.x, hit.uv.y)
        if (el?.type === 'room' && el.roomId && onGo) {
          // Senkron canvas: hedef odada grubun üyesinin önüne doğ (web navigateToRoom)
          onGo(el.roomId, el.roomName, item.syncGroupId ? { syncGroupId: item.syncGroupId, fromId: item.id } : null)
          return
        }
        if (el && OPENABLE.has(el.type) && el.url) { Linking.openURL(assetUrl(el.url)).catch(() => st.selectMedia(item)); return }
      }
      st.selectMedia(item)
      return
    }
    // 2) + işaretinin hover ettiği duvar tile'ına dokunuş → medya ekleme sayfası (web: E)
    const tile = pickTileAt(x, y)
    const hovered = st.hoveredTile
    if (tile && tile.kind !== 'floor' && hovered && hovered.id === tile.id) {
      st.openTileSheet(hovered)
      return
    }
    // 3) Zemine çift dokunuş → ışınlan
    if (hit?.kind === 'floor' && isDouble) input.teleport = [hit.point.x, hit.point.z]
  }

  // Kıpırdamadan basılı tutulan canvas → tam ekran düzenleyici
  const onLongPress = (rec) => {
    rec.timer = null
    if (rec.moved >= TAP_MOVE || touches.current.size !== 1) return
    const hit = pick(rec.x, rec.y)
    if (hit?.kind !== 'media') return
    const st = useStore.getState()
    const item = st.worldMedia.find((m) => m.id === hit.mediaId)
    if (item?.type !== 'canvas') return
    rec.long = true
    input.lookDX = 0
    input.lookDY = 0
    st.openCanvasEditor(item.id)
  }

  const onStart = (e) => {
    const now = Date.now()
    for (const t of e.nativeEvent.changedTouches) {
      const x = t.pageX
      const y = t.pageY
      const joyTaken = [...touches.current.values()].some((v) => v.kind === 'joy')
      const kind = !joyTaken && inJoystickZone(x, y) ? 'joy' : 'look'
      const rec = { kind, x0: x, y0: y, x, y, t0: now, moved: 0, timer: null, long: false }
      touches.current.set(t.identifier, rec)
      if (kind === 'look' && touches.current.size === 1) {
        rec.timer = setTimeout(() => onLongPress(rec), LONG_PRESS_MS)
      }
      if (kind === 'joy') {
        joyBase.setValue({ x: x - JOY_RADIUS, y: y - JOY_RADIUS })
        joyKnob.setValue({ x: 0, y: 0 })
        joyOpacity.setValue(1)
      }
    }
  }

  const onMove = (e) => {
    for (const t of e.nativeEvent.touches) {
      const rec = touches.current.get(t.identifier)
      if (!rec) continue
      const x = t.pageX
      const y = t.pageY
      if (rec.kind === 'joy') {
        let dx = x - rec.x0
        let dy = y - rec.y0
        const d = Math.hypot(dx, dy)
        if (d > JOY_RADIUS) { dx = (dx / d) * JOY_RADIUS; dy = (dy / d) * JOY_RADIUS }
        joyKnob.setValue({ x: dx, y: dy })
        input.move.x = dx / JOY_RADIUS
        input.move.y = -dy / JOY_RADIUS
      } else {
        input.lookDX += x - rec.x
        input.lookDY += y - rec.y
      }
      rec.moved += Math.hypot(x - rec.x, y - rec.y)
      if (rec.timer && rec.moved >= TAP_MOVE) { clearTimeout(rec.timer); rec.timer = null }
      rec.x = x
      rec.y = y
    }
  }

  const onEnd = (e) => {
    const now = Date.now()
    for (const t of e.nativeEvent.changedTouches) {
      const rec = touches.current.get(t.identifier)
      if (!rec) continue
      touches.current.delete(t.identifier)
      clearTimeout(rec.timer)
      if (rec.long) continue
      if (rec.kind === 'joy') {
        input.move.x = 0
        input.move.y = 0
        joyOpacity.setValue(0)
      } else if (rec.moved < TAP_MOVE && now - rec.t0 < TAP_MS) {
        onTap(rec.x, rec.y)
      }
    }
  }

  const onCancel = () => {
    for (const rec of touches.current.values()) clearTimeout(rec.timer)
    touches.current.clear()
    input.move.x = 0
    input.move.y = 0
    joyOpacity.setValue(0)
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height } }}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onTouchCancel={onCancel}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.base, { opacity: joyOpacity, transform: joyBase.getTranslateTransform() }]}
      >
        <Animated.View style={[styles.knob, { transform: joyKnob.getTranslateTransform() }]} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: JOY_RADIUS * 2,
    height: JOY_RADIUS * 2,
    borderRadius: JOY_RADIUS,
    borderWidth: 1.5,
    borderColor: 'rgba(0,242,255,0.45)',
    backgroundColor: 'rgba(0,242,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    opacity: 0.85,
  },
})
