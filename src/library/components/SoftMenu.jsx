import Ionicons from '@expo/vector-icons/Ionicons'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors, fonts, shelf, type } from '../theme'

// Kitaplığın açık temasındaki menü: ekranın altından açılan yuvarlak köşeli beyaz kart. Seçenekler
// TornPaperMenu'dekiyle aynı biçimdedir: { label, icon?, danger?, checked?, disabled?, onPress }
export function SoftMenu({ visible, title, message, options = [], onClose }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Kapat" accessibilityRole="button">
        <Pressable style={[styles.sheet, { marginBottom: 12 + insets.bottom }]} accessible={false}>
          <View style={styles.grip} />
          {!!title && (
            <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
          )}
          {!!message && <Text style={styles.message}>{message}</Text>}
          <View style={styles.options}>
            {options.map((option, i) => (
              <Pressable
                key={`${option.label}-${i}`}
                onPress={option.onPress}
                disabled={option.disabled}
                accessibilityRole="button"
                accessibilityState={{ selected: option.checked, disabled: option.disabled }}
                style={({ pressed }) => [
                  styles.option,
                  i > 0 && styles.optionDivider,
                  pressed && styles.optionPressed,
                  option.disabled && styles.optionDisabled,
                ]}
              >
                {option.icon && (
                  <View style={[styles.iconWell, option.danger && styles.iconWellDanger]}>
                    <Ionicons name={option.icon} size={18} color={option.danger ? colors.accent : shelf.ink} />
                  </View>
                )}
                <Text style={[styles.label, option.danger && styles.labelDanger]} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.checked && <Ionicons name="checkmark" size={20} color={shelf.ink} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(22, 22, 26, 0.32)',
  },
  sheet: {
    marginHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 8,
    borderRadius: 28,
    backgroundColor: shelf.card,
    boxShadow: '0px 18px 40px rgba(22, 22, 26, 0.22)',
  },
  grip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
    backgroundColor: shelf.hairline,
  },
  title: {
    paddingHorizontal: 14,
    fontFamily: fonts.displayBold,
    fontSize: type.title,
    color: shelf.ink,
  },
  message: {
    paddingHorizontal: 14,
    marginTop: 4,
    fontFamily: fonts.bodyThin,
    fontSize: type.body,
    color: shelf.muted,
  },
  options: {
    marginTop: 10,
  },
  option: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  optionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: shelf.hairline,
  },
  optionPressed: {
    backgroundColor: shelf.pressed,
  },
  optionDisabled: {
    opacity: 0.35,
  },
  iconWell: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: shelf.wall,
  },
  iconWellDanger: {
    backgroundColor: 'rgba(200, 85, 61, 0.1)',
  },
  label: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    color: shelf.ink,
  },
  labelDanger: {
    color: colors.accent,
  },
})
