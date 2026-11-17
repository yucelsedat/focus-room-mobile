import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import Animated from 'react-native-reanimated'

import { DragHandle, DropLine, useDraggedStyle, useReorder } from '../notebook/DragReorder'
import { PAPER_LINE, PAPER_MARGIN, TornPaperMenu } from './TornPaperMenu'
import {
  createCategory,
  deleteCategory,
  GENERAL_CATEGORY_ID,
  GENERAL_CATEGORY_NAME,
  getCategories,
  getCategoryCounts,
  MAX_CATEGORY_NAME,
  renameCategory,
  setCategoryOrder,
} from '../db'
import { categoryNameTaken, cleanCategoryName } from '../lib/categories'
import { colors, fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

const NAME_SIZE = 27
const COUNT_SIZE = 19
const PLACEHOLDER = 'rgba(56, 56, 61, 0.45)'

// Kitaplığın sekmelerinin ayarlandığı kâğıt: kategoriler satır satır yazılı; adın üstüne
// dokunup değiştirilir, çöp kutusuyla silinir, soldaki tutamaçtan sürüklenip sırası değişir,
// en alttaki boş satıra yenisi yazılır.
// Genel hep en baştadır, adı değişmez ve silinmez. Silinen kategorinin defterleri Genel'e geçer.
export function CategoryManager({ visible, onClose, onChange }) {
  const window = useWindowDimensions()
  const [categories, setCategories] = useState([])
  const [counts, setCounts] = useState(new Map())
  // Adı değiştirilmekte olan kategoriler: yazı kâğıttan ayrılınca kaydedilir
  const [drafts, setDrafts] = useState({})
  const [newName, setNewName] = useState('')
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(null)
  // Sürüklenen satırın sırası (Genel'den sonrakiler arasında)
  const [dragged, setDragged] = useState(null)

  // Genel hep en baştadır; sırası değişen kategoriler ondan sonrakiler
  const movable = categories.filter((c) => c.id !== GENERAL_CATEGORY_ID)
  const order = useReorder({ onMove: move, onDragChange: setDragged })

  // Satırların hepsi kâğıdın bir satırı yüksekliğinde, alt alta
  useEffect(() => {
    order.extents.set(
      Array.from({ length: movable.length }, (_, i) => ({ top: i * PAPER_LINE, height: PAPER_LINE })),
    )
  }, [order.extents, movable.length])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    Promise.all([getCategories(), getCategoryCounts()]).then(([list, c]) => {
      if (cancelled) return
      setCategories(list)
      setCounts(c)
    })
    return () => {
      cancelled = true
    }
  }, [visible])

  async function reload() {
    const [list, c] = await Promise.all([getCategories(), getCategoryCounts()])
    setCategories(list)
    setCounts(c)
    onChange?.(list)
  }

  function dropDraft(id) {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function commitRename(category) {
    const draft = drafts[category.id]
    if (draft === undefined) return
    dropDraft(category.id)
    const name = cleanCategoryName(draft)
    if (name === category.name) return
    if (name === '') return
    if (categoryNameTaken(categories, name, category.id)) {
      setError(`“${name}” zaten var`)
      return
    }
    setError(null)
    await renameCategory(category.id, name)
    await reload()
  }

  async function add() {
    const name = cleanCategoryName(newName)
    if (name === '') return
    if (categoryNameTaken(categories, name)) {
      setError(`“${name}” zaten var`)
      return
    }
    setError(null)
    setNewName('')
    await createCategory(name)
    await reload()
  }

  // Kategori from'dan to'ya taşınır (ikisi de Genel'den sonrakiler arasındaki sıra); sekmeler
  // hemen yeni sırayla dizilir
  function move(from, to) {
    const next = [...movable]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    const list = [...categories.filter((c) => c.id === GENERAL_CATEGORY_ID), ...next]
    setCategories(list)
    onChange?.(list)
    setCategoryOrder(next.map((c) => c.id))
  }

  async function remove() {
    if (!confirming) return
    const { id } = confirming
    setConfirming(null)
    await deleteCategory(id)
    await reload()
  }

  // Kapanırken yarım kalan ad değişiklikleri de kaydedilir; kâğıt bir sonraki açılışta temiz gelir
  function close() {
    for (const category of categories) {
      if (drafts[category.id] !== undefined) commitRename(category)
    }
    setNewName('')
    setError(null)
    onClose()
  }

  if (confirming) {
    const count = counts.get(confirming.id) ?? 0
    const options = [
      { label: 'Evet, sil', danger: true, onPress: remove },
      { label: 'Vazgeç', onPress: () => setConfirming(null) },
    ]
    return (
      <TornPaperMenu
        visible={visible}
        title={`“${confirming.name}” silinsin mi?`}
        message={
          count > 0
            ? `İçindeki ${count} defter ${GENERAL_CATEGORY_NAME}’e taşınır.`
            : 'Bu kategoride defter yok.'
        }
        options={options}
        onClose={() => setConfirming(null)}
      />
    )
  }

  const general = categories.find((c) => c.id === GENERAL_CATEGORY_ID)

  return (
    <TornPaperMenu
      visible={visible}
      title="Kategoriler"
      message={error ?? (movable.length > 1 ? 'Soldan tutup sürükle, sırası değişsin' : undefined)}
      options={[{ label: 'Tamam', onPress: close }]}
      onClose={close}
    >
      <ScrollView
        style={{ maxHeight: window.height * 0.45 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        // Satır sürüklenirken liste kaymaz
        scrollEnabled={dragged === null}
      >
        {general && (
          <View style={styles.row}>
            <Text style={[styles.hand, styles.name, styles.fixedName]} numberOfLines={1}>
              {general.name + HAND_TAIL}
            </Text>
            <CountText count={counts.get(general.id) ?? 0} />
            <View
              style={styles.icon}
              accessible
              accessibilityLabel={`${GENERAL_CATEGORY_NAME} hep en baştadır, silinemez`}
            >
              <Ionicons name="lock-closed-outline" size={17} color={PLACEHOLDER} />
            </View>
          </View>
        )}
        {/* Genel'den sonraki kategoriler: kenar boşluğundaki tutamaçtan basılı tutulup yukarı
            aşağı sürüklenir; bırakılacağı yerde kurşun kalem çizgisi çıkar */}
        <View>
          {movable.map((category, index) => (
            <MovableRow
              key={category.id}
              reorder={order}
              index={index}
              total={movable.length}
              lifted={dragged === index}
              category={category}
              count={counts.get(category.id) ?? 0}
              draft={drafts[category.id]}
              onDraft={(text) => setDrafts((prev) => ({ ...prev, [category.id]: text }))}
              onCommit={() => commitRename(category)}
              onDelete={() => setConfirming(category)}
              onMove={(to) => move(index, to)}
            />
          ))}
          <DropLine reorder={order} left={PAPER_MARGIN + 6} />
        </View>
        <View style={styles.row}>
          <TextInput
            value={newName}
            onChangeText={(text) => {
              setNewName(text)
              if (error) setError(null)
            }}
            onSubmitEditing={add}
            // Enter'la eklendikten sonra klavye açık kalır, ardından bir başkası yazılabilir
            submitBehavior="submit"
            placeholder="yeni kategori…"
            placeholderTextColor={PLACEHOLDER}
            maxLength={MAX_CATEGORY_NAME}
            returnKeyType="done"
            accessibilityLabel="Yeni kategorinin adı"
            style={[styles.hand, styles.name, styles.input]}
          />
          <Pressable
            onPress={add}
            disabled={cleanCategoryName(newName) === ''}
            accessibilityRole="button"
            accessibilityLabel="Kategoriyi ekle"
            hitSlop={6}
            style={({ pressed }) => [
              styles.icon,
              pressed && styles.pressed,
              cleanCategoryName(newName) === '' && styles.disabled,
            ]}
          >
            <Ionicons name="add-circle-outline" size={24} color={colors.accent} />
          </Pressable>
        </View>
      </ScrollView>
    </TornPaperMenu>
  )
}

function CountText({ count }) {
  return <Text style={[styles.hand, styles.count]}>{(count > 0 ? String(count) : 'boş') + HAND_TAIL}</Text>
}

// Sırası değişebilen kategori satırı: solda, kırmızı çizginin dışındaki kenar boşluğunda tutamaç
// (defterdeki notun saati gibi), ortada adı, sağda defter sayısı ve çöp kutusu
function MovableRow({
  reorder,
  index,
  total,
  lifted,
  category,
  count,
  draft,
  onDraft,
  onCommit,
  onDelete,
  onMove,
}) {
  const draggedStyle = useDraggedStyle(reorder, index)
  const actions = [
    ...(index > 0 ? [{ name: 'up', label: 'Yukarı taşı' }] : []),
    ...(index < total - 1 ? [{ name: 'down', label: 'Aşağı taşı' }] : []),
  ]

  return (
    <Animated.View
      // collapsable={false}: zIndex açılıp kapanınca görünüm yeniden kurulmasın, yazı odağı kaybolmasın
      collapsable={false}
      style={[styles.row, lifted && styles.lifted, draggedStyle]}
    >
      <DragHandle reorder={reorder} index={index} hitSlop={6} style={styles.handle}>
        <View
          style={styles.handleInner}
          accessible
          accessibilityLabel={`${category.name}, ${index + 2}. sırada`}
          accessibilityHint="Basılı tutup yukarı aşağı sürükleyerek sırasını değiştir"
          accessibilityActions={actions}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'up') onMove(index - 1)
            if (e.nativeEvent.actionName === 'down') onMove(index + 1)
          }}
        >
          <Ionicons name="reorder-two" size={20} color={lifted ? notebook.graphite : PLACEHOLDER} />
        </View>
      </DragHandle>
      <TextInput
        value={draft ?? category.name}
        onChangeText={onDraft}
        onEndEditing={onCommit}
        maxLength={MAX_CATEGORY_NAME}
        returnKeyType="done"
        accessibilityLabel={`${category.name} kategorisinin adı`}
        accessibilityHint="Adı değiştirmek için yaz"
        style={[styles.hand, styles.name, styles.input]}
      />
      <CountText count={count} />
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={`${category.name} kategorisini sil`}
        hitSlop={6}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
      >
        <Ionicons name="trash-outline" size={20} color={notebook.graphite} />
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // Satırlar kâğıdın mavi çizgilerine yazılır
  row: {
    height: PAPER_LINE,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingLeft: PAPER_MARGIN + 12,
    paddingRight: 10,
    borderTopWidth: 1,
    borderTopColor: notebook.rule,
  },
  // Sürüklenen satır kâğıttan kaldırılmış gibi: altındaki satırları örter, gölgesi düşer
  lifted: {
    zIndex: 20,
    backgroundColor: notebook.paper,
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  // Tutamaç kırmızı çizginin solundaki kenar boşluğunu kaplar
  handle: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: PAPER_MARGIN,
  },
  handleInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hand: {
    color: notebook.graphite,
  },
  name: {
    flex: 1,
    fontFamily: fonts.handBold,
    fontSize: NAME_SIZE,
    paddingBottom: 2,
  },
  fixedName: {
    marginRight: -handTailWidth(NAME_SIZE),
  },
  input: {
    paddingTop: 0,
    paddingHorizontal: 0,
    includeFontPadding: false,
  },
  count: {
    fontFamily: fonts.hand,
    fontSize: COUNT_SIZE,
    paddingBottom: 6,
    marginRight: -handTailWidth(COUNT_SIZE),
  },
  icon: {
    width: 34,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: 'rgba(56, 56, 61, 0.08)',
    borderRadius: 8,
  },
  disabled: {
    opacity: 0.35,
  },
})
