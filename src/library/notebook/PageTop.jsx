import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DOC_ROW_LEFT, DOC_ROW_RIGHT, useDocumentMode } from './DocumentMode'
import { HandIcon } from './HandIcon'
import { colors, docPage, fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

// Sayfanın üstündeki el çizimi düğmeler: solda geri, sağda okuma modu, ayraç, takvim ya da arama,
// filtre, çizim ve en sağda sayfanın ayarları
export function PageTopBar({
  reading,
  onReadingChange,
  favorite,
  onCalendarPress,
  onSearchPress,
  filtering,
  onFilterPress,
  selecting = false,
  onSelectingChange,
  paste,
  drawing = false,
  onDrawingChange,
  onMorePress,
}) {
  const insets = useSafeAreaInsets()
  if (drawing) {
    return (
      <View style={[styles.top, { paddingTop: insets.top + 4 }]}>
        <View style={styles.placeholder} />
      </View>
    )
  }
  // Ajandada sağda sekiz düğme olabilir; 360 dp'lik ekrana sığsınlar diye aralar daralır
  const count = [
    onSelectingChange,
    paste,
    true,
    favorite,
    onCalendarPress,
    onSearchPress,
    onFilterPress,
    onDrawingChange,
    onMorePress,
  ].filter(Boolean).length
  return (
    <View style={[styles.top, { paddingTop: insets.top + 4 }]}>
      <HandIcon
        shape="back"
        label="Geri dön"
        size={28}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <View style={[styles.topActions, count >= 8 && styles.topActionsTight]}>
        {onSelectingChange && (
          <HandIcon
            shape="select"
            label={selecting ? 'Blok seçimini kapat' : 'Blok seç'}
            size={28}
            selected={selecting}
            color={selecting ? notebook.selectionInk : undefined}
            onPress={() => onSelectingChange(!selecting)}
          />
        )}
        {paste && <PasteButton {...paste} />}
        <HandIcon
          shape="book"
          label={reading ? 'Okuma modunu kapat' : 'Okuma modu'}
          size={28}
          selected={reading}
          fill={reading ? notebook.readingFill : undefined}
          onPress={() => onReadingChange?.(!reading)}
        />
        {favorite && (
          <HandIcon
            shape="bookmark"
            label={favorite.on ? 'Ayracı kaldır' : 'Ayraç koy'}
            size={28}
            selected={favorite.on}
            fill={favorite.on ? notebook.bookmarkFill : undefined}
            onPress={favorite.onPress}
          />
        )}
        {onCalendarPress && <HandIcon shape="calendar" label="Takvim" size={28} onPress={onCalendarPress} />}
        {onSearchPress && (
          <HandIcon shape="search" label="Sayfalarda ara" size={28} onPress={onSearchPress} />
        )}
        {onFilterPress && (
          <HandIcon
            shape="filter"
            label={filtering ? 'Filtreyi değiştir' : 'Sayfaları filtrele'}
            size={28}
            selected={filtering}
            fill={filtering ? notebook.filterFill : undefined}
            onPress={onFilterPress}
          />
        )}
        {onDrawingChange && (
          <HandIcon shape="brush" label="Çizim modu" size={28} onPress={() => onDrawingChange(true)} />
        )}
        {onMorePress && <HandIcon shape="more" label="Sayfa ayarları" size={28} onPress={onMorePress} />}
      </View>
    </View>
  )
}

// Panodakini yapıştırır; basılı tutunca pano boşaltılır
export function PasteButton({ onPress, onLongPress, label = 'Kopyalanan blokları yapıştır' }) {
  const pulse = useSharedValue(0)

  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1))
    return () => cancelAnimation(pulse)
  }, [pulse])

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.get()),
    transform: [{ scale: 1 + 1.6 * pulse.get() }],
  }))

  return (
    <View>
      <HandIcon
        shape="paste"
        label={label}
        size={28}
        color={colors.accent}
        onPress={onPress}
        onLongPress={onLongPress}
      />
      <View pointerEvents="none" style={styles.badge}>
        <Animated.View style={[styles.badgeHalo, haloStyle]} />
        <View style={styles.badgeDot} />
      </View>
    </View>
  )
}

