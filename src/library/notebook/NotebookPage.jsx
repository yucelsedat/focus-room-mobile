import * as Clipboard from 'expo-clipboard'
import { BlurTargetView } from 'expo-blur'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BlockSelection } from './BlockSelection'
import { AttachMenu, BAR_HEIGHT, BottomBar, SelectionBar } from './BottomBar'
import { DocumentBar } from './DocumentBar'
import { DOC_ROW_LEFT, DocumentContext } from './DocumentMode'
import { DropLine, useReorder } from './DragReorder'
import { DrawingOverlay, moveCamera, useCamera } from './DrawingMode'
import { NoteEntry } from './NoteEntry'
import { MarginTime } from './NoteTextSegment'
import { PageHeading, PageTopBar } from './PageTop'
import { Paper, RuledLines } from './Paper'
import { PageSidebar } from './PageSidebar'
import { PenMenu } from './PenMenu'
import { StrokeLayer, useLiveStroke } from './StrokeLayer'
import { TimeMenu } from './TimeMenu'
import { ImageViewer } from './ImageViewer'

import {
  createNote,
  deleteEmptyNotes,
  deleteNote,
  getPageNotes,
  getPageTitle,
  isFavorite,
  setFavorite,
  setNoteOrder,
  setPageTitle,
  updateNote,
} from '../db'
import {
  attachmentUri,
  cropAttachmentImage,
  deleteAttachmentFile,
  importPastedImage,
  pasteImageFromClipboard,
  pickFile,
  pickImageFromLibrary,
  takePhoto,
} from '../lib/attachments'
import {
  blockOf,
  blocksText,
  deleteBlockFiles,
  clearClipboard,
  putOnClipboard,
  takeFromClipboard,
  useClipboardBlocks,
  withCopiedFiles,
} from '../lib/blockClipboard'
import {
  clockTime,
  DEFAULT_PEN,
  inkText,
  marksIn,
  moveLineMarks,
  paintHighlight,
  parseMarks,
  serializeMarks,
  setHighlight,
  setInk,
  shiftMarks,
  shiftBoxTimes,
} from '../lib/marks'
import { DEFAULT_DRAW_PEN, strokesBottom } from '../lib/drawing'
import { DOCUMENT_PAPERS, isDocumentPaper } from '../lib/documentPaper'
import { setRawMarkdown, useRawMarkdown } from '../lib/documentSettings'
import { padForInsertion } from '../lib/richText/htmlToMarkdown'
import { insertCodeBlock, toggleInline, toggleLines } from '../lib/richText/markdownEdit'
import {
  missingLinksNotice,
  pasteEventMarkdown,
  readClipboardMarkdown,
  useClipboardHasText,
} from '../lib/richText/usePasteRichText'
import { monthOfRef, sheetHeading } from '../lib/notebookLayout'
import { useDictation } from '../lib/useDictation'
import { usePageDrawing } from '../lib/usePageDrawing'
import { useKeyboardVisible } from '../lib/useKeyboardVisible'
import { insertAttachment, parseContent, serializeContent } from '../lib/noteContent'
import { lineOrder, moveLine, toggleCheckLine, toggleNumberLine } from '../lib/noteLists'
import { docPage, fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

import { addImagePasteListener } from '../../../modules/note-paste'

// Çizim modunda en son seçilen araç ve kalem; sayfa çevrilince de, başka bir sayfada çizim modu
// açılınca da onlarla açılır
const lastDrawing = { tool: 'pen', pen: DEFAULT_DRAW_PEN }

// Bloğun sırası; sayfada yoksa sayfanın sonu
function indexOrEnd(list, id) {
  const index = list.findIndex((n) => n.id === id)
  return index === -1 ? list.length : index
}

// Bloğun hemen altındaki sıra; blok sayfada yoksa sayfanın sonu
function afterIndex(list, id) {
  const index = list.findIndex((n) => n.id === id)
  return index === -1 ? list.length : index + 1
}

// Panoda resim olup olmadığını izler; varsa ataç menüsünde "panodaki resmi yapıştır" çıkar
function useClipboardHasImage() {
  const [hasImage, setHasImage] = useState(false)

  const check = useCallback(() => {
    Clipboard.hasImageAsync()
      .then(setHasImage)
      .catch(() => setHasImage(false))
  }, [])

  useEffect(() => {
    check()
    const clipboardSub = Clipboard.addClipboardListener(check)
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
    })
    return () => {
      clipboardSub.remove()
      appStateSub.remove()
    }
  }, [check])

  return [hasImage, check]
}

async function loadHeading(page) {
  if (page.kind === 'page') {
    const title = await getPageTitle(page.notebookId, page.ref)
    return {
      ...sheetHeading({ kind: 'page', number: page.ref }, title),
      hint: 'Yazmaya başla',
    }
  }
  // Ayın hedefler ya da değerlendirme sayfası. Ajandanın gün ve hafta sayfaları ile pano notları
  // focus-room'da henüz yok (web'deki gibi sonraki faz).
  if ('ref' in page) {
    return {
      ...sheetHeading({ kind: page.kind, ...monthOfRef(page.ref) }),
      hint: page.kind === 'month-goals' ? 'Ayın hedeflerini yaz' : 'Ayı değerlendir',
    }
  }
  return null
}

// Defterde üst üste duran sayfaların kâğıt dokusu birbirinden farklı olsun
function paperSeed(page) {
  if (page.kind === 'day') return page.dayId
  if ('weekId' in page) return 1_000_000 + page.weekId * 2 + (page.kind === 'review' ? 1 : 0)
  if (page.kind === 'page') return 2_000_000 + page.ref
  if (page.kind === 'board') return 4_000_000 + page.ref
  return 3_000_000 + page.ref * 2 + (page.kind === 'month-review' ? 1 : 0)
}

