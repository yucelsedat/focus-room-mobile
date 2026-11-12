// Alttan açılan sayfa (dikey ekranda başparmak erişimine uygun)
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, fonts, type, space, radius } from '../theme'

export function Sheet({ visible, onClose, eyebrow, title, children, scroll = true, footer, tall = false }) {
  const insets = useSafeAreaInsets()
  const Body = scroll ? ScrollView : View
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Kapat" />
        <View style={[styles.sheet, tall && styles.tall, { paddingBottom: (footer ? space.md : insets.bottom + space.lg) }]}>
          <View style={styles.grip} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
              {!!title && <Text style={styles.title} numberOfLines={2}>{title}</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Kapat">
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <Body
            style={styles.body}
            contentContainerStyle={scroll ? { paddingBottom: space.lg } : undefined}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </Body>
          {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + space.sm }]}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function SectionLabel({ children }) {
  return <Text style={styles.section}>{children}</Text>
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: space.lg, paddingBottom: space.md },
  eyebrow: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 1.6, color: colors.accent, textTransform: 'uppercase', marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: type.title, color: colors.text, lineHeight: type.title * 1.15 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center', marginLeft: space.md },
  closeText: { color: colors.muted, fontSize: 14, fontFamily: fonts.strong },
  body: { flexGrow: 0, flexShrink: 1 },
  tall: { maxHeight: '92%' },
  footer: { paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  section: { fontFamily: fonts.strong, fontSize: type.micro, letterSpacing: 1.4, color: colors.faint, textTransform: 'uppercase', marginTop: space.lg, marginBottom: space.sm },
})
