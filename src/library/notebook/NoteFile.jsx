import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useDocumentMode } from './DocumentMode'

import { docPage, fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

const BLOCK_HEIGHT = notebook.lineHeight * 2

// Sayfaya ataçla tutturulmuş küçük kâğıt etiket; satır düzeni bozulmasın diye 2 satır yüksekliğinde
export function NoteFile({ file, onPress, onLongPress }) {
  // PDF'te etiketin adı basılı harflerle yazılır
  const document = useDocumentMode() !== null
  return (
    <View style={styles.block}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={
          onLongPress ? `${file.label} dosyasını aç, silmek için basılı tut` : `${file.label} dosyasını aç`
        }
        style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
      >
        <Text style={[styles.label, document && styles.docLabel]} numberOfLines={1}>
          {document ? file.label : file.label + HAND_TAIL}
        </Text>
        <View style={styles.clip} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    height: BLOCK_HEIGHT,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  tag: {
    maxWidth: '100%',
    paddingLeft: 22,
    paddingRight: 14,
    paddingVertical: 6,
    backgroundColor: '#FFFDF5',
    borderWidth: 1,
    borderColor: 'rgba(56, 56, 61, 0.25)',
    borderRadius: 2,
    transform: [{ rotate: '-0.8deg' }],
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.18,
    shadowRadius: 2,
    shadowOffset: { width: 1, height: 1 },
    elevation: 2,
  },
  pressed: {
    backgroundColor: '#F3EEDF',
  },
  label: {
    fontFamily: fonts.handBold,
    fontSize: 20,
    color: notebook.graphite,
    marginRight: -handTailWidth(20),
  },
  docLabel: {
    marginRight: 0,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: docPage.ink,
  },
  // Etiketin sol kenarına takılmış ataç
  clip: {
    position: 'absolute',
    left: 6,
    top: -7,
    width: 9,
    height: 26,
    borderWidth: 1.6,
    borderColor: '#8D9199',
    borderRadius: 5,
    transform: [{ rotate: '8deg' }],
  },
})
