import Ionicons from '@expo/vector-icons/Ionicons'
import { useRef } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'

import { fonts, shelf, type } from '../theme'

// Kitaplığın başlığının altındaki yuvarlak beyaz arama çubuğu: solda büyüteç, yazı varken
// temizleme düğmesi, sağda filtre (kategori seçimi)
export function SearchBar({ value, onChange, onFilter, filterActive = false, placeholder = 'Defter ara' }) {
  const inputRef = useRef(null)
  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.bar} accessible={false}>
      <Ionicons name="search" size={19} color={shelf.ink} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={shelf.faint}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        selectionColor={shelf.ink}
        accessibilityLabel="Defter ara"
        style={styles.input}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel="Aramayı temizle"
          hitSlop={8}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={14} color={shelf.card} />
        </Pressable>
      )}
      <View style={styles.divider} />
      <Pressable
        onPress={onFilter}
        accessibilityRole="button"
        accessibilityLabel="Filtre"
        accessibilityHint="Kategori seç"
        hitSlop={6}
        style={({ pressed }) => [styles.filter, pressed && styles.filterPressed]}
      >
        <Ionicons name="options-outline" size={21} color={shelf.ink} />
        {filterActive && <View style={styles.dot} />}
      </Pressable>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: 50,
    marginHorizontal: 20,
    paddingLeft: 16,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 25,
    backgroundColor: shelf.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: shelf.hairline,
    boxShadow: '0px 6px 18px rgba(40, 32, 24, 0.07), 0px 1px 3px rgba(40, 32, 24, 0.05)',
  },
  input: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    fontFamily: fonts.docBody,
    fontSize: type.body,
    color: shelf.ink,
  },
  clear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: shelf.faint,
  },
  pressed: {
    opacity: 0.6,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: shelf.hairline,
  },
  filter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPressed: {
    backgroundColor: shelf.pressed,
  },
  // Genel dışında bir kategori seçiliyken filtrenin köşesinde küçük bir nokta
  dot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1.5,
    borderColor: shelf.card,
    backgroundColor: '#C8553D',
  },
})
