import Ionicons from '@expo/vector-icons/Ionicons'
import { Pressable, StyleSheet } from 'react-native'

import { colors } from '../theme'

// Kitaplıkta yeni defter, panoda yeni not açan yuvarlak buton; ekranın sağ alt köşesinde durur
export function AddButton({ label, hint, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
    >
      <Ionicons name="add" size={30} color={colors.onInk} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    boxShadow: '0px 6px 12px rgba(0, 0, 0, 0.5)',
  },
  fabPressed: {
    transform: [{ scale: 0.94 }],
  },
})
