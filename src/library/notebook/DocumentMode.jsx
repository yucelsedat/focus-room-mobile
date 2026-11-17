import { createContext, use } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { docPage, fonts, HAND_TAIL, handTailWidth } from '../theme'

export const DocumentContext = createContext(null)

export function useDocumentMode() {
  return use(DocumentContext)
}

// Belge modunda sayfa kenardan kenara yazıdır; yalnızca soldaki boşlukta bloğun tutamacı durur
export const DOC_ROW_LEFT = docPage.gutter
export const DOC_ROW_RIGHT = docPage.edge

// Bloğun tutamacı: normal defterdeki gibi kenar boşluğunda soluk, elle çekilmiş kısa bir çizgi;
// basılı tutup sürükleyince blok taşınır. Çizgi ilk satırın ortasında durur. Blok büyük bir başlıkla başlıyorsa çizgi
// o başlığın satırına ortalansın diye offset kadar aşağı iner.
export function BlockGrip({ offset = 0 }) {
  return (
    <View style={[styles.grip, offset > 0 && { marginTop: offset }]}>
      <Text style={styles.dash} accessibilityLabel="Blok">
        {'—' + HAND_TAIL}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  grip: {
    width: docPage.gutter,
    height: docPage.lineHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Normal defterin blok çizgisiyle aynı (bkz. NoteTextSegment MarginTime)
  dash: {
    // Android kırpmasın diye eklenen kuyruk payı ortalamayı bozmasın
    marginRight: -handTailWidth(22),
    fontFamily: fonts.hand,
    fontSize: 22,
    lineHeight: docPage.lineHeight,
    color: 'rgba(56, 56, 61, 0.4)',
  },
})