export function PageHeading({ heading, onTitleChange, onTitleSubmit, readOnly = false }) {
  // PDF'te başlık beyaz kâğıdın üstünde basılı harflerle yazılır
  const document = useDocumentMode() !== null
  return (
    <View style={[styles.header, document && styles.docHeader]}>
      <View style={styles.titleRow}>
        {heading && onTitleChange ? (
          <TitleInput
            title={heading.title}
            onChange={onTitleChange}
            onSubmit={onTitleSubmit}
            readOnly={readOnly}
            document={document}
          />
        ) : (
          // "2. Hafta Değerlendirme" gibi uzun başlıklar tek satıra sığacak kadar küçülür
          <Text
            style={[styles.title, document && styles.docTitle]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {heading ? heading.title + HAND_TAIL : ''}
          </Text>
        )}
        {heading?.now && (
          <View style={styles.today}>
            <View style={styles.todayDot} />
            <Text style={styles.todayText}>{heading.now + HAND_TAIL}</Text>
          </View>
        )}
      </View>
      {heading && (
        <Text style={[styles.meta, document && styles.docMeta]}>
          {document ? heading.meta : heading.meta + HAND_TAIL}
        </Text>
      )}
    </View>
  )
}

// Yazılan başlığın kademeleri: tek satıra sığmayan başlık küçülüp iki satıra, ona da sığmayan daha
// da küçülüp üç satıra iner. Başlık alanı hep tek satırın yüksekliğindedir (TITLE_HEIGHT); iki ve üç
// satır da bu alanın içine sıkı satır aralığıyla dizilir.
const TITLE_HEIGHT = 62
const TITLE_TIERS = [
  { lines: 1, fontSize: 46, lineHeight: 62 },
  { lines: 2, fontSize: 28, lineHeight: 29 },
  { lines: 3, fontSize: 19, lineHeight: 20 },
]

// PDF'te başlık Fraunces'le, daha küçük kademelerle yazılır
const DOC_TITLE_HEIGHT = 46
const DOC_TITLE_TIERS = [
  { lines: 1, fontSize: 30, lineHeight: 44 },
  { lines: 2, fontSize: 20, lineHeight: 22 },
  { lines: 3, fontSize: 14, lineHeight: 15 },
]

// Başlığın hangi kademeye sığdığı görünmez kopyalarla ölçülür: her kademenin boyunda yazı sınırsız
// satırla dizilir, satır sayısı kademenin satırlarını aşmayan ilk kademe seçilir. Boy yalnızca yazıya
// ve genişliğe bağlıdır; ölçüm gelene kadar önceki kademe kalır, yazarken başlık zıplamaz.
function TitleInput({ title, onChange, onSubmit, readOnly, document = false }) {
  const tiers = document ? DOC_TITLE_TIERS : TITLE_TIERS
  const [width, setWidth] = useState(null)
  const key = `${width}|${title}`
  // Her kademenin ölçülen satır sayısı ve seçilen kademe; ölçüm tamamlanana kadar önceki kademe kalır
  const [fit, setFit] = useState({
    key: '',
    lines: [null, null, null],
    tier: 0,
  })
  const tier = tiers[title === '' ? 0 : fit.tier]
  const sized = { fontSize: tier.fontSize, lineHeight: tier.lineHeight }

  return (
    <View
      style={styles.titleBox}
      onLayout={(e) => {
        const next = e.nativeEvent.layout.width
        setWidth((prev) => (prev === next ? prev : next))
      }}
    >
      <TextInput
        value={title}
        // Başlık tek paragraftır; yapıştırılan satır sonları boşluğa döner
        onChangeText={(text) => onChange(text.replace(/\s*\n\s*/g, ' '))}
        editable={!readOnly}
        placeholder={readOnly ? '' : 'Başlık'}
        placeholderTextColor={document ? docPage.faint : 'rgba(56, 56, 61, 0.25)'}
        accessibilityLabel="Sayfanın başlığı"
        maxLength={60}
        multiline
        scrollEnabled={false}
        // Enter satır açmaz: başlık biter, sayfanın ilk satırında blok açılır
        submitBehavior={onSubmit ? 'submit' : 'blurAndSubmit'}
        onSubmitEditing={onSubmit}
        returnKeyType={onSubmit ? 'next' : 'done'}
        style={[styles.titleInput, document && styles.docTitleInput, sized]}
      />
      {width !== null && title !== '' && (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.titleMirror, { width }]}
        >
          {tiers.map((t, i) => (
            <Text
              // Yazı ya da genişlik değişince kopya yeniden kurulur ki satırları mutlaka bildirilsin
              key={`${i}|${key}`}
              style={[
                styles.titleMeasure,
                document && styles.docTitleMeasure,
                { fontSize: t.fontSize, lineHeight: t.lineHeight },
              ]}
              onTextLayout={(e) => {
                const count = e.nativeEvent.lines.length
                setFit((prev) => {
                  const base = prev.key === key ? prev.lines : [null, null, null]
                  if (prev.key === key && base[i] === count) return prev
                  const lines = base.map((n, j) => (j === i ? count : n))
                  if (lines.some((n) => n === null)) return { key, lines, tier: prev.tier }
                  const first = tiers.findIndex((tt, j) => lines[j] <= tt.lines)
                  return { key, lines, tier: first === -1 ? tiers.length - 1 : first }
                })
              }}
            >
              {title}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  topActions: {
    flexDirection: 'row',
    gap: 12,
  },
  topActionsTight: {
    gap: 7,
  },
  // Çizim modunda düğmelerin yüksekliği kadar boşluk: sayfanın başlığı yerinden oynamaz
  placeholder: {
    height: 32,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: -2,
    width: 9,
    height: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeHalo: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.accent,
  },
  badgeDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: notebook.paper,
  },
  header: {
    paddingLeft: notebook.marginX + 12,
    paddingRight: 20,
    paddingBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  today: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  todayDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.today,
  },
  todayText: {
    fontFamily: fonts.handBold,
    fontSize: 22,
    color: colors.today,
  },
  // Harfler yukarıdan aşağı ~1,29 em yer kaplar ("Ç"nin kuyruğu, büyük harflerin tepesi); satır
  // onları içine alacak kadar yüksek, fazlası eksi kenar boşluğuyla geri alınır ki başlık yerinde kalsın
  title: {
    flexShrink: 1,
    marginVertical: -6,
    marginRight: -handTailWidth(46),
    fontFamily: fonts.handBold,
    fontSize: 46,
    lineHeight: 62,
    color: 'rgba(56, 56, 61, 0.9)',
  },
  titleBox: {
    flex: 1,
  },
  // Yazılan başlık: tek satırda düz başlıkla aynı yazı ve aynı yükseklik; uzadıkça kademesine göre
  // küçülüp aynı yükseklikteki alanda iki ya da üç satıra iner, satırlar alanın ortasında durur
  titleInput: {
    marginVertical: -6,
    height: TITLE_HEIGHT,
    padding: 0,
    // iOS'ta çok satırlı yazı alanının kendi üst boşluğu var
    paddingTop: 0,
    textAlignVertical: 'center',
    fontFamily: fonts.handBold,
    color: 'rgba(56, 56, 61, 0.9)',
  },
  // Kademeleri ölçen görünmez kopyalar başlığın genişliğinde dizilir
  titleMirror: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
  },
  titleMeasure: {
    fontFamily: fonts.handBold,
  },
  meta: {
    fontFamily: fonts.hand,
    fontSize: 19,
    color: 'rgba(56, 56, 61, 0.6)',
  },
  docHeader: {
    paddingLeft: DOC_ROW_LEFT,
    paddingRight: DOC_ROW_RIGHT,
    paddingBottom: 16,
  },
  docTitle: {
    marginVertical: 0,
    marginRight: 0,
    fontFamily: fonts.displayBold,
    fontSize: 30,
    lineHeight: 40,
    color: docPage.ink,
  },
  docTitleInput: {
    marginVertical: 0,
    height: DOC_TITLE_HEIGHT,
    fontFamily: fonts.displayBold,
    color: docPage.ink,
  },
  docTitleMeasure: {
    fontFamily: fonts.displayBold,
  },
  docMeta: {
    marginTop: 2,
    fontFamily: fonts.bodyThin,
    fontSize: 12,
    letterSpacing: 1,
    color: docPage.muted,
  },
})
