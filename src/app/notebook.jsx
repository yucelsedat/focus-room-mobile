import { router, useLocalSearchParams } from 'expo-router'
import Storage from '../library/lib/storage'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useState } from 'react'
import { Alert, BackHandler, Keyboard, StyleSheet, useWindowDimensions, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { scheduleOnRN } from 'react-native-worklets'

import { NotebookLoader } from '../library/notebook/NotebookLoader'
import { NotebookPage } from '../library/notebook/NotebookPage'
import { PageIndex } from '../library/notebook/PageIndex'
import { Paper } from '../library/notebook/Paper'
import {
  getNotebook,
  getWrittenPages,
  deleteNotebookPage,
  insertNotebookPage,
  setNotebookPageCount,
} from '../library/db'
import { deleteContentFiles } from '../library/lib/blockClipboard'
import { DEFAULT_PEN } from '../library/lib/marks'
import {
  filterKindOf,
  hasNumberedPages,
  layoutOf,
  monthRef,
  slotKey,
  writtenKey,
} from '../library/lib/notebookLayout'
import { lastPageKey, rememberNotebook } from '../library/lib/notebookState'

// Görünen sayfanın iki yanında kaçar sayfa hazır tutulur; çevrilen sayfanın altındaki
// sayfa çoktan yüklenmiş olur
const PRELOAD = 2
// Perspektif uzaklığı, sayfa genişliği cinsinden: küçüldükçe kalkan kenar göze daha çok yaklaşır
const DEPTH = 4
// Sayfayı çevirmeye yeten sürükleme oranı ve fırlatma hızı
const TURN_DISTANCE = 0.3
const TURN_VELOCITY = 600
// Sayfa hazır haberi gelmese de loader en geç bu kadar sonra kalkar (ms)
const LOADER_TIMEOUT = 8000
// Eklenen sayfaya çevirmenin süresi (ms)
const ADD_TURN_DURATION = 560

function clampPage(index, count) {
  'worklet'
  return Math.min(count - 1, Math.max(0, index))
}

function clamp01(value) {
  'worklet'
  return Math.min(1, Math.max(0, value))
}

// Defter istenen sayfadan (takvimden ya da ayraçlardan gelince), yoksa en son
// kalınan sayfadan açılır; hiç açılmadıysa ajandada bugünden, not defterinde ilk sayfadan
function initialPage(notebookId, layout, count, key) {
  let saved = key ?? null
  if (!saved) {
    try {
      saved = Storage.getItemSync(lastPageKey(notebookId))
    } catch {}
  }
  return clampPage(saved ? layout.nearest(saved) : layout.start(), count)
}

// Yazılı sayfaların numaraları, defterdeki sırasıyla; türler verilirse yalnızca o türdekiler.
// Defterde olmayan sayfaların (ör. ajandanın yılı dışındaki günlerin) yazıları atlanır.
async function writtenPageIndices(notebookId, layout, count, kinds) {
  const rows = await getWrittenPages(notebookId)
  return rows
    .map((row) => layout.find(writtenKey(row)))
    .filter(
      (index) =>
        index >= 0 && index < count && (!kinds || kinds.includes(filterKindOf(layout.slotAt(index).kind))),
    )
    .sort((a, b) => a - b)
}

// Notlu sayfanın kaydı. Sunucuda (focus-room) yalnızca numaralı sayfalar ve ay sayfaları var;
// ajandanın gün ve hafta sayfaları web'deki gibi sonraki fazda (Faz 9) gelecek.
async function resolvePage(notebookId, slot) {
  switch (slot.kind) {
    case 'month-goals':
    case 'month-review':
      return { kind: slot.kind, ref: monthRef(slot.year, slot.month), notebookId }
    case 'page':
      return { kind: 'page', ref: slot.number, notebookId }
    default:
      return null
  }
}

// Sayfa çevirerek gezilen defter
export default function NotebookScreen() {
  const { id, date } = useLocalSearchParams()
  const notebookId = Number(id)
  const [notebook, setNotebook] = useState(null)
  // Açılan sayfa içeriğiyle çizilene kadar loader görünür, sonra solarak kalkar
  const [ready, setReady] = useState(false)
  const [loaderShown, setLoaderShown] = useState(true)
  const markReady = useCallback(() => setReady(true), [])
  const hideLoader = useCallback(() => setLoaderShown(false), [])

  useEffect(() => {
    let cancelled = false
    getNotebook(notebookId)
      .then((result) => {
        if (cancelled) return
        if (result) setNotebook(result)
        else throw new Error('Bu defter artık yok.')
      })
      .catch((err) => {
        if (cancelled) return
        // Sunucuya ulaşılamazsa ya da defter silinmişse kitaplığa dönülür
        Alert.alert('Defter açılamadı', err.message)
        if (router.canGoBack()) router.back()
        else router.replace('/')
      })
    return () => {
      cancelled = true
    }
  }, [notebookId])

  // Sayfa hazır haberi hiç gelmezse (ör. sayfa kaydı açılamazsa) loader sonsuza dek kalmasın
  useEffect(() => {
    const timer = setTimeout(markReady, LOADER_TIMEOUT)
    return () => clearTimeout(timer)
  }, [markReady])

  // Sayfaların sırası defterin türüne ve düzenine bağlı; defter okunana kadar masa görünür
  return (
    <View style={styles.desk}>
      {notebook && <OpenNotebook notebook={notebook} pageKey={date} onReady={markReady} />}
      {loaderShown && <NotebookLoader done={ready} onHidden={hideLoader} />}
    </View>
  )
}

function OpenNotebook({ notebook, pageKey, onReady }) {
  const { width } = useWindowDimensions()
  const notebookId = notebook.id
  const isNotes = hasNumberedPages(notebook.kind)
  const layout = layoutOf(notebook)
  // Okuma modu ve sayfa filtresi sayfa çevrilince de sürer. İkisinden biri açıkken boş sayfalar
  // atlanır: yalnızca yazılı sayfalar (written), filtre varsa da yalnızca seçilen türdekiler
  // çevrilir; page ve position o zaman bu listedeki sırayı gösterir.
  const [reading, setReading] = useState(false)
  const [kinds, setKinds] = useState(null)
  const [written, setWritten] = useState(null)
  // Elde tutulan kalem de sayfa çevrilince değişmez
  const [pen, setPen] = useState(DEFAULT_PEN)
  const [page, setPage] = useState(() =>
    initialPage(notebookId, layout, isNotes ? notebook.page_count + 1 : layout.count, pageKey),
  )
  // Not defterinin sayfa sayısı. Son sayfanın ardında boş bir sayfa daha durur; ona çevrilince
  // defter bir sayfa uzar.
  const [pages, setPages] = useState(() => Math.max(notebook.page_count, page + 1))
  const fullCount = isNotes ? pages + 1 : layout.count
  const pageCount = written ? written.length : fullCount
  const pageAt = (order) => (written ? written[order] : order)
  // Kesirli sayfa konumu: 12.4 ise 12. sayfa %40 kalkmış, altından 13. sayfa görünüyor
  const position = useSharedValue(page)
  const dragStart = useSharedValue(page)
  const turnCount = useSharedValue(fullCount)
  const [locked, setLocked] = useState(false)
  // Defter açılırken önce yalnızca görünen sayfa kurulur; o çizilince iki yanındaki sayfalar
  // hazırlanır. Beş sayfayı birden kurmak açılışı en çok geciktiren işti.
  const [preload, setPreload] = useState(0)

  // Not defterine eklenen ve defterden çıkarılan sayfaların yerleri, yapıldıkları sırayla. Sayfa
  // eklenince ardındaki sayfalar bir numara ileri, çıkarılınca bir numara geri kayar; açık
  // yapraklar sayfalarıyla birlikte kaysın (yeniden kurulup göz kırpmasın) diye her yaprağın
  // anahtarı, bu değişikliklerden önceki numarasından bulunur.
  const [edits, setEdits] = useState([])
  // Sayfa eklenince yapılacak çevirme (nereden nereye), yapraklar yeni yerlerine çizilene kadar
  // bekler. Sola eklenen sayfa (entering) görünen sayfanın üstüne kapanacağı için ilk karede
  // çevrilmiş durmalı; o kare çizilene kadar kurulmaz.
  const [pendingTurn, setPendingTurn] = useState(null)

  function sheetKey(index) {
    let original = index
    for (let n = edits.length - 1; n >= 0; n--) {
      const edit = edits[n]
      if (edit.kind === 'insert') {
        if (original === edit.at) return `added-${n}`
        if (original > edit.at) original--
      } else if (original >= edit.at) {
        original++
      }
    }
    return `page-${original}`
  }

  // Defterden çıkarılan sayfa, altındaki sayfayı göstererek kalkana kadar kendi yaprağında durur;
  // ghostTurn o yaprağın konumu (0'da düz, 1'de kalkmış). Ekleri kalkınca silinir.
  const [ghost, setGhost] = useState(null)
  const ghostTurn = useSharedValue(0)

  // Görünen sayfanın hazır haberi gelmezse komşular yine de kurulsun
  useEffect(() => {
    const timer = setTimeout(() => setPreload(PRELOAD), LOADER_TIMEOUT)
    return () => clearTimeout(timer)
  }, [])

  // Sayfalar bu işlevi kendi effect event'lerinden çağırır; kimliğinin değişmesi sorun olmaz
  function markCurrentReady() {
    onReady?.()
    if (preload === PRELOAD) return
    // Görünen sayfa ekrana çizilsin, komşular bir sonraki turda kurulsun
    requestAnimationFrame(() => setTimeout(() => setPreload(PRELOAD), 0))
  }

  // Defter sekmesi en son açılan defteri açar
  useEffect(() => {
    rememberNotebook(notebookId)
  }, [notebookId])

  useEffect(() => {
    if (isNotes && pages !== notebook.page_count) {
      setNotebookPageCount(notebookId, pages).catch(() => {})
    }
  }, [isNotes, notebookId, notebook.page_count, pages])

  // Not defteri uzayınca son sayfaya kadar çevrilebilsin
  useEffect(() => {
    if (!written) turnCount.set(fullCount)
  }, [written, fullCount, turnCount])

  function remember(index) {
    Storage.setItemAsync(lastPageKey(notebookId), slotKey(layout.slotAt(index))).catch(() => {})
  }

  function settle(order) {
    setPage(order)
    const index = pageAt(order)
    remember(index)
    if (isNotes && index >= pages) setPages(index + 1)
  }

  // Sayfa çevirme bir moddan ötekinin sırasına geçer; yarım kalan çevirme iptal edilir
  function jumpTo(order, count) {
    cancelAnimation(position)
    position.set(order)
    turnCount.set(count)
    setPage(order)
  }

  // Okuma modu ya da filtre değişince çevrilecek sayfalar yeniden seçilir: bu sayfa listede yoksa
  // ondan sonraki ilk sayfaya geçilir. Gösterilecek sayfa yoksa hiçbir şey değişmez, false döner.
  async function turnThrough(nextReading, nextKinds) {
    const current = pageAt(page)
    if (!nextReading && !nextKinds) {
      jumpTo(current, fullCount)
      setWritten(null)
    } else {
      const indices = await writtenPageIndices(notebookId, layout, fullCount, nextKinds)
      if (indices.length === 0) return false
      const after = indices.findIndex((index) => index >= current)
      jumpTo(after === -1 ? indices.length - 1 : after, indices.length)
      setWritten(indices)
    }
    setReading(nextReading)
    setKinds(nextKinds)
    return true
  }

  // Not defterinde görünen sayfanın soluna (önüne) ya da sağına (ardına) boş bir sayfa eklenir ve
  // ona çevrilir. Okuma modu ve filtre kapanır: yeni sayfa boş, onlarla görünmezdi.
  async function addPage(side) {
    if (!isNotes) return
    Keyboard.dismiss()
    const current = pageAt(page)
    const at = side === 'left' ? current : current + 1
    await insertNotebookPage(notebookId, at + 1)
    cancelAnimation(position)
    setWritten(null)
    setReading(false)
    setKinds(null)
    setEdits((prev) => [...prev, { kind: 'insert', at }])
    setPages((prev) => prev + 1)
    turnCount.set(pages + 2)
    if (side === 'left') {
      // Görünen sayfa bir numara kayar; yeni sayfa soldan üstüne kapanır
      setPage(current + 1)
      setPendingTurn({ from: current + 1, to: current, entering: `added-${edits.length}` })
    } else {
      // Yeni sayfa görünen sayfanın altına girer; görünen sayfa kalkıp onu gösterir
      setPage(current)
      setPendingTurn({ from: current, to: current + 1 })
    }
  }

  // Not defterinde görünen sayfa defterden çıkar: yaprağı kalkar, altından ardındaki sayfa görünür
  // ve onun yerine geçer. Son sayfa çıkarılırsa altından defterin sonundaki boş sayfa görünür.
  async function deletePage() {
    if (!isNotes || ghost) return
    Keyboard.dismiss()
    const current = pageAt(page)
    const key = sheetKey(current)
    const contents = await deleteNotebookPage(notebookId, current + 1)
    cancelAnimation(position)
    ghostTurn.set(0)
    setGhost({ key, index: current, contents })
    setWritten(null)
    setReading(false)
    setKinds(null)
    setEdits((prev) => [...prev, { kind: 'remove', at: current }])
    setPages((prev) => Math.max(1, prev - 1))
    turnCount.set(Math.max(1, pages - 1) + 1)
    setPage(current)
    remember(current)
  }

  // Yaprak kalkınca kaldırılır, eklerinin dosyaları silinir
  function finishGhost() {
    if (ghost) deleteContentFiles(ghost.contents)
    setGhost(null)
  }

  const startGhostTurn = useEffectEvent((index) => {
    // Çıkarılan yaprak düz durup her şeyi örterken çevrilen sayfalar yeni sıralarına geçer
    position.set(index)
    ghostTurn.set(
      withTiming(1, { duration: ADD_TURN_DURATION, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(finishGhost)
      }),
    )
  })

  useLayoutEffect(() => {
    if (ghost) startGhostTurn(ghost.index)
  }, [ghost])

  const startTurn = useEffectEvent((from, to) => {
    position.set(from)
    position.set(
      withTiming(to, { duration: ADD_TURN_DURATION, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(settle, to)
      }),
    )
  })

  // Sayfa eklenip yapraklar yeni yerlerine çizilince çevirme başlar; sola eklenen sayfa bir kare
  // sonra, çevrilmiş halde kurulur
  useLayoutEffect(() => {
    if (!pendingTurn) return
    startTurn(pendingTurn.from, pendingTurn.to)
    const frame = requestAnimationFrame(() => setPendingTurn(null))
    return () => cancelAnimationFrame(frame)
  }, [pendingTurn])

  async function changeReading(next) {
    if (!(await turnThrough(next, kinds))) {
      Alert.alert('Okuma modu', 'Bu defterde henüz yazılı sayfa yok.')
    }
  }

  // Takvim (not defterinde sayfa listesi), görünen sayfanın üstüne soldan kapanan bir yaprak.
  // calendarTurn yaprağın konumu: 1'de sırtında dik durur (görünmez), 0'da sayfanın üstüne kapanmıştır.
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarTurn = useSharedValue(1)

  function openCalendar() {
    Keyboard.dismiss()
    setCalendarOpen(true)
  }

  // Yaprak çizildikten sonra kapanmaya başlar, yoksa yolun bir kısmı görünmeden geçer
  useEffect(() => {
    if (calendarOpen) {
      calendarTurn.set(withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }))
    }
  }, [calendarOpen, calendarTurn])

  // Yaprak kalkıp altındaki sayfayı gösterir; yeni açılan sayfa yüklensin diye biraz beklenebilir
  function closeCalendar(delay = 0) {
    calendarTurn.set(
      withDelay(
        delay,
        withTiming(1, { duration: 520, easing: Easing.inOut(Easing.cubic) }, (finished) => {
          if (finished) scheduleOnRN(setCalendarOpen, false)
        }),
      ),
    )
  }

  // Takvimden ya da sayfa listesinden seçilen sayfa açılır. Okurken ya da filtre açıkken o sayfa
  // çevrilenler arasında değilse okuma modu ve filtre kapanır.
  function openFromCalendar(key) {
    const index = clampPage(layout.nearest(key), fullCount)
    const order = written ? written.indexOf(index) : index
    if (written && order !== -1) {
      jumpTo(order, written.length)
    } else {
      jumpTo(index, fullCount)
      setWritten(null)
      setReading(false)
      setKinds(null)
    }
    remember(index)
    closeCalendar(160)
  }

  const onBackPress = useEffectEvent(() => closeCalendar())

  useEffect(() => {
    if (!calendarOpen) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackPress()
      return true
    })
    return () => sub.remove()
  }, [calendarOpen])

  const currentSlot = layout.slotAt(pageAt(page))

  const pan = usePanGesture({
    enabled: !locked && !calendarOpen && !ghost,
    // Dikey kaydırma notların; yalnızca belirgin yatay sürükleme sayfayı çevirir
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onActivate: () => {
      // Biten bir çevirme yarıda yakalanırsa kaldığı yerden sürüklenir
      cancelAnimation(position)
      dragStart.set(position.get())
    },
    onUpdate: (e) => {
      const base = Math.round(dragStart.get())
      // Sola sürükleyince sayfa ilerler; bir seferde tek sayfa çevrilir
      const next = dragStart.get() - e.translationX / width
      position.set(clampPage(Math.min(base + 1, Math.max(base - 1, next)), turnCount.get()))
    },
    onDeactivate: (e) => {
      const base = Math.round(dragStart.get())
      const moved = position.get() - base
      let target = base
      if (moved > 0 && (moved > TURN_DISTANCE || e.velocityX < -TURN_VELOCITY)) target = base + 1
      if (moved < 0 && (moved < -TURN_DISTANCE || e.velocityX > TURN_VELOCITY)) target = base - 1
      target = clampPage(target, turnCount.get())

      const remaining = Math.abs(target - position.get())
      position.set(
        withTiming(
          target,
          { duration: 120 + 380 * remaining, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) scheduleOnRN(settle, target)
          },
        ),
      )
    },
  })

  // Büyük numaralı sayfa altta: önceki sayfa sonrakinin üstüne kapanır
  const sheets = []
  for (let i = page + preload; i >= page - preload; i--) {
    if (i >= 0 && i < pageCount && sheetKey(pageAt(i)) !== pendingTurn?.entering) sheets.push(i)
  }

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.desk}>
        {/* Çıkarılan sayfanın yaprağı aynı listede, en üstte kalkar: anahtarı değişmediği için
            yeniden kurulmaz, yazıları silinmiş olsa da kalkarken görünür */}
        {[
          ...sheets.map((order) => (
            <Sheet
              key={sheetKey(pageAt(order))}
              index={pageAt(order)}
              layout={layout}
              order={order}
              count={written?.length}
              notebookId={notebookId}
              paper={notebook.paper}
              position={position}
              width={width}
              isCurrent={order === page}
              onLockChange={order === page ? setLocked : undefined}
              reading={reading}
              onReadingChange={changeReading}
              filtering={kinds !== null}
              onSearchPress={isNotes ? openCalendar : undefined}
              pen={pen}
              onPenChange={setPen}
              onReady={order === page ? markCurrentReady : undefined}
              onAddPage={isNotes ? addPage : undefined}
              onDeletePage={isNotes ? deletePage : undefined}
            />
          )),
          ghost && (
            <Sheet
              key={ghost.key}
              turnId="ghost"
              index={ghost.index}
              layout={layout}
              order={0}
              notebookId={notebookId}
              paper={notebook.paper}
              position={ghostTurn}
              width={width}
              isCurrent={false}
              reading={false}
              onReadingChange={changeReading}
              filtering={false}
              pen={pen}
              onPenChange={setPen}
            />
          ),
        ]}
        {/* Yaprak kalkarken sayfaya dokunulmaz */}
        {ghost && <View style={StyleSheet.absoluteFill} />}

        {calendarOpen && (
          <TurnSheet id="calendar" order={0} position={calendarTurn} width={width} isCurrent>
            <PageIndex
              notebookId={notebookId}
              pages={pages}
              current={currentSlot.number}
              onClose={() => closeCalendar()}
              onOpenPage={(number) => openFromCalendar(`page:${number}`)}
            />
          </TurnSheet>
        )}
      </View>
    </GestureDetector>
  )
}

