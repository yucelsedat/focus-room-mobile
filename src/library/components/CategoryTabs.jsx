import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { fonts, shelf, type } from '../theme'

// Arama çubuğunun altındaki sekmeler: her kategori kendi raflarını gösterir. Sekmeler yana kayan
// hap biçimli etiketlerdir, seçili olan koyu dolgulu; etiket simgesi sağda sabit durur.
export function CategoryTabs({ categories, activeId, counts, onSelect, onManage }) {
  const scrollRef = useRef(null)
  // Sekmelerin yatay konumu; seçilen sekme görünür alana kaydırılır
  const offsets = useRef(new Map())
  const viewWidth = useRef(0)

  useEffect(() => {
    const tab = offsets.current.get(activeId)
    if (!tab) return
    const x = Math.max(0, tab.x + tab.width / 2 - viewWidth.current / 2)
    scrollRef.current?.scrollTo({ x, animated: true })
  }, [activeId])

  return (
    <View style={styles.bar}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        onLayout={(e) => {
          viewWidth.current = e.nativeEvent.layout.width
        }}
        accessibilityRole="tablist"
      >
        {categories.map((category) => {
          const selected = category.id === activeId
          const count = counts.get(category.id) ?? 0
          return (
            <Pressable
              key={category.id}
              onPress={() => onSelect(category.id)}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout
                offsets.current.set(category.id, { x, width })
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${category.name}, ${count} defter`}
              style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            >
              <View style={[styles.pill, selected && styles.pillOn]}>
                <Text style={[styles.tabText, selected && styles.tabTextSelected]} numberOfLines={1}>
                  {category.name}
                </Text>
                {count > 0 && (
                  <Text style={[styles.count, selected && styles.countOn]}>{count}</Text>
                )}
              </View>
            </Pressable>
          )
        })}
      </ScrollView>
      <Pressable
        onPress={onManage}
        accessibilityRole="button"
        accessibilityLabel="Kategorileri düzenle"
        accessibilityHint="Kategori ekle, adını değiştir ya da sil"
        hitSlop={4}
        style={({ pressed }) => [styles.manage, pressed && styles.pressed]}
      >
        <Ionicons name="pricetags-outline" size={19} color={shelf.ink} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabs: {
    paddingLeft: 20,
    paddingRight: 8,
    gap: 8,
    alignItems: 'center',
  },
  tab: {
    borderRadius: 18,
  },
  tabPressed: {
    opacity: 0.6,
  },
  pill: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: shelf.hairline,
    backgroundColor: shelf.card,
  },
  pillOn: {
    borderColor: shelf.ink,
    backgroundColor: shelf.ink,
  },
  tabText: {
    fontFamily: fonts.bodyThin,
    fontSize: 14,
    letterSpacing: 0.2,
    color: shelf.ink,
  },
  tabTextSelected: {
    fontFamily: fonts.bodyBold,
    color: shelf.card,
  },
  count: {
    fontFamily: fonts.bodyBold,
    fontSize: type.caption,
    color: shelf.faint,
  },
  countOn: {
    color: 'rgba(255, 255, 255, 0.55)',
  },
  manage: {
    width: 44,
    height: 36,
    marginRight: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: shelf.pressed,
  },
})
