import Ionicons from '@expo/vector-icons/Ionicons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { discoverServer } from '../api/discovery'
import { AddButton } from '../library/components/AddButton'
import { Bookshelf } from '../library/components/Bookshelf'
import { BottomNav } from '../library/components/BottomNav'
import { CategoryManager } from '../library/components/CategoryManager'
import { CategoryTabs } from '../library/components/CategoryTabs'
import { TornPaperMenu } from '../library/components/TornPaperMenu'
import {
  deleteNotebook,
  GENERAL_CATEGORY_ID,
  getCategories,
  getNotebooks,
  setNotebookCategory,
  setNotebookShelves,
} from '../library/db'
import { forgetNotebook } from '../library/lib/notebookState'
import { DEFAULT_SHELF_COUNT, settleOverflow } from '../library/lib/shelves'
import { colors, fonts, HAND_TAIL, handTailWidth, shelf, type } from '../library/theme'

// Ana sayfa: defterlerin raflarda durduğu kitaplıklar. Her kategorinin kendi kitaplığı vardır;
// kitaplıklar yan yana durur, sola sağa kaydırınca ya da başlığın altındaki sekmelerden birine
// basınca öbür kategoriye geçilir (açılışta Genel). Kitaplığın rafları aşağı doğru uzar, aşağı
// yukarı kaydırılır. Sağ üstteki kalemle düzenlemeye geçilir; düzenlerken defterler basılı tutulup
// sürüklenerek yer değiştirir.
export default function LibraryScreen() {
  const pagerRef = useRef(null)
  const shelfRefs = useRef(new Map())
  const [notebooks, setNotebooks] = useState([])
  const [categories, setCategories] = useState([])
  const [activeId, setActiveId] = useState(GENERAL_CATEGORY_ID)
  const [managing, setManaging] = useState(false)
  const [editing, setEditing] = useState(false)
  // Basılı tutulan defter; silme sorusu ve kategori seçimi aynı kâğıtta sorulur. Kâğıt
  // kapanırken yazısı silinmesin diye seçili defter kapanınca da tutulur.
  const [selected, setSelected] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuMode, setMenuMode] = useState('main')
  // Kitaplıkların yan yana durduğu alanın eni; her kitaplık bu kadar yer kaplar
  const [pageWidth, setPageWidth] = useState(0)
  // Bir defter sürüklenirken kitaplıklar arasında geçilmez
  const [dragging, setDragging] = useState(false)
  // Görünen kitaplık ve onun çizildiği en
  const shown = useRef({ page: 0, width: 0 })
  // Kitaplık focus-room sunucusunda durur: 'ok' | 'searching' (sunucu aranıyor) | 'offline'
  const [connection, setConnection] = useState('ok')
  // Son yüklemenin numarası; ekrandan çıkınca ya da yeniden yüklenince eski yanıt yok sayılır
  const loadToken = useRef(0)

  const loadLibrary = useCallback(() => {
    const token = ++loadToken.current
    const stale = () => token !== loadToken.current
    const load = () => Promise.all([getNotebooks(), getCategories()])
    load()
      .catch(async () => {
        // Sunucu adresi yoksa ya da yanıt vermiyorsa sunucu yeniden aranır (odalardaki gibi)
        if (stale()) throw new Error('iptal')
        setConnection('searching')
        if (!(await discoverServer())) throw new Error('Sunucu bulunamadı')
        return load()
      })
      .then(([books, list]) => {
        if (stale()) return
        setConnection('ok')
        setNotebooks(books)
        setCategories(list)
        // Seçili kategori bu arada silinmişse Genel'e dönülür
        setActiveId((id) => (list.some((c) => c.id === id) ? id : GENERAL_CATEGORY_ID))
      })
      .catch(() => {
        if (!stale()) setConnection('offline')
      })
  }, [])

  // Oluşturma ekranından dönünce yeni defter de rafta görünsün. Kitaplıklar her açılışta en
  // üstünden başlar; başka ekrana geçilince düzenleme biter.
  useFocusEffect(
    useCallback(() => {
      for (const shelf of shelfRefs.current.values()) shelf.scrollToTop(false)
      loadLibrary()
      return () => {
        loadToken.current++
        setEditing(false)
      }
    }, [loadLibrary]),
  )

  // Kategoriler ayarlanınca; seçili kategori silinmişse Genel'e dönülür
  function updateCategories(list) {
    setCategories(list)
    setActiveId((id) => (list.some((c) => c.id === id) ? id : GENERAL_CATEGORY_ID))
  }

  function selectCategory(id) {
    if (id === activeId) return
    setActiveId(id)
  }

  // Sekmeden seçilen (ya da silinip yerine Genel'e dönülen) kategorinin kitaplığına kayılır; en
  // değişince (ör. ekran döndü) görünen kitaplık yerinde kalır
  const activeIndex = Math.max(
    0,
    categories.findIndex((c) => c.id === activeId),
  )
  useEffect(() => {
    if (pageWidth === 0) return
    const { page, width } = shown.current
    if (page === activeIndex && width === pageWidth) return
    shown.current = { page: activeIndex, width: pageWidth }
    pagerRef.current?.scrollTo({ x: activeIndex * pageWidth, animated: width === pageWidth })
  }, [activeIndex, pageWidth])

  // Kaydırarak başka kitaplığa geçilince onun sekmesi seçilir
  function onPageSettled(e) {
    if (pageWidth === 0) return
    const page = Math.round(e.nativeEvent.contentOffset.x / pageWidth)
    const category = categories[page]
    if (!category) return
    shown.current = { page, width: pageWidth }
    setActiveId(category.id)
  }

  const counts = useMemo(() => {
    const result = new Map()
    for (const notebook of notebooks) {
      result.set(notebook.category_id, (result.get(notebook.category_id) ?? 0) + 1)
    }
    return result
  }, [notebooks])

  // Her kategorinin kitaplığı: defterleri raf raf, her rafta soldan sağa. Kitaplık en az
  // DEFAULT_SHELF_COUNT raftır; düzenlerken en alttaki dolu rafın altında hep boş bir raf olur ki
  // defter oraya da konabilsin.
  const library = useMemo(() => {
    const result = new Map()
    for (const category of categories) result.set(category.id, [])
    for (const notebook of notebooks) {
      const shelves = result.get(notebook.category_id)
      if (shelves) (shelves[notebook.shelf] ??= []).push(notebook)
    }
    for (const [id, shelves] of result) {
      const length = Math.max(DEFAULT_SHELF_COUNT, shelves.length + (editing ? 1 : 0))
      const full = Array.from({ length }, (_, i) => shelves[i] ?? [])
      for (const books of full) books.sort((a, b) => a.position - b.position || a.id - b.id)
      result.set(id, full)
    }
    return result
  }, [notebooks, categories, editing])
  const visibleCount = (library.get(activeId) ?? []).reduce((sum, books) => sum + books.length, 0)

  // Yalnızca defterin kendi kategorisindeki defterlerin yeri değişir. Dolu rafa giren defter
  // rafın en sağındakini alttaki rafa indirir, o raf da doluysa onun en sağındakini...
  function move(id, to) {
    const book = notebooks.find((b) => b.id === id)
    const shelves = book && library.get(book.category_id)
    if (!book || !shelves) return
    const next = shelves.map((books) => books.filter((b) => b.id !== id))
    next[to.shelf].splice(to.index, 0, book)
    settleOverflow(next, to.shelf)
    const slots = new Map()
    next.forEach((books, s) => books.forEach((b, position) => slots.set(b.id, { shelf: s, position })))
    setNotebooks((prev) => prev.map((b) => (slots.has(b.id) ? { ...b, ...slots.get(b.id) } : b)))
    setNotebookShelves(next.map((books) => books.map((b) => b.id)))
  }

  // Defter başka kategoriye geçer, o kategorinin raflarının sonuna konur
  async function moveSelectedTo(categoryId) {
    if (!selected) return
    const { id } = selected
    setMenuOpen(false)
    const slot = await setNotebookCategory(id, categoryId)
    if (slot) setNotebooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...slot } : b)))
  }

  function openNotebook(notebook) {
    router.push({ pathname: '/notebook', params: { id: String(notebook.id) } })
  }

  function select(notebook) {
    setMenuMode('main')
    setSelected(notebook)
    setMenuOpen(true)
  }

  async function removeSelected() {
    if (!selected) return
    const { id } = selected
    setMenuOpen(false)
    await deleteNotebook(id)
    await forgetNotebook(id)
    setNotebooks((prev) => prev.filter((n) => n.id !== id))
  }

  // Menüden bir yere gidilince kâğıt kapanır
  function andClose(action) {
    return () => {
      if (!selected) return
      setMenuOpen(false)
      action(selected)
    }
  }

  const menuOptions =
    menuMode === 'delete'
      ? [
          { label: 'Evet, sil', danger: true, onPress: removeSelected },
          { label: 'Vazgeç', onPress: () => setMenuMode('main') },
        ]
      : menuMode === 'category'
        ? categories.map((category) => ({
            label: category.name,
            checked: category.id === selected?.category_id,
            onPress: () => moveSelectedTo(category.id),
          }))
        : [
            { label: 'Aç', onPress: andClose(openNotebook) },
            {
              label: 'Düzenle',
              onPress: andClose((notebook) =>
                router.push({
                  pathname: '/edit-notebook/[id]',
                  params: { id: String(notebook.id) },
                }),
              ),
            },
            ...(categories.length > 1 ? [{ label: 'Kategori', onPress: () => setMenuMode('category') }] : []),
            { label: 'Sil', danger: true, onPress: () => setMenuMode('delete') },
          ]

  const menuTitle =
    menuMode === 'delete'
      ? `“${selected?.title}” silinsin mi?`
      : menuMode === 'category'
        ? 'Hangi kategoride?'
        : (selected?.title ?? '')

  // Yeri değişecek en az iki defter olunca düzenlenebilir
  const canEdit = editing || visibleCount > 1

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {/* Kitaplıktan 3B odalara (eski ana sayfa) */}
        <Pressable
          onPress={() => router.push('/worlds')}
          accessibilityRole="button"
          accessibilityLabel="Odalar"
          accessibilityHint="3B odalara gider"
          hitSlop={8}
          style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
        >
          <Ionicons name="cube-outline" size={22} color={colors.onInk} style={styles.roomsIcon} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Kitaplık</Text>
          {editing && <Text style={styles.subtitle}>Basılı tut, sürükle</Text>}
        </View>
        <Pressable
          onPress={() => setEditing((on) => !on)}
          disabled={!canEdit}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Düzenlemeyi bitir' : 'Kitaplığı düzenle'}
          accessibilityHint={editing ? undefined : 'Defterlerin yerini sürükleyerek değiştir'}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.headerButtonPressed,
            !canEdit && styles.headerButtonDisabled,
          ]}
        >
          <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={24} color={colors.onInk} />
        </Pressable>
      </View>
      <CategoryTabs
        categories={categories}
        activeId={activeId}
        counts={counts}
        onSelect={selectCategory}
        onManage={() => setManaging(true)}
      />
      <View style={styles.wall} onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}>
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          scrollEnabled={!dragging}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onPageSettled}
        >
          {pageWidth > 0 &&
            categories.map((category) => {
              const shelves = library.get(category.id) ?? []
              const empty = shelves.every((books) => books.length === 0)
              return (
                <View key={category.id} style={{ width: pageWidth }}>
                  <Bookshelf
                    ref={(handle) => {
                      if (handle) shelfRefs.current.set(category.id, handle)
                      else shelfRefs.current.delete(category.id)
                    }}
                    shelves={shelves}
                    editing={editing}
                    onOpen={openNotebook}
                    onSelect={select}
                    onMove={move}
                    onDragChange={setDragging}
                  >
                    {empty && (
                      <View style={styles.empty} pointerEvents="none">
                        <Text style={styles.emptyTitle}>{'Bu raflar boş' + HAND_TAIL}</Text>
                        <Text style={styles.emptyText}>
                          {(category.id === GENERAL_CATEGORY_ID
                            ? 'Yeni bir defter ekle'
                            : 'Yeni defter ekle ya da bir defteri bu kategoriye taşı') + HAND_TAIL}
                        </Text>
                      </View>
                    )}
                  </Bookshelf>
                </View>
              )
            })}
        </ScrollView>
        {connection !== 'ok' && (
          <View style={styles.offline}>
            {connection === 'searching' ? (
              <>
                <ActivityIndicator color={colors.onInk} />
                <Text style={styles.offlineText}>{'Sunucu aranıyor…' + HAND_TAIL}</Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>{'Sunucuya ulaşılamadı' + HAND_TAIL}</Text>
                <Text style={styles.emptyText}>
                  {'Defterler bilgisayardaki Focus Room sunucusunda durur. Sunucu çalışıyor mu, telefon aynı Wi-Fi ağında mı?' +
                    HAND_TAIL}
                </Text>
                <View style={styles.offlineButtons}>
                  <Pressable
                    onPress={loadLibrary}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.offlineButton, pressed && styles.headerButtonPressed]}
                  >
                    <Text style={styles.offlineButtonText}>Tekrar ara</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push('/worlds')}
                    accessibilityRole="button"
                    accessibilityHint="Odalar ekranında sunucu adresi elle girilebilir"
                    style={({ pressed }) => [styles.offlineButton, pressed && styles.headerButtonPressed]}
                  >
                    <Text style={styles.offlineButtonText}>Adresi elle gir</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}
        {!editing && connection === 'ok' && (
          <AddButton
            label="Yeni defter"
            hint="Seçili kategoride defter oluşturma ekranını açar"
            onPress={() => router.push({ pathname: '/new-notebook', params: { category: String(activeId) } })}
          />
        )}
      </View>
      <BottomNav active="library" onReselect={() => shelfRefs.current.get(activeId)?.scrollToTop(true)} />
      <TornPaperMenu
        visible={menuOpen}
        title={menuTitle}
        message={
          menuMode === 'delete'
            ? 'İçindeki bütün notlar da silinir.'
            : menuMode === 'category'
              ? selected?.title
              : undefined
        }
        options={menuOptions}
        onClose={() => setMenuOpen(false)}
      />
      <CategoryManager
        visible={managing}
        onClose={() => setManaging(false)}
        onChange={(list) => {
          updateCategories(list)
          // Silinen kategorinin defterleri Genel'e geçmiş olabilir
          getNotebooks().then(setNotebooks)
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerText: {
    alignItems: 'center',
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPressed: {
    backgroundColor: 'rgba(244, 239, 230, 0.15)',
  },
  headerButtonDisabled: {
    opacity: 0.25,
  },
  roomsIcon: {
    opacity: 0.7,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: type.title,
    color: colors.onInk,
  },
  subtitle: {
    fontFamily: fonts.bodyThin,
    fontSize: type.caption,
    letterSpacing: 1.5,
    color: colors.onInk,
  },
  wall: {
    flex: 1,
    backgroundColor: shelf.wall,
  },
  // Boş kategoride rafların ortasında tebeşirle yazılmış gibi bir not
  empty: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 4,
  },
  emptyTitle: {
    fontFamily: fonts.handBold,
    fontSize: 34,
    color: colors.onInk,
    marginRight: -handTailWidth(34),
  },
  offline: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 8,
    backgroundColor: shelf.wall,
  },
  offlineText: {
    fontFamily: fonts.hand,
    fontSize: 24,
    color: colors.onInk,
    marginRight: -handTailWidth(24),
  },
  offlineButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  offlineButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(244, 239, 230, 0.5)',
  },
  offlineButtonText: {
    fontFamily: fonts.bodyBold,
    fontSize: type.caption,
    color: colors.onInk,
  },
  emptyText: {
    fontFamily: fonts.hand,
    fontSize: 21,
    textAlign: 'center',
    color: 'rgba(244, 239, 230, 0.75)',
    marginRight: -handTailWidth(21),
  },
})