// Defterin bir sayfası
function Sheet({
  index,
  layout,
  order,
  count,
  notebookId,
  paper,
  position,
  width,
  isCurrent,
  onLockChange,
  reading,
  onReadingChange,
  filtering,
  onSearchPress,
  pen,
  onPenChange,
  onReady,
  onAddPage,
  onDeletePage,
  turnId,
}) {
  const [page, setPage] = useState(null)
  const folio = count === undefined ? undefined : { number: order + 1, total: count }

  useEffect(() => {
    const target = layout.slotAt(index)
    let cancelled = false
    resolvePage(notebookId, target).then((p) => {
      if (!cancelled && p) setPage(p)
    })
    return () => {
      cancelled = true
    }
  }, [notebookId, layout, index])

  return (
    <TurnSheet
      id={turnId ?? `page-${index}`}
      order={order}
      position={position}
      width={width}
      isCurrent={isCurrent}
    >
      {page === null ? (
        <Paper paper={paper}>{null}</Paper>
      ) : (
        <NotebookPage
          page={page}
          paper={paper}
          isCurrent={isCurrent}
          onLockChange={onLockChange}
          reading={reading}
          onReadingChange={onReadingChange}
          filtering={filtering}
          onSearchPress={onSearchPress}
          pen={pen}
          onPenChange={onPenChange}
          folio={folio}
          onReady={onReady}
          onAddPage={onAddPage}
          onDeletePage={onDeletePage}
        />
      )}
    </TurnSheet>
  )
}

