import Ionicons from '@expo/vector-icons/Ionicons'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { StickyNoteIcon } from './StickyNoteIcon'
import { getLastNotebook } from '../lib/notebookState'
import { colors, fonts, shelf, type } from '../theme'

// Not sayfası dışındaki ekranların altındaki gezinme çubuğu. Pano, takvim ve ayraçlar web'deki
// all-books gibi sonraki fazlarda gelir (şimdilik kapalı, "Yakında").
// Defter, en son açılan defteri kaldığı sayfadan açar; rafta defter yoksa oluşturma ekranını.
export function BottomNav({ active, onReselect }) {
  const insets = useSafeAreaInsets()

  function goToLibrary() {
    if (active === 'library') onReselect?.()
    else router.dismissTo('/')
  }

  async function openLastNotebook() {
    const notebook = await getLastNotebook().catch(() => null)
    if (notebook) router.push({ pathname: '/notebook', params: { id: String(notebook.id) } })
    else router.push('/new-notebook')
  }

  return (
    <View style={[styles.bar, { paddingBottom: 6 + insets.bottom }]}>
      <NavItem
        icon="library"
        label="Kitaplık"
        hint="Defterlerin durduğu rafları göster"
        selected={active === 'library'}
        onPress={goToLibrary}
      />
      <NavItem icon="sticky" label="Pano" hint="Yakında" disabled />
      <NavItem icon="calendar" label="Takvim" hint="Yakında" disabled />
      <NavItem icon="bookmark" label="Ayraçlar" hint="Yakında" disabled />
      <NavItem
        icon="book"
        label="Defter"
        hint="En son açtığın defteri kaldığın sayfadan aç"
        onPress={openLastNotebook}
      />
    </View>
  )
}

function NavItem({ icon, label, hint, selected = false, disabled = false, onPress }) {
  const dim = !selected && (disabled ? styles.disabled : styles.dim)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <View style={[styles.indicator, selected && styles.indicatorOn]} />
      {icon === 'sticky' ? (
        <View style={dim}>
          <StickyNoteIcon size={24} color={shelf.ink} filled={selected} />
        </View>
      ) : (
        <Ionicons name={selected ? icon : `${icon}-outline`} size={24} color={shelf.ink} style={dim} />
      )}
      <Text
        style={[styles.label, selected ? styles.labelOn : dim]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Kitaplığın açık temasında beyaz çubuk; üstünde ince bir çizgi ve yukarı düşen hafif gölge
  bar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    backgroundColor: shelf.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: shelf.hairline,
    boxShadow: '0px -6px 18px rgba(40, 32, 24, 0.05)',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingBottom: 4,
    borderRadius: 12,
  },
  pressed: {
    backgroundColor: shelf.pressed,
  },
  indicator: {
    width: 28,
    height: 3,
    marginBottom: 6,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  indicatorOn: {
    backgroundColor: colors.accent,
  },
  disabled: {
    opacity: 0.28,
  },
  dim: {
    opacity: 0.5,
  },
  label: {
    fontFamily: fonts.bodyThin,
    fontSize: type.caption,
    letterSpacing: 0.5,
    color: shelf.ink,
  },
  labelOn: {
    fontFamily: fonts.bodyBold,
  },
})
