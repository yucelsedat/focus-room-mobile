import { useEffect, useImperativeHandle, useLayoutEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, {
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollOffset,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { BOOK_RATIO, BookCover } from './BookCover'

import { BOOKS_PER_SHELF } from '../lib/shelves'
import { bookColorOf, shelf as shelfColors } from '../theme'

const SIDE = 24
const GAP = 18
// Rafın kalınlığı ve kitabın üstünde kalan boşluk
const PLANK = 16
const HEADROOM = 24
// Son rafın oluşturma butonunun üstünde kalması için alttaki boşluk
const BOTTOM_SPACE = 96
// Ekranda en az bu kadar raf görünsün; ekran genişse kitaplar buna göre küçülür
const MIN_VISIBLE_SHELVES = 3
// Düzenlerken kitabı tutup sürüklemeye başlamak için bu kadar basılı tutulur; daha önce
// kaydırılırsa kitaplık kayar
const HOLD_MS = 180
// Yer açan kitaplar ve bırakılan kitap yerine bu sürede kayar
const SHIFT_MS = 160
// Sürüklenen kitap ekranın üst ya da alt kenarına bu kadar yaklaşınca kitaplık o yana kendiliğinden
// kayar; kenara dayanınca kare başına en çok bu kadar
const EDGE = 72
const MAX_SPEED = 12

function clamp(value, min, max) {
  'worklet'
  return Math.min(max, Math.max(min, value))
}

function slotLeft(g, index) {
  'worklet'
  return g.side + index * g.step
}

// Kitap rafın üstünde durur
function slotTop(g, shelf) {
  'worklet'
  return shelf * g.rowHeight + HEADROOM
}

function contentHeight(g) {
  return Math.max(g.viewHeight, g.shelfCount * g.rowHeight + BOTTOM_SPACE)
}

function measure(width, height, shelfCount) {
  // Bir rafa BOOKS_PER_SHELF kitap yan yana sığar; ekran genişse en az MIN_VISIBLE_SHELVES raf
  // görünsün diye kitaplar küçülür ve raflar ortalanır
  const byWidth = (width - SIDE * 2 - GAP * (BOOKS_PER_SHELF - 1)) / BOOKS_PER_SHELF
  const byHeight = ((height - BOTTOM_SPACE) / MIN_VISIBLE_SHELVES - HEADROOM - PLANK) / BOOK_RATIO
  const bookWidth = Math.max(40, Math.min(byWidth, byHeight))
  const bookHeight = bookWidth * BOOK_RATIO
  const row = BOOKS_PER_SHELF * bookWidth + (BOOKS_PER_SHELF - 1) * GAP
  return {
    bookWidth,
    bookHeight,
    side: Math.max(SIDE, (width - row) / 2),
    step: bookWidth + GAP,
    rowHeight: HEADROOM + bookHeight + PLANK,
    shelfCount,
    viewWidth: width,
    viewHeight: height,
  }
}

// Sürükleme sürerken kitabın gireceği yer açılınca, raftaki bir kitabın geçici yeri. Tutulan kitap
// kalktığı raftan çıkar, gireceği rafta ona yer açılır; raf taşarsa en sağdaki kitap alttaki rafın
// başına iner, o raf da taşarsa bir alttakine...
function previewSlot(shelf, index, from, to, counts) {
  'worklet'
  let slot = index
  if (shelf === from.shelf && index > from.index) slot--
  let pushed = false
  if (shelf === to.shelf) {
    pushed = slot >= to.index
  } else if (shelf > to.shelf) {
    pushed = true
    for (let s = to.shelf; s < shelf; s++) {
      const count = (counts[s] ?? 0) - (s === from.shelf ? 1 : 0)
      if (count < BOOKS_PER_SHELF) {
        pushed = false
        break
      }
    }
  }
  if (pushed) slot++
  if (slot >= BOOKS_PER_SHELF) return { shelf: shelf + 1, index: slot - BOOKS_PER_SHELF }
  return { shelf, index: slot }
}

// Bir kategorinin kitaplığı: alt alta raflar, her rafta yan yana BOOKS_PER_SHELF kitap; aşağı
// doğru uzar ve aşağı yukarı kaydırılır
export function Bookshelf({ shelves, editing, onOpen, onSelect, onMove, onDragChange, children, ref }) {
  const [size, setSize] = useState(null)
  const [dragging, setDragging] = useState(false)
  const scrollRef = useAnimatedRef()
  const scrollOffset = useScrollOffset(scrollRef)

  useImperativeHandle(ref, () => ({
    scrollToTop: (animated) => scrollRef.current?.scrollTo({ y: 0, animated }),
  }))

  const g = size && measure(size.width, size.height, shelves.length)

  const geometry = useSharedValue(
    g ?? {
      bookWidth: 0,
      bookHeight: 0,
      side: 0,
      step: 0,
      rowHeight: 0,
      shelfCount: 0,
      viewWidth: 0,
      viewHeight: 0,
    },
  )
  const counts = useSharedValue([])
  const active = useSharedValue(-1)
  const moving = useSharedValue(false)
  const from = useSharedValue({ shelf: 0, index: 0 })
  const to = useSharedValue({ shelf: 0, index: 0 })
  const finger = useSharedValue({ x: 0, y: 0, grabY: 0 })
  const offsetX = useSharedValue(0)
  const offsetY = useSharedValue(0)
  const startScroll = useSharedValue(0)
  const scroll = useSharedValue(0)

  const countKey = shelves.map((books) => books.length).join(',')
  useEffect(() => {
    if (g) geometry.set(g)
    // React Compiler g'yi ölçülere göre saklar; ölçüler değişmedikçe aynı nesnedir
  }, [geometry, g])
  useEffect(() => {
    counts.set(countKey.split(',').map(Number))
  }, [counts, countKey])

  // Kitap parmakla birlikte yürür; ortası hangi rafın hizasındaysa o rafa, o rafta hangi
  // kitabın yerine geldiyse onun yerine girer. Raf doluysa en sağa konmaz, en sağdakinin yerine
  // girer ve o kitap alttaki rafa iner.
  function track() {
    'worklet'
    const geo = geometry.get()
    const origin = from.get()
    const f = finger.get()
    const left = slotLeft(geo, origin.index)
    const top = slotTop(geo, origin.shelf)
    const x = clamp(left + f.x, 0, geo.viewWidth - geo.bookWidth)
    const y = clamp(top + f.y + scroll.get() - startScroll.get(), 0, slotTop(geo, geo.shelfCount - 1))
    offsetX.set(x - left)
    offsetY.set(y - top)

    const shelf = clamp(Math.floor((y + geo.bookHeight / 2) / geo.rowHeight), 0, geo.shelfCount - 1)
    const room = (counts.get()[shelf] ?? 0) - (shelf === origin.shelf ? 1 : 0)
    const index = clamp(Math.round((x - geo.side) / geo.step), 0, Math.min(room, BOOKS_PER_SHELF - 1))
    const current = to.get()
    if (current.shelf !== shelf || current.index !== index) to.set({ shelf, index })
  }

  // Kitap ekranın üst ya da alt kenarına götürülünce kitaplık o yana kayar, kitap parmağın
  // altında kalır
  const autoScroll = useFrameCallback((frame) => {
    if (!moving.get()) return
    const geo = geometry.get()
    const f = finger.get()
    // Parmağın görünen alandaki yüksekliği
    const y = slotTop(geo, from.get().shelf) + f.grabY + f.y - startScroll.get()
    let speed = 0
    if (y < EDGE) speed = -(1 - Math.max(0, y) / EDGE)
    else if (y > geo.viewHeight - EDGE) speed = Math.min(1, (y - geo.viewHeight + EDGE) / EDGE)
    if (speed === 0) return
    const elapsed = frame.timeSincePreviousFrame ?? 16
    const max = Math.max(0, geo.shelfCount * geo.rowHeight + BOTTOM_SPACE - geo.viewHeight)
    const next = clamp(scroll.get() + (speed * MAX_SPEED * elapsed) / 16, 0, max)
    if (next === scroll.get()) return
    scroll.set(next)
    scrollTo(scrollRef, 0, next, false)
    track()
  }, false)

  function onStart() {
    setDragging(true)
    onDragChange?.(true)
    autoScroll.setActive(true)
  }

  // Bırakılan kitap yeni düzen çizilene kadar bırakıldığı yerde durur; sürükleme durumu yeni
  // düzenle aynı çizimde sıfırlanır, yoksa kitap bir an eski yerine sıçrar
  const [settled, setSettled] = useState(0)
  useLayoutEffect(() => {
    if (settled === 0) return
    active.set(-1)
    offsetX.set(0)
    offsetY.set(0)
  }, [settled, active, offsetX, offsetY])

  function onEnd(id, start, end) {
    autoScroll.setActive(false)
    if (start.shelf !== end.shelf || start.index !== end.index) onMove(id, end)
    setDragging(false)
    onDragChange?.(false)
    setSettled((n) => n + 1)
  }

  const drag = {
    geometry,
    counts,
    active,
    moving,
    from,
    to,
    finger,
    offsetX,
    offsetY,
    startScroll,
    scroll,
    scrollOffset,
    track,
    onStart,
    onEnd,
  }

  return (
    <View
      style={styles.wall}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
      }}
    >
      {/* Kaydırma alanı ölçülmeden de çizilir: useScrollOffset ilk çizimde ona bağlanır, yoksa
          sürüklerken kaydırma miktarı hep 0 okunur */}
      <Animated.ScrollView
        ref={scrollRef}
        scrollEnabled={!dragging}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={g ? { height: contentHeight(g) } : undefined}
      >
        {g && (
          <>
            {shelves.map((_, shelf) => (
              <View key={shelf} style={[styles.plank, { top: (shelf + 1) * g.rowHeight - PLANK }]} />
            ))}
            {shelves.map((books, shelf) =>
              books.map((book, index) => (
                <ShelfBook
                  key={book.id}
                  book={book}
                  shelf={shelf}
                  index={index}
                  shelves={shelves}
                  geometry={g}
                  editing={editing}
                  drag={drag}
                  onOpen={onOpen}
                  onSelect={onSelect}
                  onMove={onMove}
                />
              )),
            )}
          </>
        )}
      </Animated.ScrollView>
      {children}
    </View>
  )
}