// Defterin bir yaprağı. Sol kenarı (sırtı) etrafında döner: serbest kenarın ekrandaki yeri
// cos(açı) ile gerilediği için açı, kenar parmağı izleyecek şekilde hesaplanır.
function TurnSheet({ id, order, position, width, isCurrent, children }) {
  const turnStyle = useAnimatedStyle(() => {
    const d = position.get() - order
    const angle = (Math.acos(1 - clamp01(d)) * 180) / Math.PI
    return {
      // Çevrilmiş sayfalar ve iki kat alttakiler gizlenir; hemen alttaki çizili kalır ki
      // üstteki kalkınca ilk karede hazır olsun. Tam çevrilmiş (90°) sayfa da gizlenmeli:
      // Android perspektifi görünümün ortasından baktığı için o sayfa sol kenarda şerit olarak görünür.
      opacity: d > -2 && d < 1 ? 1 : 0,
      transform: [{ perspective: width * DEPTH }, { rotateY: `${-angle}deg` }],
    }
  })

  // Kalkan yaprak ışıktan uzaklaştıkça kararır
  const shadeStyle = useAnimatedStyle(() => ({
    opacity: clamp01(position.get() - order),
  }))

  // Üstteki yaprak kalkarken bu sayfaya düşen gölge, yaprağın serbest kenarını izler
  const castStyle = useAnimatedStyle(() => {
    const lift = clamp01(position.get() - order + 1)
    const cos = 1 - lift
    const sin = Math.sqrt(1 - cos * cos)
    // Perspektifle göze yaklaşan kenar, sırttan biraz daha uzakta görünür
    const edgeX = (width * cos * DEPTH) / (DEPTH - sin)
    return {
      opacity: lift > 0 && lift < 1 ? 1 - lift : 0,
      transform: [{ translateX: edgeX }],
    }
  })

  const dimStyle = useAnimatedStyle(() => {
    const lift = clamp01(position.get() - order + 1)
    return { opacity: lift > 0 && lift < 1 ? 0.18 * (1 - lift) : 0 }
  })

  return (
    <Animated.View
      pointerEvents={isCurrent ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.sheet, turnStyle]}
    >
      {children}

      <Animated.View pointerEvents="none" style={[styles.dim, dimStyle]} />
      <Animated.View pointerEvents="none" style={[styles.cast, { width: width * 0.3 }, castStyle]}>
        <Gradient id={`cast-${id}`} from={0.32} to={0} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shadeStyle]}>
        <Gradient id={`shade-${id}`} from={0.12} to={0.45} />
      </Animated.View>
    </Animated.View>
  )
}

// Soldan sağa koyulaşan ya da açılan siyah geçiş
function Gradient({ id, from, to }) {
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#000" stopOpacity={from} />
          <Stop offset="1" stopColor="#000" stopOpacity={to} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  )
}

const styles = StyleSheet.create({
  // Gün sayfasındaki masa rengi; sayfalar yüklenirken arada görünür
  desk: {
    flex: 1,
    backgroundColor: '#2B2620',
  },
  sheet: {
    transformOrigin: 'left center',
    backfaceVisibility: 'hidden',
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
  cast: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
})
