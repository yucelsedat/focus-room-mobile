import { useRef, useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'

import { HandIcon } from './HandIcon'
import { attachmentUri } from '../lib/attachments'
import { frameSize, IMAGE_BORDER as BORDER, IMAGE_PAD as PAD, imageLeft } from '../lib/imageLayout'

import { notebook } from '../theme'

const LH = notebook.lineHeight
const MIN_LINES = 2
const MAX_LINES = 14
const HANDLE = 14
const KNOB = 16
const BAR_LEN = 22
// Bu kadar dereceye yaklaşınca düz açıya (0, 90, 180...) yapışır
const SNAP_DEG = 4
// Yana kaydırırken sola, ortaya ya da sağa bu kadar yaklaşınca oraya yapışır
const SNAP_PX = 12

function rotate(v, deg) {
  const r = (deg * Math.PI) / 180
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) }
}

function snapAngle(deg) {
  const normalized = ((((deg + 180) % 360) + 360) % 360) - 180
  const nearest = Math.round(normalized / 90) * 90
  return Math.abs(normalized - nearest) <= SNAP_DEG ? nearest : normalized
}

// Kâğıda bantlanmış fotoğraf. Dokununca köşelerden büyütülüp küçültülebilir,
// üstteki çubuktan döndürülebilir, kendisinden tutulup yana kaydırılabilir, ortadaki elle tam
// ekran açılır.
export function NoteImage({
  image,
  readOnly = false,
  editing,
  onPress,
  onLongPress,
  onChange,
  rows,
  onMove,
  onOpen,
  onAnchor,
  onTouch,
}) {
  const anchorRef = useRef(null)
  const [maxWidth, setMaxWidth] = useState(0)
  const [draftHeight, setDraftHeight] = useState(null)
  const [draftRotation, setDraftRotation] = useState(null)
  const [draftX, setDraftX] = useState(null)
  // Sürüklerken kaç satır inip çıktığı
  const [draftRows, setDraftRows] = useState(0)

  const ratio = image.width / image.height
  const height = draftHeight ?? image.lines * LH - PAD
  const rotation = draftRotation ?? image.rotation
  const frame = frameSize(height, ratio, maxWidth)
  // Resmin yanında kalan boşluk; resim bunun içinde yana kayar
  const room = Math.max(0, maxWidth - frame.w)
  const left = imageLeft(draftX ?? image.x, frame.w, maxWidth)
  const maxHeight = MAX_LINES * LH - PAD
  // Sürüklerken de satır düzeni bozulmasın: blok her zaman tam satır sayısı kadar
  const blockLines = draftHeight === null ? image.lines : Math.max(MIN_LINES, Math.ceil((frame.h + PAD) / LH))

  // Sürükleme başladığı andaki ölçüler; merkez, dokunulan tutamacın konumundan geri hesaplanır.
  // Tutamaç olayları her render'da güncel kapanışla yeniden kaydedildiği için frame/rotation güncel.
  const drag = useRef({
    center: { x: 0, y: 0 },
    startDist: 1,
    startHeight: 0,
    startAngle: 0,
    startRotation: 0,
    startTouchX: 0,
    startTouchY: 0,
    startLeft: 0,
    // Sürüklerken son bulunan yer; bırakılınca bu kaydedilir
    movedX: null,
    movedRows: 0,
  })
  function beginResize(touch, corner) {
    const offset = rotate({ x: (corner.x * frame.w) / 2, y: (corner.y * frame.h) / 2 }, rotation)
    drag.current.center = { x: touch.x - offset.x, y: touch.y - offset.y }
    drag.current.startDist = Math.hypot(offset.x, offset.y)
    drag.current.startHeight = height
  }

  function moveResize(touch) {
    const { center, startDist, startHeight } = drag.current
    const dist = Math.hypot(touch.x - center.x, touch.y - center.y)
    const next = (startHeight * dist) / startDist
    setDraftHeight(Math.min(maxHeight, Math.max(MIN_LINES * LH - PAD, next)))
  }

  function endResize() {
    const lines = Math.round((frame.h + PAD) / LH)
    onChange({ ...image, lines: Math.min(MAX_LINES, Math.max(MIN_LINES, lines)) })
    setDraftHeight(null)
  }

  function beginRotate(touch) {
    const offset = rotate({ x: 0, y: -(frame.h / 2 + BAR_LEN) }, rotation)
    drag.current.center = { x: touch.x - offset.x, y: touch.y - offset.y }
    drag.current.startAngle = Math.atan2(offset.y, offset.x)
    drag.current.startRotation = rotation
  }

  function moveRotate(touch) {
    const { center, startAngle, startRotation } = drag.current
    const angle = Math.atan2(touch.y - center.y, touch.x - center.x)
    setDraftRotation(snapAngle(startRotation + ((angle - startAngle) * 180) / Math.PI))
  }

  function endRotate() {
    onChange({ ...image, rotation: Math.round(rotation * 10) / 10 })
    setDraftRotation(null)
  }

  function beginMove(touch) {
    drag.current.startTouchX = touch.x
    drag.current.startTouchY = touch.y
    drag.current.startLeft = left
    drag.current.movedX = null
    drag.current.movedRows = 0
  }

  function moveTo(touch) {
    if (room > 0) {
      let next = Math.min(room, Math.max(0, drag.current.startLeft + touch.x - drag.current.startTouchX))
      const snap = [0, room / 2, room].find((p) => Math.abs(next - p) <= SNAP_PX)
      if (snap !== undefined) next = snap
      const x = Math.round((next / room) * 1000) / 1000
      drag.current.movedX = x
      setDraftX(x)
    }
    if (rows) {
      const step = Math.round((touch.y - drag.current.startTouchY) / LH)
      const moved = Math.min(rows.max - rows.current, Math.max(rows.min - rows.current, step))
      drag.current.movedRows = moved
      setDraftRows(moved)
    }
  }

  function endMove() {
    const { movedX, movedRows } = drag.current
    drag.current.movedX = null
    drag.current.movedRows = 0
    const x = movedX ?? image.x
    if (rows && onMove) {
      if (movedRows !== 0 || x !== image.x) onMove(x, rows.current + movedRows)
    } else if (x !== image.x) onChange({ ...image, x })
    setDraftX(null)
    setDraftRows(0)
  }

  // Düzenlenirken fotoğrafın kendisinden tutulup sürüklenince satırda yana, bloğunun içinde satır
  // satır yukarı aşağı da kayar
  const movePan = usePanGesture({
    enabled: editing && !readOnly,
    runOnJS: true,
    minDistance: 6,
    onBegin: (e) => {
      onTouch()
      beginMove({ x: e.absoluteX, y: e.absoluteY })
    },
    onUpdate: (e) => moveTo({ x: e.absoluteX, y: e.absoluteY }),
    onFinalize: () => endMove(),
  })

  function open() {
    anchorRef.current?.measureInWindow((x, y, width, h) => onOpen({ x, y, width, height: h }))
  }

  return (
    // Satırın resim dışında kalan yeri dokunuşu tutmaz: resmin yanındaki yazıya dokunulabilsin
    <View
      pointerEvents="box-none"
      style={[styles.block, { height: blockLines * LH }]}
      onLayout={(e) => setMaxWidth(e.nativeEvent.layout.width)}
    >
      <View
        ref={(node) => {
          anchorRef.current = node
          onAnchor?.(node)
        }}
        collapsable={false}
        style={{
          width: frame.w,
          height: frame.h,
          marginLeft: left,
          transform: [{ translateY: draftRows * LH }],
        }}
        onTouchStart={onTouch}
      >
        <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${rotation}deg` }] }]}>
          <GestureDetector gesture={movePan}>
            <Pressable
              onPress={readOnly ? open : onPress}
              onLongPress={readOnly ? undefined : onLongPress}
              delayLongPress={400}
              accessibilityLabel={
                readOnly
                  ? 'Resim. Büyütmek için dokun'
                  : editing
                    ? 'Resim. Sürükleyince yerini değiştirir, silmek için basılı tut'
                    : 'Resim. Düzenlemek için dokun, silmek için basılı tut'
              }
              style={styles.photo}
            >
              <Image
                source={{ uri: attachmentUri(image.name) }}
                style={{ width: frame.w - BORDER * 2, height: frame.h - BORDER * 2 }}
                resizeMode="cover"
              />
              <View style={styles.tape} />
            </Pressable>
          </GestureDetector>

          {editing && (
            <>
              <View pointerEvents="none" style={styles.selection} />
              <View pointerEvents="none" style={[styles.bar, { left: frame.w / 2 - 0.75 }]} />
              <DragHandle
                style={[styles.knob, { left: frame.w / 2 - KNOB / 2 }]}
                onBegin={(touch) => {
                  onTouch()
                  beginRotate(touch)
                }}
                onMove={moveRotate}
                onEnd={endRotate}
              />
              {CORNERS.map((corner) => (
                <DragHandle
                  key={`${corner.x}${corner.y}`}
                  style={[
                    styles.corner,
                    corner.x < 0 ? { left: -HANDLE / 2 } : { right: -HANDLE / 2 },
                    corner.y < 0 ? { top: -HANDLE / 2 } : { bottom: -HANDLE / 2 },
                  ]}
                  onBegin={(touch) => {
                    onTouch()
                    beginResize(touch, corner)
                  }}
                  onMove={moveResize}
                  onEnd={endResize}
                />
              ))}
              <View pointerEvents="box-none" style={styles.handWrap}>
                <View style={styles.handButton}>
                  <HandIcon shape="hand" label="Resmi eline al" onPress={open} size={30} stroke={1.7} />
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  )
}

const CORNERS = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
]

// Sürüklenebilir küçük tutamaç; sonuç React durumuna yazıldığı için olaylar JS tarafında işlenir
function DragHandle({ style, onBegin, onMove, onEnd }) {
  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 1,
    hitSlop: 12,
    onBegin: (e) => onBegin({ x: e.absoluteX, y: e.absoluteY }),
    onUpdate: (e) => onMove({ x: e.absoluteX, y: e.absoluteY }),
    onFinalize: (e) => {
      if (!e.canceled) onEnd()
    },
  })

  return (
    <GestureDetector gesture={pan}>
      <View style={style} />
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  block: {
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  photo: {
    flex: 1,
    padding: BORDER,
    backgroundColor: '#FFFFFF',
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 1, height: 2 },
    elevation: 3,
  },
  tape: {
    position: 'absolute',
    top: -6,
    alignSelf: 'center',
    width: 46,
    height: 14,
    backgroundColor: 'rgba(222, 205, 150, 0.6)',
    transform: [{ rotate: '4deg' }],
  },
  selection: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 1.2,
    borderStyle: 'dashed',
    borderColor: notebook.graphite,
    opacity: 0.7,
  },
  bar: {
    position: 'absolute',
    top: -BAR_LEN,
    width: 1.5,
    height: BAR_LEN - 4,
    backgroundColor: notebook.graphite,
    opacity: 0.7,
  },
  knob: {
    position: 'absolute',
    top: -BAR_LEN - KNOB / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    borderWidth: 1.8,
    borderColor: notebook.graphite,
    backgroundColor: notebook.paper,
  },
  corner: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: 3,
    borderWidth: 1.8,
    borderColor: notebook.graphite,
    backgroundColor: notebook.paper,
  },
  handWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251, 247, 236, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
})