function ShelfBook({ book, shelf, index, shelves, geometry: g, editing, drag, onOpen, onSelect, onMove }) {
  const { id } = book
  const { active, moving, from, to, finger, offsetX, offsetY } = drag

  const pan = usePanGesture({
    enabled: editing,
    activateAfterLongPress: HOLD_MS,
    onActivate: (e) => {
      // Bir kitap tutulmuşken ya da yerine otururken başkası kalkmaz
      if (active.get() !== -1) return
      active.set(id)
      moving.set(true)
      from.set({ shelf, index })
      to.set({ shelf, index })
      finger.set({ x: 0, y: 0, grabY: e.y })
      offsetX.set(0)
      offsetY.set(0)
      drag.startScroll.set(drag.scrollOffset.get())
      drag.scroll.set(drag.scrollOffset.get())
      scheduleOnRN(drag.onStart)
    },
    onUpdate: (e) => {
      if (active.get() !== id) return
      finger.set({ x: e.translationX, y: e.translationY, grabY: finger.get().grabY })
      drag.track()
    },
    onFinalize: (e) => {
      if (active.get() !== id || !moving.get()) return
      moving.set(false)
      const start = from.get()
      if (e.canceled) to.set(start)
      const end = to.get()
      const geo = drag.geometry.get()
      offsetY.set(withTiming(slotTop(geo, end.shelf) - slotTop(geo, start.shelf), { duration: SHIFT_MS }))
      offsetX.set(
        withTiming(slotLeft(geo, end.index) - slotLeft(geo, start.index), { duration: SHIFT_MS }, () => {
          scheduleOnRN(drag.onEnd, id, start, end)
        }),
      )
    },
  })

  // Tutulan kitap parmakla yürür; öbür kitaplar ona yer açmak için yana ya da alttaki rafa kayar
  const animated = useAnimatedStyle(() => {
    const held = active.get()
    if (held === -1) {
      return { zIndex: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] }
    }
    if (held === id) {
      return {
        zIndex: 10,
        transform: [
          { translateX: offsetX.get() },
          { translateY: offsetY.get() },
          { scale: withTiming(moving.get() ? 1.06 : 1, { duration: SHIFT_MS }) },
        ],
      }
    }
    const geo = drag.geometry.get()
    const slot = previewSlot(shelf, index, from.get(), to.get(), drag.counts.get())
    return {
      zIndex: 0,
      transform: [
        { translateX: withTiming((slot.index - index) * geo.step, { duration: SHIFT_MS }) },
        { translateY: withTiming((slot.shelf - shelf) * geo.rowHeight, { duration: SHIFT_MS }) },
        { scale: 1 },
      ],
    }
  })

  // Ekran okuyucuyla düzenlerken kitap eylemlerle bir yana ya da başka rafa taşınır
  const count = shelves[shelf].length
  const moves = []
  if (index > 0) moves.push({ name: 'left', label: 'Sola taşı', to: { shelf, index: index - 1 } })
  if (index < count - 1) {
    moves.push({ name: 'right', label: 'Sağa taşı', to: { shelf, index: index + 1 } })
  }
  if (shelf > 0) {
    const up = shelf - 1
    moves.push({
      name: 'up',
      label: 'Üst rafa taşı',
      to: { shelf: up, index: Math.min(index, shelves[up].length) },
    })
  }
  if (shelf < shelves.length - 1) {
    const down = shelf + 1
    moves.push({
      name: 'down',
      label: 'Alt rafa taşı',
      to: { shelf: down, index: Math.min(index, shelves[down].length) },
    })
  }

  const color = bookColorOf(book.color)
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible={editing}
        accessibilityLabel={editing ? `${book.title}, ${shelf + 1}. raf, ${index + 1}. sıra` : undefined}
        accessibilityHint={editing ? 'Basılı tutup sürükleyerek yerini değiştir' : undefined}
        accessibilityActions={editing ? moves.map(({ name, label }) => ({ name, label })) : undefined}
        onAccessibilityAction={(e) => {
          const move = moves.find((m) => m.name === e.nativeEvent.actionName)
          if (move) onMove(id, move.to)
        }}
        style={[
          styles.book,
          { left: slotLeft(g, index), top: slotTop(g, shelf), width: g.bookWidth },
          animated,
        ]}
      >
        <BookCover
          title={book.title}
          width={g.bookWidth}
          color={color.cover}
          band={color.band}
          binding={book.binding}
          subtitle={book.year ? String(book.year) : undefined}
          hint="Defteri kaldığın sayfadan aç; basılı tutunca seçenekler"
          onPress={editing ? undefined : () => onOpen(book)}
          onLongPress={editing ? undefined : () => onSelect(book)}
        />
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  wall: {
    flex: 1,
  },
  book: {
    position: 'absolute',
  },
  plank: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: PLANK,
    borderTopWidth: 4,
    borderTopColor: shelfColors.woodTop,
    borderBottomWidth: 3,
    borderBottomColor: shelfColors.woodEdge,
    borderRadius: 2,
    backgroundColor: shelfColors.wood,
    boxShadow: '0px 8px 10px rgba(0, 0, 0, 0.45)',
  },
})
