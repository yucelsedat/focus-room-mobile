import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, type } from '../theme'

// Kitaplığın başlığının altındaki sekmeler: her kategori kendi raflarını gösterir. Sekmeler yana
// kayar; ayar simgesi sağda sabit durur.
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
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <Text style={[styles.tabText, selected && styles.tabTextSelected]} numberOfLines={1}>
                {category.name}
              </Text>
              <View style={[styles.indicator, selected && styles.indicatorOn]} />
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
        <Ionicons name="pricetags-outline" size={20} color={colors.onInk} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.ink,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(244, 239, 230, 0.18)',
  },
  tabs: {
    paddingHorizontal: 10,
    gap: 4,
  },
  tab: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  pressed: {
    backgroundColor: 'rgba(244, 239, 230, 0.12)',
  },
  tabText: {
    fontFamily: fonts.bodyThin,
    fontSize: type.body,
    letterSpacing: 0.3,
    color: colors.onInk,
  },
  tabTextSelected: {
    fontFamily: fonts.bodyBold,
  },
  // Seçili sekmenin altında kapaktaki lastik bant gibi kiremit bir şerit
  indicator: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: 'transparent',
  },
  indicatorOn: {
    backgroundColor: colors.accent,
  },
  manage: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(244, 239, 230, 0.18)',
  },
})