// Defterin bir sayfası (bir gün ya da haftanın hedefler / değerlendirme sayfası)
export function NotebookPage({
  page,
  isCurrent = true,
  onLockChange,
  reading = false,
  onReadingChange,
  filtering = false,
  onFilterPress,
  onCalendarPress,
  onSearchPress,
  paper = 'oxford',
  pen = DEFAULT_PEN,
  onPenChange,
  folio,
  autoStart = false,
  onReady,
  onAddPage,
  onDeletePage,
}) {
  const insets = useSafeAreaInsets()
  // PDF defterinde sayfa belge modunda çizilir: düz beyaz sayfa, basılı yazı, Markdown bloklar ve
  // biçim düğmeleri (bkz. DocumentMode)
  const docPaper = isDocumentPaper(paper) ? paper : null
  const { width: windowWidth } = useWindowDimensions()
  const [docNotice, setDocNotice] = useState(null)
  const rawMarkdown = useRawMarkdown()
  const documentMode = useMemo(
    () => (docPaper ? { paper: docPaper, notify: setDocNotice, rawMarkdown } : null),
    [docPaper, rawMarkdown],
  )
  // Sayfa en az kâğıdın (A4 / Letter) oranı kadar boyludur; yazı uzarsa sayfa da uzar
  const sheetMinHeight = docPaper ? windowWidth * DOCUMENT_PAPERS[docPaper].ratio : 0
  const clipboardHasText = useClipboardHasText(docPaper !== null && isCurrent)
  const scrollRef = useAnimatedRef()
  const scrollY = useScrollOffset(scrollRef)
  // Kaydırma alanının görünen yüksekliği ve içeriğinin yüksekliği (seçim alanı kenara dayanınca
  // sayfa kendiliğinden kayar)
  const viewportHeight = useSharedValue(0)
  const contentHeight = useSharedValue(0)
  const [heading, setHeading] = useState(null)
  const [favorite, setFavoriteState] = useState(false)
  const [notes, setNotes] = useState([])
  const [loaded, setLoaded] = useState(false)
  const notesRef = useRef([])
  // Bölünmekte olan blokların id'leri: yeni blok veritabanında açılırken aynı blok bir daha
  // bölünmesin
  const splitting = useRef(new Set())
  const active = useRef(null)
  const selection = useRef(null)
  const [focusRequest, setFocusRequest] = useState(null)
  const [ruledHeight, setRuledHeight] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  // Sağdan açılan sayfa ayarları
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Saati elle ayarlanan blok (sayfa boşsa henüz yok), menü açılırken kenarındaki saat ve menü
  // kapanınca imlecin döneceği yer
  const [timeEdit, setTimeEdit] = useState(null)
  const [clipboardHasImage, checkClipboard] = useClipboardHasImage()
  // Sesle yazılanın gireceği yer: imlecin önündeki ve arkasındaki yazı sabit kalır, arası söylenenlerle dolar
  const dictationTarget = useRef(null)
  const dictation = useDictation({
    onTranscript: (text) => writeDictation(text),
    onEnd: () => finishDictation(),
    onError: (message) => Alert.alert('Sesle yazma', message),
  })
  const keyboardVisible = useKeyboardVisible()
  const bottomInset = keyboardVisible ? 0 : insets.bottom
  // Düzenleme modundaki resim (dosya adı) ve tam ekranda gezilen resimler
  const [editingImage, setEditingImage] = useState(null)
  const [viewer, setViewer] = useState(null)
  // Sayfadaki resimlerin görünümleri ve tam ekran açılırken ölçülen yerleri (dosya adıyla)
  const imageAnchors = useRef(new Map())
  const imageOrigins = useRef(new Map())
  const viewerProgress = useSharedValue(0)
  const blurTarget = useRef(null)
  // Son kez resme/tutamaçlarına ne zaman dokunulduğu
  const imageTouchAt = useRef(0)
  // Saatinden tutulup sürüklenen not (sırası) ve kutusundan tutulup sürüklenen bir satır var mı;
  // sürüklerken sayfa kaymaz, çevrilmez
  const [draggedNote, setDraggedNote] = useState(null)
  const [lineDragging, setLineDragging] = useState(false)
  const dragging = draggedNote !== null || lineDragging
  // Notların sayfadaki yerleri (not kimliği → yer); sürüklenen notun gireceği sıra bunlardan bulunur
  const noteLayouts = useRef(new Map())
  const noteOrder = useReorder({
    onMove: (from, to) => moveNote(from, to),
    onDragChange: setDraggedNote,
  })
  // Blok seçimi: açıkken sayfa yazılmaz; bloklar dokunarak ya da kesik çizgili alan çekilerek
  // seçilir, kopyalanır, kesilir, çoğaltılır, silinir ya da panodakiler yapıştırılır
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // Seçili bloklar, sayfadaki sırasıyla (seçim katmanı için)
  const selectedMask = useSharedValue([])
  // Az önce yapılan işin alt çubukta kısa süre görünen haberi
  const [notice, setNotice] = useState(null)
  // Seçili bloklarla bir iş sürüyorsa (ekler kopyalanırken) ikinci basış yok sayılır
  const blockBusy = useRef(false)
  const clipboardBlocks = useClipboardBlocks()
  const pasteSpot = useRef(null)
  // Çizim modu: açıkken sayfa yazılmaz, kaymaz, çevrilmez; dokunuşlar çizim araçlarına gider.
  // Sayfa (kâğıt, başlık, yazılar ve çizim) kameranın büyüttüğü ve kaydırdığı kadar görünür.
  const [drawing, setDrawing] = useState(false)
  const [drawTool, setDrawTool] = useState(lastDrawing.tool)
  const [drawPen, setDrawPen] = useState(lastDrawing.pen)
  const pageDrawing = usePageDrawing(page)
  const liveStroke = useLiveStroke()
  // Çizimde seçili çizgiler: ayrı katmanda çizilir, sürüklenince o katman kayar
  const [liftedStrokes, setLiftedStrokes] = useState(() => new Set())
  const { camera, style: zoomStyle } = useCamera()
  // Kaydırma alanının büyümemiş sayfadaki sol üst köşesi (çizim katmanı ekrandaki noktaları
  // kaydırılan içeriğe bununla çevirir)
  const deskRef = useRef(null)
  const scrollBoxRef = useRef(null)
  const scrollOrigin = useSharedValue({ x: 0, y: 0 })

  function updateNoteExtents() {
    noteOrder.extents.set(notesRef.current.map((n) => noteLayouts.current.get(n.id) ?? { top: 0, height: 0 }))
  }

  // Resim ele alınınca defter hafifçe küçülüp uzaklaşır
  const recedeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(viewerProgress.get(), [0, 1], [1, 0.92]) }],
    borderRadius: interpolate(viewerProgress.get(), [0, 1], [0, 18]),
  }))

  useEffect(() => {
    notesRef.current = notes
    updateNoteExtents()
  })

  useEffect(() => {
    selectedMask.set(notes.map((n) => selectedIds.has(n.id)))
  }, [notes, selectedIds, selectedMask])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (docNotice === null) return
    const timer = setTimeout(() => setDocNotice(null), 3200)
    return () => clearTimeout(timer)
  }, [docNotice])

  // Pano notuna ayraç konmaz
  const canFavorite = page.kind !== 'board'
  const canTitle = page.kind === 'page' || page.kind === 'board'

  async function createAndShowNote() {
    const note = await createNote(page)
    if (!note) return null
    notesRef.current = [...notesRef.current, note]
    setNotes((prev) => [...prev, note])
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
    return note
  }

  // Boş sayfanın çizgili ilk satırına dokununca ilk blok açılır
  async function addNote() {
    setEditingImage(null)
    const note = await createAndShowNote()
    if (note) setFocusRequest({ noteId: note.id, segment: 0 })
  }

  // Son bloğun altındaki boş kâğıda dokununca en alta yeni bir blok açılır, imleç ona geçer. Son
  // blok zaten boşsa yenisi açılmaz, imleç ona geçer. Resim düzenlenirken dokunuş yalnızca
  // düzenlemeyi kapatır; okurken ya da sayfa yüklenmeden yeni blok açılmaz.
  const addingBelow = useRef(false)

  async function tapBelowBlocks() {
    pasteSpot.current = 'end'
    if (editingImage !== null) {
      Keyboard.dismiss()
      setEditingImage(null)
      return
    }
    if (reading || selecting || !heading || addingBelow.current) {
      Keyboard.dismiss()
      return
    }
    const last = notesRef.current[notesRef.current.length - 1]
    if (last && last.content === '') {
      active.current = { noteId: last.id, segment: 0, cursor: 0 }
      setFocusRequest({ noteId: last.id, segment: 0, cursor: 0 })
      return
    }
    addingBelow.current = true
    await addNote().finally(() => {
      addingBelow.current = false
    })
  }

  // Başlıkta Enter'a basılınca sayfanın ilk satırında blok açılır, imleç ona geçer. Sayfa boşsa ilk
  // blok açılır; ilk blok zaten boşsa yenisi açılmaz, imleç ona geçer.
  async function openFirstBlock() {
    if (reading || selecting || !heading || addingBelow.current) return
    setEditingImage(null)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
    const first = notesRef.current[0]
    if (first && first.content === '') {
      active.current = { noteId: first.id, segment: 0, cursor: 0 }
      setFocusRequest({ noteId: first.id, segment: 0, cursor: 0 })
      return
    }
    addingBelow.current = true
    try {
      const note = await createNote(page)
      if (!note) return
      const next = [note, ...notesRef.current]
      notesRef.current = next
      setNotes(next)
      setNoteOrder(
        page,
        next.map((n) => n.id),
      )
      active.current = { noteId: note.id, segment: 0, cursor: 0 }
      setFocusRequest({ noteId: note.id, segment: 0, cursor: 0 })
    } finally {
      addingBelow.current = false
    }
  }

  // autoStart: boş açılan sayfada yazmaya hemen başlanır
  const startWriting = useEffectEvent(() => {
    if (autoStart && !reading) addNote()
  })

  useEffect(() => {
    let cancelled = false
    deleteEmptyNotes(page)
      .then(() =>
        Promise.all([
          loadHeading(page),
          getPageNotes(page),
          page.kind === 'board' ? false : isFavorite(page),
        ]),
      )
      .then(([h, n, f]) => {
        if (cancelled) return
        // PDF'in sayfasının altında kâğıdın boyutu yazar
        setHeading(
          h && docPaper && page.kind === 'page'
            ? { ...h, meta: `Sayfa ${page.ref} · ${DOCUMENT_PAPERS[docPaper].name}` }
            : h,
        )
        setNotes(n)
        setFavoriteState(f)
        setLoaded(true)
        if (h && n.length === 0) startWriting()
      })
      // Sunucuya ulaşılamazsa sayfa boş kâğıt olarak kalır; defter ekranının loader'ı süre dolunca kalkar
      .catch(() => {})
    return () => {
      cancelled = true
      // Yazılmadan bırakılan boş notlar sayfadan çıkınca silinir
      deleteEmptyNotes(page).catch(() => {})
    }
  }, [page, docPaper])

  const notifyReady = useEffectEvent(() => onReady?.())

  useEffect(() => {
    if (loaded) notifyReady()
  }, [loaded])

  // Saatin konacağı blok: imlecin olduğu blok, hiçbir bloğa dokunulmadıysa sayfanın son bloğu
  function timeTargetNote() {
    const activeId = active.current?.noteId
    return notesRef.current.find((n) => n.id === activeId) ?? notesRef.current[notesRef.current.length - 1]
  }

  // Sayfa boşsa saatli ilk blok açılır
  async function timeTargetOrNew() {
    const note = timeTargetNote()
    if (note) return note
    const created = await createAndShowNote()
    if (created) setFocusRequest({ noteId: created.id, segment: 0 })
    return created
  }

  // Kenarda görünen saat: bloğun saati, yoksa blok kutulu bir satırla başlıyorsa o satırın saati
  function shownTime(note) {
    return note.time ?? parseMarks(note.times).find((m) => m.start === 0)?.color ?? null
  }

  // Bloğun saati kalkar, kenarda yeniden çizgi olur (ilk kutulu satırın saati de gider)
  function withoutTime(note) {
    return {
      ...note,
      time: null,
      times: serializeMarks(parseMarks(note.times).filter((m) => m.start !== 0)),
    }
  }

  // Saat: imlecin olduğu bloğun çizgisi yerine o anki saat gelir; saati varsa yeniden çizgi olur.
  // Hiçbir bloğa dokunulmadıysa sayfanın son bloğuna konur, sayfa boşsa saatli ilk blok açılır.
  async function toggleTime() {
    setEditingImage(null)
    const note = await timeTargetOrNew()
    if (!note) return
    saveNote(shownTime(note) ? withoutTime(note) : { ...note, time: clockTime() })
  }

  // Saat ayarı: saati düğmeyle aynı bloğa, ama elle seçilerek yazılır; bloğun saati varsa menü
  // onunla açılır. Saati kaldırmak saat düğmesinin işidir. Sayfa boşsa blok menü kapanınca açılır.
  function openTimeMenu() {
    setMenuOpen(false)
    setEditingImage(null)
    const note = timeTargetNote()
    // Klavye kâğıdın önünde kalmasın; saat yazılınca imleç kaldığı yere döner
    const refocus = keyboardVisible ? active.current : null
    Keyboard.dismiss()
    setTimeEdit({ noteId: note?.id ?? null, time: note ? shownTime(note) : null, refocus })
  }

  // Menü kapandı: ayarlanan saat bloğa yazılır, imleç kaldığı yere döner
  async function saveEditedTime(time) {
    const edit = timeEdit
    setTimeEdit(null)
    if (!edit) return
    const note = notesRef.current.find((n) => n.id === edit.noteId) ?? (await timeTargetOrNew())
    if (!note) return
    saveNote({ ...note, time })
    if (edit.refocus?.noteId === note.id) setFocusRequest({ ...edit.refocus })
  }

  // Enter: blok imlecin olduğu yerden ikiye bölünür. Arkası (ekleriyle, boyası ve rengiyle) hemen
  // altına açılan çizgili yeni bloğa geçer; liste maddesindeyse yeni blok maddenin işaretiyle başlar.
  // (try/finally yerine .finally: React Compiler catch'siz try bloğu olan bileşeni derlemez)
  async function splitNote(noteId, segment, at, prefix) {
    if (splitting.current.has(noteId)) return
    splitting.current.add(noteId)
    await splitNoteNow(noteId, segment, at, prefix).finally(() => {
      splitting.current.delete(noteId)
    })
  }

  async function splitNoteNow(noteId, segment, at, prefix) {
    const note = notesRef.current.find((n) => n.id === noteId)
    if (!note) return
    endDictationHere()
    const offset = serializeContent(parseContent(note.content).slice(0, segment)).length + at
    const length = note.content.length
    const head = (json) => serializeMarks(marksIn(parseMarks(json), 0, offset))
    const tail = (json) =>
      serializeMarks(
        marksIn(parseMarks(json), offset, length).map((m) => ({
          ...m,
          start: m.start + prefix.length,
          end: m.end + prefix.length,
        })),
      )

    saveNote({
      ...note,
      content: note.content.slice(0, offset),
      highlights: head(note.highlights),
      inks: head(note.inks),
      times: head(note.times),
    })

    const created = await createNote(page)
    if (!created) return
    // Yeni bloğa geçen resimler satırlarını bırakır, yeni blokta eklendikleri yerden başlar
    const fresh = withImages(
      {
        ...created,
        content: prefix + note.content.slice(offset),
        highlights: tail(note.highlights),
        inks: tail(note.inks),
        times: tail(note.times),
        time: null,
      },
      (image) => (image.row === undefined ? image : { ...image, row: undefined }),
    )
    const index = notesRef.current.findIndex((n) => n.id === noteId)
    const next = [...notesRef.current.slice(0, index + 1), fresh, ...notesRef.current.slice(index + 1)]
    notesRef.current = next
    setNotes(next)
    updateNote(page, fresh.id, fresh.content, fresh.highlights, fresh.inks, fresh.times, null)
    setNoteOrder(
      page,
      next.map((n) => n.id),
    )
    active.current = { noteId: fresh.id, segment: 0, cursor: prefix.length }
    setFocusRequest({ noteId: fresh.id, segment: 0, cursor: prefix.length })
  }

  // Bloğun en başında geri silme: blok bir üstteki bloğun sonuna eklenir, kendisi kalkar; imleç
  // birleştikleri yerde durur. Bloğun saati üstteki bloğunkine bırakılır.
  function mergeBack(noteId) {
    const index = notesRef.current.findIndex((n) => n.id === noteId)
    if (index <= 0) return
    endDictationHere()
    const prev = notesRef.current[index - 1]
    // Alttaki bloğun resimleri birleşince üstteki bloğun satırları kadar aşağıda kalır
    const prevLines = Math.round((noteLayouts.current.get(prev.id)?.height ?? 0) / notebook.lineHeight)
    const note = withImages(notesRef.current[index], (image) =>
      image.row === undefined ? image : { ...image, row: image.row + prevLines },
    )
    const at = prev.content.length
    const join = (a, b) =>
      serializeMarks([
        ...parseMarks(a),
        ...parseMarks(b).map((m) => ({ ...m, start: m.start + at, end: m.end + at })),
      ])
    const prevSegments = parseContent(prev.content)
    const last = prevSegments[prevSegments.length - 1]
    const cursor = last?.type === 'text' ? last.text.length : 0

    saveNote({
      ...prev,
      content: prev.content + note.content,
      highlights: join(prev.highlights, note.highlights),
      inks: join(prev.inks, note.inks),
      times: join(prev.times, note.times),
    })
    notesRef.current = notesRef.current.filter((n) => n.id !== note.id)
    setNotes((list) => list.filter((n) => n.id !== note.id))
    deleteNote(page, note.id)
    const segment = prevSegments.length - 1
    active.current = { noteId: prev.id, segment, cursor }
    setFocusRequest({ noteId: prev.id, segment, cursor })
  }

  // Bloğun resimlerinin yerini değiştirir. Resimler tek tek değiştirilir: her adımda içerikte tek bir
  // yer değiştiği için boyalar, yazı renkleri ve kutulu satırların saatleri doğru kayar
  function withImages(note, change) {
    let current = note
    parseContent(note.content).forEach((segment, i) => {
      if (segment.type !== 'image') return
      const next = change(segment)
      if (next === segment) return
      const segments = parseContent(current.content)
      segments[i] = next
      const content = serializeContent(segments)
      current = {
        ...current,
        content,
        highlights: serializeMarks(shiftMarks(parseMarks(current.highlights), current.content, content)),
        inks: serializeMarks(shiftMarks(parseMarks(current.inks), current.content, content)),
        times: serializeMarks(shiftBoxTimes(parseMarks(current.times), current.content, content)),
      }
    })
    return current
  }

  function saveNote(note) {
    const change = (n) => (n.id === note.id ? note : n)
    notesRef.current = notesRef.current.map(change)
    setNotes((prev) => prev.map(change))
    updateNote(page, note.id, note.content, note.highlights, note.inks, note.times, note.time)
  }

  // Yazı değişince fosforlu kalemin boyası, yazının rengi ve kutulu satırların saatleri de yazıyla
  // birlikte kayar; yeni yazılan yazı elde tutulan kalemin renginde olur
  function changeNote(noteId, content) {
    const note = notesRef.current.find((n) => n.id === noteId)
    if (!note) return
    // Seçili yazının üstüne yazılırsa kalem o yazıdan geçmemiş sayılır
    if (selection.current?.noteId === noteId) selection.current = null
    saveNote({
      ...note,
      content,
      highlights: serializeMarks(shiftMarks(parseMarks(note.highlights), note.content, content)),
      inks: serializeMarks(inkText(parseMarks(note.inks), note.content, content, pen.ink)),
      times: serializeMarks(shiftBoxTimes(parseMarks(note.times), note.content, content)),
    })
  }

  // Fosforlu kalem açıkken yazı seçilip bırakıldı: kalem oradan geçmiş olur (bkz. lib/marks
  // paintHighlight; baştan sona aynı renkle boyalı yer silinir)
  function strokeNote(noteId, start, end, color) {
    const note = notesRef.current.find((n) => n.id === noteId)
    if (!note) return
    const highlights = paintHighlight(parseMarks(note.highlights), start, end, color)
    saveNote({ ...note, highlights: serializeMarks(highlights) })
  }

  // Yazı seçildi ya da seçim değişti; start === end ise seçim bırakıldı
  function selectText(noteId, start, end) {
    // Kalem menüsü açıkken yazı alanının odağı gidebilir; seçim, menüden renk seçilene kadar durur
    if (colorMenuOpen) return
    // Bir yerde imleç tek noktaya indiyse sayfada seçili yazı kalmamıştır; seçim başka bir
    // nottaysa da (ör. menü açıkken odağı gidip orada kaldıysa) bırakılır
    if (start === end) {
      releaseSelection(selection.current?.noteId ?? noteId)
      return
    }
    const prev = selection.current
    if (prev?.noteId === noteId && prev.start === start && prev.end === end) return
    selection.current = { noteId, start, end, applied: false }
  }

  // Seçim bırakıldı (imleç tek noktaya indi ya da yazıdan çıkıldı): fosforlu kalem açıkken
  // seçilen yer, kalemin geçtiği yerdir; seçime kalem zaten değdiyse yeniden boyanmaz
  function releaseSelection(noteId) {
    if (colorMenuOpen) return
    const done = selection.current
    if (!done || done.noteId !== noteId) return
    selection.current = null
    if (!done.applied && pen.active) strokeNote(noteId, done.start, done.end, pen.color)
  }

  // Elde tutulan kalem değişti. Yazı seçiliyse seçim o anda etkilenir: keçeli kalem açılınca ya da
  // menüden fosforlu kalem seçilince seçim o renge boyanır, yazı kalemi seçilince yazının rengi
  // değişir. Seçim ekranda kalır; başka bir renk seçilirse o da aynı yere uygulanır.
  function changePen(next, how) {
    onPenChange?.(next)
    const target = selection.current
    const note = target && notesRef.current.find((n) => n.id === target.noteId)
    if (!target || !note) return
    target.applied = true
    const { start, end } = target
    if (how === 'button') {
      // Düğmeyle açılan kalem seçimin üstünden bir kez geçer; kapatılırsa seçim boyanmaz
      if (next.active) strokeNote(note.id, start, end, next.color)
      return
    }
    if (next.active) {
      const highlights = setHighlight(parseMarks(note.highlights), start, end, next.color)
      saveNote({ ...note, highlights: serializeMarks(highlights) })
    } else {
      const inks = setInk(parseMarks(note.inks), start, end, next.ink)
      saveNote({ ...note, inks: serializeMarks(inks) })
    }
  }

  // Saatinden tutulup sürüklenen not, sayfadaki notlar arasında yeni yerine geçer
  function moveNote(from, to) {
    const next = lineOrder(notesRef.current.length, from, to).map((i) => notesRef.current[i])
    notesRef.current = next
    setNotes(next)
    setNoteOrder(
      page,
      next.map((n) => n.id),
    )
  }

  // Kutulu satır, kutusundan ya da saatinden tutulup notun yazısında yukarı aşağı taşındı; boyası,
  // kalem rengi ve saati satırla birlikte gider
  function moveNoteLine(noteId, segment, from, to) {
    const note = notesRef.current.find((n) => n.id === noteId)
    if (!note) return
    const segments = parseContent(note.content)
    const text = segments[segment]
    if (text?.type !== 'text') return
    const at = serializeContent(segments.slice(0, segment)).length
    const moved = moveLine(text.text, from, to)
    saveNote({
      ...note,
      content: serializeContent(segments.map((s, i) => (i === segment ? { ...text, text: moved } : s))),
      highlights: serializeMarks(moveLineMarks(parseMarks(note.highlights), at, text.text, from, to)),
      inks: serializeMarks(moveLineMarks(parseMarks(note.inks), at, text.text, from, to)),
      times: serializeMarks(moveLineMarks(parseMarks(note.times), at, text.text, from, to)),
    })
    active.current = null
  }

  // Sesle yazmak için açılan blok, hiçbir şey söylenmediyse kalkar
  function dropIfEmpty(note) {
    // Sesle yazılmayı bekleyen boş not silinmez
    if (dictationTarget.current?.noteId === note.id) return
    if (note.content.trim() === '') {
      notesRef.current = notesRef.current.filter((n) => n.id !== note.id)
      setNotes((prev) => prev.filter((n) => n.id !== note.id))
      deleteNote(page, note.id)
    }
  }

  // İmlecin son durduğu yazı bölümü; yazılan bir yer yoksa yeni not açılır
  async function cursorTarget() {
    let target = active.current
    let note = target && notesRef.current.find((n) => n.id === target.noteId)
    if (!note || !target) {
      note = await createAndShowNote()
      if (!note) return null
      target = { noteId: note.id, segment: 0, cursor: 0 }
    }

    const segments = parseContent(note.content)
    const textSegment = segments[target.segment]
    // Konum artık geçerli değilse notun sonu
    const index = textSegment?.type === 'text' ? target.segment : segments.length - 1
    const text = segments[index]
    const cursor = text.type === 'text' ? Math.min(target.cursor, text.text.length) : 0
    return { note, segments, index, cursor }
  }

  // Eki imlecin son durduğu yere koyar
  async function attach(source) {
    setMenuOpen(false)
    setEditingImage(null)
    endDictationHere()
    const picked = await source().catch(() => null)
    if (!picked) return
    // PDF'te resim kâğıda düz basılır, el yapıştırması gibi yamuk durmaz
    const attachment = docPaper && picked.type === 'image' ? { ...picked, rotation: 0 } : picked

    const at = await cursorTarget()
    if (!at) return
    const { note, segments, index, cursor } = at
    changeNote(note.id, serializeContent(insertAttachment(segments, index, cursor, attachment)))
    // Ekin altındaki satırdan yazmaya devam et
    active.current = { noteId: note.id, segment: index + 2, cursor: 0 }
    setFocusRequest({ noteId: note.id, segment: index + 2 })
  }

  // Kutu / numara: imlecin olduğu satırın başına işaret koyar ya da kaldırır
  async function toggleLine(toggle) {
    setMenuOpen(false)
    setEditingImage(null)
    endDictationHere()

    const at = await cursorTarget()
    if (!at) return
    const { note, segments, index, cursor } = at
    const text = segments[index]
    if (text.type !== 'text') return
    const edit = toggle(text.text, cursor)
    changeNote(
      note.id,
      serializeContent(segments.map((s, i) => (i === index ? { ...text, text: edit.text } : s))),
    )
    active.current = { noteId: note.id, segment: index, cursor: edit.cursor }
    setFocusRequest({ noteId: note.id, segment: index, cursor: edit.cursor })
  }

  // PDF'te biçim düğmeleri: imlecin olduğu yazı bölümüne (yazı seçiliyse seçime) uygulanır;
  // ardından imleç ya da seçim yazıda kalır
  // keepFocus: false ise yazma kapanır, blok hemen biçimli görünür (ör. biçimli yapıştırmadan sonra)
  async function editMarkdown(apply, keepFocus = true) {
    setMenuOpen(false)
    setEditingImage(null)
    endDictationHere()

    const picked = selection.current
    const at = await cursorTarget()
    if (!at) return
    const { note, segments, index, cursor } = at
    const text = segments[index]
    if (text.type !== 'text') return
    const offset = serializeContent(segments.slice(0, index)).length
    let start = cursor
    let end = cursor
    if (picked?.noteId === note.id && picked.start >= offset && picked.end <= offset + text.text.length) {
      start = picked.start - offset
      end = picked.end - offset
    }
    const edit = apply(text.text, start, end)
    changeNote(
      note.id,
      serializeContent(segments.map((s, i) => (i === index ? { ...text, text: edit.text } : s))),
    )
    active.current = { noteId: note.id, segment: index, cursor: edit.end }
    if (keepFocus) {
      setFocusRequest({ noteId: note.id, segment: index, cursor: edit.start, end: edit.end })
    } else {
      Keyboard.dismiss()
    }
  }

  function formatInline(format) {
    editMarkdown((text, start, end) => toggleInline(text, start, end, format))
  }

  function formatLines(format) {
    editMarkdown((text, start, end) => toggleLines(text, start, end, format))
  }

  // Panodaki zengin metin Markdown'a çevrilip imlecin yerine (seçim varsa onun yerine) girer
  async function pasteMarkdown(result) {
    if (!result || result.text.trim() === '') {
      setDocNotice('Panoda yapıştırılacak yazı yok')
      return
    }
    // Biçimli yazı hemen biçimli görünür; panoda biçim yoksa düz metin girer, yazmaya devam edilir
    await editMarkdown((text, start, end) => {
      const before = text.slice(0, start)
      const after = text.slice(end)
      const inserted = padForInsertion(result.text, before, after)
      const caret = start + inserted.length
      return { text: before + inserted + after, start: caret, end: caret }
    }, !result.rich)
    setDocNotice(
      result.missingLinks > 0
        ? missingLinksNotice(result.missingLinks)
        : result.rich
          ? 'Biçimli metin olarak yapıştırıldı'
          : 'Panoda biçimli metin yok, düz metin olarak eklendi',
    )
  }

  async function pasteFromClipboard() {
    await pasteMarkdown(await readClipboardMarkdown())
  }

  // Mikrofon: söylenenler imlecin olduğu yere, konuşuldukça yazılır
  async function toggleDictation() {
    if (dictation.listening) {
      dictation.stop()
      return
    }
    setMenuOpen(false)
    setEditingImage(null)

    const at = await cursorTarget()
    if (!at) return
    const text = at.segments[at.index]
    if (text.type !== 'text') return
    dictationTarget.current = {
      noteId: at.note.id,
      segment: at.index,
      before: text.text.slice(0, at.cursor),
      after: text.text.slice(at.cursor),
    }
    Keyboard.dismiss()
    if (!(await dictation.start())) finishDictation()
  }

  function writeDictation(spoken) {
    const target = dictationTarget.current
    const note = target && notesRef.current.find((n) => n.id === target.noteId)
    if (!target || !note) return

    const { segment, before, after } = target
    // Söylenenler yanındaki yazıya yapışmasın
    const lead = spoken && before && !/\s$/.test(before) ? ' ' : ''
    const trail = spoken && after && !/^\s/.test(after) ? ' ' : ''
    const segments = parseContent(note.content).map((s, i) =>
      i === segment && s.type === 'text' ? { ...s, text: before + lead + spoken + trail + after } : s,
    )
    changeNote(note.id, serializeContent(segments))
    // Sonraki ek ya da dikte söylenenlerin arkasına gelsin
    active.current = { noteId: note.id, segment, cursor: before.length + lead.length + spoken.length }
  }

  // Dinleme bitti: hiçbir şey söylenmediyse yeni açılan boş not kalkar
  function finishDictation() {
    const target = dictationTarget.current
    dictationTarget.current = null
    const note = target && notesRef.current.find((n) => n.id === target.noteId)
    if (note) dropIfEmpty(note)
  }

  // Not elle değiştirilirse sesle yazma o noktada bırakılır, söylenenler yerinde kalır
  function endDictationHere() {
    if (!dictationTarget.current) return
    dictationTarget.current = null
    dictation.cancel()
  }

  // Yazı alanında basılı tutup "Yapıştır"a basınca panodaki resim imlecin olduğu yere girer
  const onPasteImage = useEffectEvent((image) => {
    attach(() => importPastedImage(image))
  })

  useEffect(() => {
    if (!isCurrent) return
    return addImagePasteListener((image) => onPasteImage(image))
  }, [isCurrent])

  // Sayfa çevrilince bu sayfada yarım kalan iş kapanır; söylenenler yerinde kalır
  const [wasCurrent, setWasCurrent] = useState(isCurrent)
  if (wasCurrent !== isCurrent) {
    setWasCurrent(isCurrent)
    if (!isCurrent) {
      setMenuOpen(false)
      setColorMenuOpen(false)
      setSettingsOpen(false)
      setTimeEdit(null)
      setEditingImage(null)
      setViewer(null)
      setSelecting(false)
      setSelectedIds(new Set())
      setDrawing(false)
    }
  }

  // Çevrilen sayfa büyümüş kaldıysa yerine döner. Paylaşılan değerlere çizim sırasında
  // dokunulmaz (Reanimated uyarır); bu yüzden render'da değil, burada.
  useEffect(() => {
    if (!isCurrent) moveCamera(camera, { k: 1, x: 0, y: 0 }, false)
  }, [isCurrent, camera])

  const leavePage = useEffectEvent(() => {
    if (dictation.listening) dictation.stop()
    Keyboard.dismiss()
  })

  // Okuma moduna geçince de yazma, sesle yazma ve düzenleme kapanır
  const [wasReading, setWasReading] = useState(reading)
  if (wasReading !== reading) {
    setWasReading(reading)
    if (reading) {
      setMenuOpen(false)
      setColorMenuOpen(false)
      setTimeEdit(null)
      setEditingImage(null)
      setSelecting(false)
      setSelectedIds(new Set())
    }
  }

  // Blok seçimi ya da çizim modu açılınca da yazma, sesle yazma ve düzenleme kapanır
  useEffect(() => {
    if (!isCurrent || reading || selecting || drawing) leavePage()
  }, [isCurrent, reading, selecting, drawing])

  // Kaydırma alanının yeri yalnızca sayfa büyümemişken ölçülür (büyümüş sayfada ekrandaki yeri
  // de büyür)
  function measureScrollOrigin() {
    if (camera.k.get() !== 1 || camera.x.get() !== 0 || camera.y.get() !== 0) return
    const desk = deskRef.current
    const box = scrollBoxRef.current
    if (!desk || !box) return
    desk.measureInWindow((dx, dy) => {
      box.measureInWindow((bx, by) => scrollOrigin.set({ x: bx - dx, y: by - dy }))
    })
  }

  // Çizim modu açılınca yazma, menüler, resim düzenleme ve blok seçimi kapanır; kapanınca sayfa
  // büyümüşse yerine döner
  function changeDrawing(next) {
    if (next) {
      setMenuOpen(false)
      setColorMenuOpen(false)
      setTimeEdit(null)
      setEditingImage(null)
      setSelecting(false)
      setSelectedIds(new Set())
      selection.current = null
      endDictationHere()
      Keyboard.dismiss()
      measureScrollOrigin()
    } else {
      moveCamera(camera, { k: 1, x: 0, y: 0 })
    }
    setDrawing(next)
  }

  function changeDrawTool(tool) {
    // Çizim modu her açılışta seçim kapalı başlar
    if (tool !== 'select') lastDrawing.tool = tool
    setDrawTool(tool)
  }

  function changeDrawPen(pen) {
    lastDrawing.pen = pen
    setDrawPen(pen)
    // Renk ya da kalınlık seçilince kalem ele alınır
    changeDrawTool('pen')
  }

  function changeSelecting(next) {
    if (next) {
      setMenuOpen(false)
      setColorMenuOpen(false)
      setTimeEdit(null)
      setEditingImage(null)
      selection.current = null
    }
    setSelecting(next)
    setSelectedIds(new Set())
    setNotice(null)
  }

  // Geri tuşu önce blok seçimini kapatır
  const closeSelecting = useEffectEvent(() => changeSelecting(false))

  useEffect(() => {
    if (!selecting || !isCurrent) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSelecting()
      return true
    })
    return () => sub.remove()
  }, [selecting, isCurrent])

  // Dokunulan bloğun seçimi açılır / kapanır; boş kâğıda dokununca seçim temizlenir
  function tapBlock(index) {
    const note = notesRef.current[index]
    if (!note) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(note.id)) next.delete(note.id)
      else next.add(note.id)
      return next
    })
  }

  function sweepBlocks(indices) {
    setSelectedIds(new Set(indices.flatMap((i) => (notesRef.current[i] ? [notesRef.current[i].id] : []))))
  }

  function selectedNotes() {
    return notesRef.current.filter((n) => selectedIds.has(n.id))
  }

  // Seçili bloklarla yapılan iş; iş bitene kadar düğmelere yeniden basılması yok sayılır
  async function withBlocks(work) {
    const picked = selectedNotes()
    if (picked.length === 0 || blockBusy.current) return
    blockBusy.current = true
    await work(picked).finally(() => {
      blockBusy.current = false
    })
  }

  // Bloklar uygulamanın panosuna, düz yazıları telefonun panosuna kopyalanır (başka uygulamalara
  // yapıştırılabilsin)
  async function copyToClipboard(picked) {
    const blocks = picked.map(blockOf)
    await putOnClipboard(blocks)
    const text = blocksText(blocks)
    if (text.trim() !== '') Clipboard.setStringAsync(text).catch(() => {})
  }

  // Kopyalanınca ya da kesilince seçim kapanır; bloklar üst çubuktaki yapıştır düğmesiyle başka bir
  // yere (bu ya da başka bir sayfaya) yapıştırılır
  function copySelection() {
    withBlocks(async (picked) => {
      await copyToClipboard(picked)
      changeSelecting(false)
    })
  }

  function cutSelection() {
    withBlocks(async (picked) => {
      await copyToClipboard(picked)
      removeNotes(picked)
      changeSelecting(false)
    })
  }

  function deleteSelection() {
    const picked = selectedNotes()
    if (picked.length === 0) return
    Alert.alert(
      'Blokları sil',
      picked.length === 1
        ? 'Seçili blok sayfadan silinsin mi?'
        : `Seçili ${picked.length} blok sayfadan silinsin mi?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            removeNotes(picked)
            setNotice('silindi')
          },
        },
      ],
    )
  }

  // Kopyaları seçili blokların hemen altına gelir; seçim kopyalara geçer
  function duplicateSelection() {
    withBlocks(async (picked) => {
      const blocks = await Promise.all(picked.map((n) => withCopiedFiles(blockOf(n))))
      const created = await insertBlocks(blocks, (list) => afterIndex(list, picked[picked.length - 1].id))
      setSelectedIds(new Set(created.map((n) => n.id)))
      setNotice('çoğaltıldı')
    })
  }

  function confirmClearClipboard() {
    Alert.alert('Panoyu boşalt', 'Kopyalanan bloklar panodan silinsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Boşalt', style: 'destructive', onPress: clearClipboard },
    ])
  }

  // Panodaki bloklar yapıştırılır. Blok seçimi açıksa seçili blokların yerine (seçili blok yoksa
  // sayfanın sonuna) gelir, seçim yapıştırılanlara geçer. Seçim kapalıysa en son dokunulan yere
  // gelir: yazının içindeyse blok imlecin olduğu yerden ikiye bölünür, araya girer; boş bir bloğa
  // dokunulduysa onun yerine geçer; boş kâğıda dokunulduysa ya da sayfaya hiç dokunulmadıysa
  // sayfanın sonuna eklenir.
  async function pasteBlocks() {
    if (blockBusy.current) return
    blockBusy.current = true
    await pasteNow().finally(() => {
      blockBusy.current = false
    })
  }

  async function pasteNow() {
    endDictationHere()
    setMenuOpen(false)
    setEditingImage(null)
    Keyboard.dismiss()
    const blocks = takeFromClipboard()
    if (blocks.length === 0) return

    if (selecting) {
      const picked = selectedNotes()
      const created = await insertBlocks(blocks, (list) =>
        picked.length > 0 ? indexOrEnd(list, picked[0].id) : list.length,
      )
      if (picked.length > 0) removeNotes(picked)
      else scrollToEndSoon()
      setSelectedIds(new Set(created.map((n) => n.id)))
      setNotice('yapıştırıldı')
      return
    }

    const spot = pasteSpot.current
    if (spot === null || spot === 'end') {
      await insertBlocks(blocks, (list) => list.length)
      scrollToEndSoon()
    } else {
      await pasteAtCursor(blocks, spot)
    }
  }

  async function pasteAtCursor(blocks, spot) {
    const note = notesRef.current.find((n) => n.id === spot.noteId)
    if (!note) {
      scrollToEndSoon()
      return insertBlocks(blocks, (list) => list.length)
    }
    if (note.content.trim() === '') {
      const created = await insertBlocks(blocks, (list) => indexOrEnd(list, note.id))
      removeNotes([note])
      return created
    }
    const segments = parseContent(note.content)
    const text = segments[spot.segment]
    const length = note.content.length
    const offset =
      text?.type === 'text'
        ? serializeContent(segments.slice(0, spot.segment)).length + Math.min(spot.cursor, text.text.length)
        : length
    if (offset === 0) return insertBlocks(blocks, (list) => indexOrEnd(list, note.id))
    if (offset >= length) return insertBlocks(blocks, (list) => afterIndex(list, note.id))

    // Blok imleçten bölünür: önü yerinde kalır, arkası yapıştırılanların altına yeni blok olur
    // (Enter'la bölünmüş gibi: resimleri yeni blokta eklendikleri yerden başlar, saati olmaz)
    const part = (json, from, to) => serializeMarks(marksIn(parseMarks(json), from, to))
    saveNote({
      ...note,
      content: note.content.slice(0, offset),
      highlights: part(note.highlights, 0, offset),
      inks: part(note.inks, 0, offset),
      times: part(note.times, 0, offset),
    })
    const tail = withImages(
      {
        ...note,
        content: note.content.slice(offset),
        highlights: part(note.highlights, offset, length),
        inks: part(note.inks, offset, length),
        times: part(note.times, offset, length),
        time: null,
      },
      (image) => (image.row === undefined ? image : { ...image, row: undefined }),
    )
    const created = await insertBlocks([...blocks, blockOf(tail)], (list) => afterIndex(list, note.id))
    return created.slice(0, blocks.length)
  }

  function scrollToEndSoon() {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
  }

  // Bloklar sayfadan kalkar, ekleri de silinir (panoya alınan blokların ekleri ayrı dosyalardır)
  function removeNotes(picked) {
    const ids = new Set(picked.map((n) => n.id))
    notesRef.current = notesRef.current.filter((n) => !ids.has(n.id))
    setNotes((prev) => prev.filter((n) => !ids.has(n.id)))
    for (const note of picked) {
      deleteNote(page, note.id)
      noteLayouts.current.delete(note.id)
    }
    deleteBlockFiles(picked.map(blockOf))
    if (active.current && ids.has(active.current.noteId)) active.current = null
    const spot = pasteSpot.current
    if (spot && spot !== 'end' && ids.has(spot.noteId)) {
      pasteSpot.current = null
    }
    setSelectedIds(new Set())
  }

  // Bloklar sayfaya yeni bloklar olarak eklenir; place, eklenecekleri sırayı sayfanın o anki
  // bloklarından bulur. Eklenen bloklar döner.
  async function insertBlocks(blocks, place) {
    const created = []
    for (const block of blocks) {
      const note = await createNote(page)
      if (!note) continue
      const full = { ...note, ...block }
      await updateNote(page, full.id, full.content, full.highlights, full.inks, full.times, full.time)
      created.push(full)
    }
    if (created.length === 0) return created
    const list = notesRef.current
    const at = Math.min(list.length, Math.max(0, place(list)))
    const next = [...list.slice(0, at), ...created, ...list.slice(at)]
    notesRef.current = next
    setNotes(next)
    await setNoteOrder(
      page,
      next.map((n) => n.id),
    )
    return created
  }

  // Ayarlar açılırken yazma ve açık menüler kapanır; sesle yazma o noktada bırakılır
  function openSettings() {
    endDictationHere()
    if (dictation.listening) dictation.stop()
    Keyboard.dismiss()
    setMenuOpen(false)
    setColorMenuOpen(false)
    setEditingImage(null)
    setSettingsOpen(true)
  }

  // Sayfadaki bütün bloklar, resimleri ve dosyalarıyla silinir; başlık yerinde kalır
  function clearPage() {
    if (notesRef.current.length === 0 && pageDrawing.strokes.length === 0) return
    Alert.alert(
      'Sayfayı temizle',
      'Sayfadaki bütün yazılar, çizimler, resimler ve dosyalar silinsin mi? Bu geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: () => {
            endDictationHere()
            setSelecting(false)
            removeNotes(notesRef.current)
            pageDrawing.clear()
            selection.current = null
          },
        },
      ],
    )
  }

  // Sayfa bütün yazıları, ekleri, başlığı ve ayracıyla defterden çıkar
  function deletePage() {
    if (!onDeletePage) return
    Alert.alert(
      'Sayfayı sil',
      page.kind === 'board'
        ? 'Bu not bütün yazıları, resimleri ve dosyalarıyla panodan kaldırılsın mı? Bu geri alınamaz.'
        : 'Bu sayfa bütün yazıları, resimleri ve dosyalarıyla defterden çıkarılsın mı? Ardındaki ' +
            'sayfalar birer sayfa geri kayar. Bu geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            endDictationHere()
            setSelecting(false)
            onDeletePage()
          },
        },
      ],
    )
  }

  const pageEmpty = notes.length === 0 && pageDrawing.strokes.length === 0

  const settingsSections = [
    // PDF: yazıya dokununca ham Markdown'ı mı açılsın, yoksa yazı biçimli görünürken mi yazılsın
    ...(docPaper
      ? [
          {
            title: 'Yazı',
            items: [
              {
                label: rawMarkdown ? 'Biçimli yaz' : "Markdown'ı düzenle",
                hint: rawMarkdown
                  ? 'Şu an yazıya dokununca ham Markdown açılıyor; yazı biçimli görünürken yazılsın'
                  : 'Yazıya dokununca ham Markdown açılsın; görseller, tablolar ve kod da düzenlenir',
                icon: 'pencil',
                onPress: () => {
                  Keyboard.dismiss()
                  setRawMarkdown(!rawMarkdown)
                },
              },
            ],
          },
        ]
      : []),
    {
      title: 'Sayfa',
      items: [
        ...(onAddPage
          ? [
              {
                label: 'Sola sayfa ekle',
                hint: 'Bu sayfanın önüne boş bir sayfa',
                icon: 'pageAddLeft',
                onPress: () => onAddPage('left'),
              },
              {
                label: 'Sağa sayfa ekle',
                hint: 'Bu sayfanın ardına boş bir sayfa',
                icon: 'pageAddRight',
                onPress: () => onAddPage('right'),
              },
            ]
          : []),
        {
          label: 'Sayfayı temizle',
          hint: reading
            ? 'Okuma modunda sayfa değişmez'
            : pageEmpty
              ? 'Sayfa zaten boş'
              : 'Bütün yazılar, çizimler ve ekler silinir',
          icon: 'eraser',
          danger: true,
          disabled: reading || pageEmpty,
          onPress: clearPage,
        },
        ...(onDeletePage
          ? [
              {
                label: 'Sayfayı sil',
                hint:
                  page.kind === 'board'
                    ? 'Not panodan kalkar'
                    : 'Sayfa defterden çıkar, ardındakiler geri kayar',
                icon: 'trash',
                danger: true,
                onPress: deletePage,
              },
            ]
          : []),
      ],
    },
  ]

  // Not defterinin sayfasının ve pano notunun başlığı elle yazılır
  function changeTitle(title) {
    if (page.kind !== 'page' && page.kind !== 'board') return
    setHeading((prev) => (prev ? { ...prev, title } : prev))
    if (page.kind === 'page') setPageTitle(page.notebookId, page.ref, title).catch(() => {})
  }

  function toggleFavorite() {
    const next = !favorite
    setFavoriteState(next)
    setFavorite(page, next)
  }

  // Yazarken yana kaydırmak metin seçmeye karışır; sayfa ancak klavye kapalıyken çevrilir
  useEffect(() => {
    onLockChange?.(
      editingImage !== null || viewer !== null || keyboardVisible || dragging || selecting || drawing,
    )
  }, [onLockChange, editingImage, viewer, keyboardVisible, dragging, selecting, drawing])

  const attachOptions = [
    ...(clipboardHasImage
      ? [{ label: 'Panodaki resmi yapıştır', onPress: () => attach(pasteImageFromClipboard) }]
      : []),
    { label: 'Fotoğraf çek', onPress: () => attach(takePhoto) },
    { label: 'Galeriden fotoğraf', onPress: () => attach(pickImageFromLibrary) },
    { label: 'Dosya seç', onPress: () => attach(pickFile) },
  ]

  function editImage(name) {
    Keyboard.dismiss()
    setMenuOpen(false)
    setEditingImage(name)
  }

  // Sayfada herhangi bir yere dokunulunca düzenleme modu kapanır; dokunuş resimdense kapanmaz.
  // Android'de resmin dışına taşan tutamaçları Gesture Handler yakaladığı için o haber biraz
  // gecikebilir; karar bu yüzden kısa bir beklemeden sonra verilir.
  function handlePageTouch() {
    if (editingImage === null) return
    setTimeout(() => {
      if (Date.now() - imageTouchAt.current > 300) setEditingImage(null)
    }, 60)
  }

  function setImageAnchor(name, node) {
    if (node) imageAnchors.current.set(name, node)
    else imageAnchors.current.delete(name)
  }

  // Tam ekranda sayfadaki bütün resimler sırayla gezilir: bloklar yukarıdan aşağı, bir bloğun
  // resimleri bloğa eklendikleri sırayla
  function openImage(name, origin) {
    const images = notesRef.current
      .flatMap((note) => parseContent(note.content))
      .filter((s) => s.type === 'image' && imageAnchors.current.has(s.name))
      .map((s) => ({
        name: s.name,
        uri: attachmentUri(s.name),
        width: s.width,
        height: s.height,
        rotation: s.rotation,
      }))
    const index = images.findIndex((image) => image.name === name)
    if (index < 0) return

    // Yerler defter uzaklaşmadan önce ölçülür; resimler açıkken sayfa kaymadığı için kapanırken de
    // geçerlidir ve hangi resimde kapatılırsa o resim yerine uçar
    const origins = new Map([[name, origin]])
    imageOrigins.current = origins
    for (const image of images) {
      if (image.name === name) continue
      imageAnchors.current
        .get(image.name)
        ?.measureInWindow((x, y, width, height) => origins.set(image.name, { x, y, width, height }))
    }

    setEditingImage(null)
    setViewer({ images, index })
  }

  // Tam ekranda kırpılan resim: kırpılmış hâli yeni bir dosyaya yazılır, nottaki resim ona geçer
  // (satırı, açısı ve yeri aynı kalır), eski dosya silinir. Tam ekrandaki resim de yenilenir;
  // boyu değiştiği için kapanırken defterdeki yerine uçmaz, yerinde kaybolur.
  async function cropViewerImage(name, rect) {
    const holds = (n) => parseContent(n.content).some((s) => s.type === 'image' && s.name === name)
    if (!notesRef.current.some(holds)) return false
    const cropped = await cropAttachmentImage(name, rect)
    const note = notesRef.current.find(holds)
    if (!note) {
      deleteAttachmentFile(cropped.name)
      return false
    }
    saveNote(
      withImages(note, (image) =>
        image.name === name
          ? { ...image, name: cropped.name, width: cropped.width, height: cropped.height }
          : image,
      ),
    )
    deleteAttachmentFile(name)
    imageOrigins.current.delete(name)
    setViewer(
      (v) =>
        v && {
          ...v,
          images: v.images.map((image) =>
            image.name === name
              ? {
                  ...image,
                  name: cropped.name,
                  uri: attachmentUri(cropped.name),
                  width: cropped.width,
                  height: cropped.height,
                }
              : image,
          ),
        },
    )
    return true
  }

  const folioText = folio && (
    <Text style={docPaper ? styles.docFolioText : styles.folioText}>
      {`sf. ${folio.number} / ${folio.total}` + (docPaper ? '' : HAND_TAIL)}
    </Text>
  )

  return (
    <DocumentContext value={documentMode}>
      <View ref={deskRef} style={styles.desk} onTouchStart={handlePageTouch}>
        {/* Android'de bulanıklık yalnızca bu hedefin içindekine uygulanır */}
        <BlurTargetView ref={blurTarget} style={styles.desk}>
          <Animated.View style={[styles.notebook, recedeStyle]}>
            {/* Çizim modunda sayfanın tamamı sol üst köşesinden büyür */}
            <Animated.View style={[styles.zoom, zoomStyle]}>
              <Paper seed={paperSeed(page)} paper={paper}>
                <StatusBar style="dark" />

                <PageTopBar
                  reading={reading}
                  onReadingChange={onReadingChange}
                  favorite={canFavorite ? { on: favorite, onPress: toggleFavorite } : undefined}
                  onCalendarPress={onCalendarPress}
                  onSearchPress={onSearchPress}
                  filtering={filtering}
                  onFilterPress={onFilterPress}
                  selecting={selecting}
                  onSelectingChange={reading ? undefined : changeSelecting}
                  drawing={drawing}
                  onDrawingChange={reading ? undefined : changeDrawing}
                  paste={
                    !reading && clipboardBlocks > 0
                      ? {
                          onPress: pasteBlocks,
                          onLongPress: confirmClearClipboard,
                        }
                      : undefined
                  }
                  onMorePress={openSettings}
                />
                {/* PDF'te başlık kâğıdın üstünde, yazıyla birlikte kayar */}
                {!docPaper && (
                  <PageHeading
                    heading={heading}
                    onTitleChange={canTitle ? changeTitle : undefined}
                    onTitleSubmit={canTitle ? openFirstBlock : undefined}
                    readOnly={reading || selecting || drawing}
                  />
                )}

                {/* Android'de uygulama kenardan kenara çizildiği için klavye pencereyi küçültmez; alt
                boşluk orada da eklenmeli, yoksa kaydırma alanı klavyenin arkasına uzanır ve en alt
                satırlarda yazılan, imleç "görünüyor" sanıldığı için klavyenin altında kalır */}
                <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={isCurrent}>
                  {/* KeyboardAvoidingView klavyenin yerini alt boşlukla (padding) açar; mutlak konumlu
                  çocuklar o boşluğu saymaz, ekranın dibine göre durur. Ataç menüsü klavyenin altında
                  kalmasın diye içerik akışta duran bu kabın içindedir: menü klavyenin üstündeki
                  alana göre yerleşir */}
                  <View ref={scrollBoxRef} style={styles.flex} onLayout={measureScrollOrigin}>
                    <Animated.ScrollView
                      ref={scrollRef}
                      onLayout={(e) => viewportHeight.set(e.nativeEvent.layout.height)}
                      style={styles.flex}
                      contentContainerStyle={styles.scrollContent}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode="interactive"
                      // Resim düzenlenirken tutamaçları, not ya da satır sürüklenirken notu sürüklemek
                      // sayfayı kaydırmasın; blok seçerken parmak kesik çizgili alanı çeker, sayfa alan
                      // kenara dayanınca kayar
                      scrollEnabled={editingImage === null && !dragging && !selecting && !drawing}
                    >
                      <View
                        style={[
                          styles.ruled,
                          docPaper && styles.docRuled,
                          {
                            paddingBottom: docPaper ? docPage.lineHeight * 2 : notebook.lineHeight * 2,
                            // Çizim sayfanın sonundan aşağı taşarsa sayfa onu da içine alacak kadar uzar
                            minHeight: Math.max(strokesBottom(pageDrawing.strokes), sheetMinHeight),
                          },
                        ]}
                        onLayout={(e) => {
                          setRuledHeight(e.nativeEvent.layout.height)
                          contentHeight.set(e.nativeEvent.layout.height)
                        }}
                      >
                        {docPaper ? (
                          <PageHeading
                            heading={heading}
                            onTitleChange={canTitle ? changeTitle : undefined}
                            onTitleSubmit={canTitle ? openFirstBlock : undefined}
                            readOnly={reading || selecting || drawing}
                          />
                        ) : (
                          <RuledLines height={ruledHeight} paper={paper} />
                        )}

                        {notes.map((note, index) => (
                          <NoteEntry
                            key={note.id}
                            note={note}
                            reorder={noteOrder}
                            index={index}
                            lifted={draggedNote === index}
                            onLayout={(e) => {
                              const { y, height } = e.nativeEvent.layout
                              noteLayouts.current.set(note.id, { top: y, height })
                              updateNoteExtents()
                            }}
                            onMoveLine={(segment, from, to) => moveNoteLine(note.id, segment, from, to)}
                            onLineDragChange={setLineDragging}
                            focusRequest={focusRequest}
                            onChangeContent={(content) => {
                              if (dictationTarget.current?.noteId === note.id) endDictationHere()
                              changeNote(note.id, content)
                            }}
                            onActive={(segment, cursor) => {
                              active.current = { noteId: note.id, segment, cursor }
                              pasteSpot.current = { noteId: note.id, segment, cursor }
                              setEditingImage(null)
                            }}
                            // Yazıdan çıkınca seçim bırakılmış olur. Boş bloklar burada silinmez: yazılı
                            // blokların arasında boşluk olarak kalır, sayfanın sonundakiler sayfadan
                            // çıkınca silinir
                            onBlur={() => releaseSelection(note.id)}
                            onSplit={(segment, at, prefix) => splitNote(note.id, segment, at, prefix)}
                            onMergeBack={() => mergeBack(note.id)}
                            readOnly={reading || selecting || drawing}
                            editingImage={editingImage}
                            onEditImage={editImage}
                            onOpenImage={openImage}
                            onImageAnchor={setImageAnchor}
                            onTouchImage={() => {
                              imageTouchAt.current = Date.now()
                            }}
                            highlighter={pen.active ? pen.color : null}
                            onSelect={(start, end) => selectText(note.id, start, end)}
                            inert={selecting}
                            selected={selecting && selectedIds.has(note.id)}
                          />
                        ))}

                        <DropLine reorder={noteOrder} left={8} />

                        {heading && notes.length === 0 && !reading && !selecting && !drawing && docPaper && (
                          // Boş PDF sayfası soluk bir davetle başlar; dokununca ilk blok açılır
                          <Pressable
                            onPress={addNote}
                            style={styles.docHintRow}
                            accessibilityRole="button"
                            accessibilityLabel={heading.hint}
                          >
                            <Text style={styles.docHint}>{heading.hint}</Text>
                          </Pressable>
                        )}

                        {heading && notes.length === 0 && !reading && !selecting && !drawing && !docPaper && (
                          // Boş sayfa çizgili bir satırla başlar; dokununca ilk blok açılır
                          <Pressable
                            onPress={addNote}
                            style={styles.hintRow}
                            accessibilityRole="button"
                            accessibilityLabel={heading.hint}
                          >
                            <View style={styles.hintMargin}>
                              <MarginTime time={null} />
                            </View>
                            <Text style={styles.hint}>{heading.hint}</Text>
                          </Pressable>
                        )}

                        <Pressable style={styles.blank} onPress={tapBelowBlocks} />

                        <StrokeLayer
                          strokes={pageDrawing.strokes}
                          live={liveStroke}
                          lifted={drawing ? liftedStrokes : undefined}
                          zoom={camera.k}
                          drawing={drawing}
                          scrollY={scrollY}
                          viewport={viewportHeight}
                        />

                        {selecting && (
                          <BlockSelection
                            extents={noteOrder.extents}
                            selected={selectedMask}
                            scrollRef={scrollRef}
                            scrollY={scrollY}
                            viewport={viewportHeight}
                            content={contentHeight}
                            onTap={tapBlock}
                            onSweep={sweepBlocks}
                          />
                        )}
                      </View>
                    </Animated.ScrollView>

                    {/* Okurken alt çubuğun yerinde sayfa numarası durur; son satırlar sistem çubuğunun
                    altında kalmasın. Filtreyle yazarken numara alt çubuğun üstündedir. */}
                    {reading ? (
                      <View style={[styles.folio, { paddingBottom: bottomInset }]}>{folioText}</View>
                    ) : drawing ? (
                      // Çizim modunun çubuğu sayfayla birlikte büyümesin diye sayfanın dışında, bu
                      // boşluğun üstünde durur
                      <>
                        {folioText && <View style={styles.folio}>{folioText}</View>}
                        <View style={[styles.drawingBarSpace, { height: BAR_HEIGHT + bottomInset }]} />
                      </>
                    ) : selecting ? (
                      <>
                        {folioText && <View style={styles.folio}>{folioText}</View>}
                        <SelectionBar
                          bottomInset={bottomInset}
                          count={notes.filter((n) => selectedIds.has(n.id)).length}
                          notice={notice}
                          onCopy={copySelection}
                          onCut={cutSelection}
                          onDuplicate={duplicateSelection}
                          onDelete={deleteSelection}
                        />
                      </>
                    ) : docPaper ? (
                      <>
                        {folioText && <View style={styles.folio}>{folioText}</View>}
                        <DocumentBar
                          bottomInset={bottomInset}
                          listening={dictation.listening}
                          pen={pen}
                          onSwatchPress={() => {
                            setMenuOpen(false)
                            setColorMenuOpen(true)
                          }}
                          onHighlighterPress={() => changePen({ ...pen, active: !pen.active }, 'button')}
                          canPaste={clipboardHasText}
                          onPaste={pasteFromClipboard}
                          onPasteEvent={(data) => pasteMarkdown(pasteEventMarkdown(data))}
                          onHeading={() => formatLines('heading')}
                          onBold={() => formatInline('bold')}
                          onItalic={() => formatInline('italic')}
                          onBullet={() => formatLines('bullet')}
                          onTask={() => formatLines('task')}
                          onCode={() => editMarkdown(insertCodeBlock)}
                          onMicPress={toggleDictation}
                          onClipPress={() => {
                            setEditingImage(null)
                            checkClipboard()
                            setMenuOpen((open) => !open)
                          }}
                          notice={docNotice}
                        />
                      </>
                    ) : (
                      <>
                        {folioText && <View style={styles.folio}>{folioText}</View>}
                        <BottomBar
                          bottomInset={bottomInset}
                          listening={dictation.listening}
                          pen={pen}
                          onSwatchPress={() => {
                            setMenuOpen(false)
                            setColorMenuOpen(true)
                          }}
                          onHighlighterPress={() => changePen({ ...pen, active: !pen.active }, 'button')}
                          onMicPress={toggleDictation}
                          onClockPress={toggleTime}
                          onClockEditPress={openTimeMenu}
                          onCheckPress={() => toggleLine(toggleCheckLine)}
                          onNumberPress={() => toggleLine(toggleNumberLine)}
                          onClipPress={() => {
                            setEditingImage(null)
                            checkClipboard()
                            setMenuOpen((open) => !open)
                          }}
                        />
                      </>
                    )}

                    <PenMenu
                      visible={colorMenuOpen}
                      pen={pen}
                      onChange={(next) => changePen(next, 'menu')}
                      onClose={() => setColorMenuOpen(false)}
                    />

                    <TimeMenu
                      visible={timeEdit !== null}
                      time={timeEdit?.time ?? null}
                      onClose={saveEditedTime}
                    />

                    <PageSidebar
                      visible={settingsOpen}
                      title="Sayfa ayarları"
                      subtitle={heading?.meta}
                      sections={settingsSections}
                      onClose={() => setSettingsOpen(false)}
                    />

                    {menuOpen && (
                      <AttachMenu
                        bottom={BAR_HEIGHT + bottomInset + 8}
                        options={attachOptions}
                        onClose={() => setMenuOpen(false)}
                      />
                    )}
                  </View>
                </KeyboardAvoidingView>
              </Paper>
            </Animated.View>
          </Animated.View>
        </BlurTargetView>

        {drawing && isCurrent && (
          <DrawingOverlay
            camera={camera}
            origin={scrollOrigin}
            scrollRef={scrollRef}
            scrollY={scrollY}
            viewport={viewportHeight}
            content={contentHeight}
            live={liveStroke}
            strokes={pageDrawing.strokes}
            tool={drawTool}
            onToolChange={changeDrawTool}
            pen={drawPen}
            onPenChange={changeDrawPen}
            hasStrokes={pageDrawing.strokes.length > 0}
            canUndo={pageDrawing.canUndo}
            canRedo={pageDrawing.canRedo}
            onUndo={pageDrawing.undo}
            onRedo={pageDrawing.redo}
            onClear={pageDrawing.clear}
            onStroke={pageDrawing.add}
            onAddStrokes={pageDrawing.addMany}
            onRemoveStrokes={pageDrawing.remove}
            onMoveStrokes={pageDrawing.move}
            onSelectionChange={setLiftedStrokes}
            onErase={pageDrawing.eraseAt}
            onEraseEnd={pageDrawing.endErase}
            onClose={() => changeDrawing(false)}
          />
        )}

        {viewer && (
          <ImageViewer
            images={viewer.images}
            startIndex={viewer.index}
            originOf={(name) => imageOrigins.current.get(name) ?? null}
            progress={viewerProgress}
            blurTarget={blurTarget}
            onClosed={() => setViewer(null)}
            onCrop={reading ? undefined : cropViewerImage}
          />
        )}
      </View>
    </DocumentContext>
  )
}

const styles = StyleSheet.create({
  // Defterin altındaki masa; defter uzaklaşınca kenarlarda görünür
  desk: {
    flex: 1,
    backgroundColor: '#2B2620',
  },
  notebook: {
    flex: 1,
    overflow: 'hidden',
  },
  zoom: {
    flex: 1,
    transformOrigin: [0, 0, 0],
  },
  drawingBarSpace: {
    backgroundColor: notebook.paper,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  ruled: {
    flexGrow: 1,
  },
  hintMargin: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: notebook.marginX - 8 + handTailWidth(15),
  },
  hintRow: {
    paddingLeft: notebook.marginX + 12,
    paddingRight: 20,
  },
  hint: {
    fontFamily: fonts.hand,
    fontSize: 21,
    lineHeight: notebook.lineHeight,
    color: 'rgba(56, 56, 61, 0.35)',
  },
  blank: {
    flexGrow: 1,
    minHeight: notebook.lineHeight * 3,
  },
  folio: {
    alignItems: 'center',
    paddingTop: 4,
  },
  folioText: {
    fontFamily: fonts.hand,
    fontSize: 19,
    lineHeight: 28,
    color: 'rgba(56, 56, 61, 0.6)',
  },
  // PDF: başlık üst çubuğun hemen altında başlar
  docRuled: {
    paddingTop: 10,
  },
  docHintRow: {
    paddingLeft: DOC_ROW_LEFT,
    paddingRight: 20,
  },
  docHint: {
    fontFamily: fonts.docItalic,
    fontSize: docPage.fontSize,
    lineHeight: docPage.lineHeight,
    color: docPage.faint,
  },
  docFolioText: {
    fontFamily: fonts.bodyThin,
    fontSize: 12,
    lineHeight: 24,
    letterSpacing: 1,
    color: docPage.muted,
  },
})
