import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { ScrollView } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'

import { HandIcon } from './HandIcon'

import {
  colors,
  fonts,
  HAND_TAIL,
  handTailWidth,
  highlightFill,
  highlighterOf,
  inkOf,
  notebook,
} from '../theme'

export const BAR_HEIGHT = 46

// Sayfanın altındaki ince çubuk: kalem rengi, keçeli kalem (fosforlu kalem), mikrofon (sesle
// yazma), saat (bloğa o anki saati koyar ya da kaldırır), saat ayarı (bloğun saatini elle yazar),
// kutu (yapılacak), numaralı liste ve ataç (ek)
export function BottomBar({
  bottomInset,
  listening,
  pen,
  onSwatchPress,
  onHighlighterPress,
  onMicPress,
  onClockPress,
  onClockEditPress,
  onCheckPress,
  onNumberPress,
  onClipPress,
}) {
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      <BarRule />
      <ToolRow>
        <HandIcon
          shape="swatch"
          label="Kalem rengi"
          onPress={onSwatchPress}
          size={30}
          fill={pen.active ? highlighterOf(pen.color).color : inkOf(pen.ink).color}
        />
        <HandIcon
          shape="highlighter"
          label={pen.active ? 'Fosforlu kalemi bırak' : 'Fosforlu kalem'}
          onPress={onHighlighterPress}
          size={30}
          selected={pen.active}
          fill={pen.active ? highlightFill(pen.color, 0.8) : undefined}
        />
        <MicButton listening={listening} onPress={onMicPress} />
        <HandIcon shape="clock" label="Bloğa saat koy" onPress={onClockPress} size={30} />
        <HandIcon shape="clockEdit" label="Saati ayarla" onPress={onClockEditPress} size={30} />
        <HandIcon shape="checkbox" label="Yapılacak satırı" onPress={onCheckPress} size={30} />
        <HandIcon shape="numbered" label="Numaralı liste" onPress={onNumberPress} size={30} />
        <HandIcon shape="clip" label="Ek ekle" onPress={onClipPress} size={30} />
      </ToolRow>
    </View>
  )
}

// Alt çubuğun düğme satırı: düğmeler sığarsa çubuğa eşit aralıklarla yayılır, sığmazsa (dar ekran,
// büyük yazı boyu) satır yatayda kaydırılır. Kaydırma gesture-handler'ındır ki çubuğun üstünde
// yana sürükleyince sayfa çevrilmesin. Klavye açıkken düğmeye basmak klavyeyi kapatmaz.
export function ToolRow({ children }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={styles.toolScroll}
      contentContainerStyle={styles.toolRow}
    >
      {children}
    </ScrollView>
  )
}

// Üst kenarda elle çekilmiş ince çizgi
export function BarRule() {
  const { width } = useWindowDimensions()
  return (
    <Svg style={styles.rule} width={width} height={6} pointerEvents="none">
      <Path
        d={`M6 3.2 Q${width * 0.3} 1.8 ${width * 0.55} 3.4 T${width - 6} 2.6`}
        stroke={notebook.graphite}
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
        opacity={0.55}
      />
    </Svg>
  )
}

// Blok seçimi açıkken alt çubuk: yazma araçlarının yerine seçili bloklarla yapılacak işler
export function SelectionBar({
  bottomInset,
  count,
  notice,
  onCopy,
  onCut,
  onDuplicate,
  onDelete,
  noun = 'blok',
  idle = 'blok seç',
}) {
  const none = count === 0
  const label = notice ?? (none ? idle : `${count} ${noun}`)
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      <BarRule />
      <View style={styles.selectionRow}>
        <Text style={[styles.count, none && !notice && styles.countIdle]} numberOfLines={1}>
          {label + HAND_TAIL}
        </Text>
        <View style={styles.selectionIcons}>
          <HandIcon shape="copy" label="Kopyala" onPress={onCopy} size={30} disabled={none} />
          <HandIcon shape="cut" label="Kes" onPress={onCut} size={30} disabled={none} />
          <HandIcon shape="duplicate" label="Çoğalt" onPress={onDuplicate} size={30} disabled={none} />
          <HandIcon
            shape="trash"
            label="Sil"
            onPress={onDelete}
            size={30}
            color={none ? undefined : colors.accent}
            disabled={none}
          />
        </View>
      </View>
    </View>
  )
}

function MicButton({ listening, onPress }) {
  const pulse = useSharedValue(0)

  useEffect(() => {
    if (listening) {
      pulse.set(withRepeat(withTiming(1, { duration: 1000, easing: Easing.out(Easing.quad) }), -1))
    } else {
      cancelAnimation(pulse)
      pulse.set(0)
    }
  }, [listening, pulse])

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - pulse.get()),
    transform: [{ scale: 0.7 + 0.6 * pulse.get() }],
  }))

  return (
    <View style={styles.micWrap}>
      {listening && <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />}
      <HandIcon
        shape="mic"
        label={listening ? 'Dinlemeyi durdur' : 'Sesle yaz'}
        onPress={onPress}
        size={30}
        color={listening ? colors.accent : undefined}
      />
    </View>
  )
}

// Ataca basınca çıkan, el yazısıyla yazılmış küçük kâğıt menü
export function AttachMenu({ bottom, options, onClose }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Menüyü kapat" />
      <View style={[styles.menu, { bottom }]}>
        {options.map((option, i) => (
          <Pressable
            key={option.label}
            onPress={option.onPress}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.option,
              i > 0 && styles.optionDivider,
              pressed && styles.optionPressed,
            ]}
          >
            <Text style={styles.optionText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: notebook.paper,
  },
  rule: {
    position: 'absolute',
    top: -3,
    left: 0,
  },
  toolScroll: {
    height: BAR_HEIGHT,
    flexGrow: 0,
  },
  toolRow: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap: 8,
    paddingHorizontal: 10,
  },
  selectionRow: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 10,
  },
  count: {
    flexShrink: 1,
    marginRight: 8 - handTailWidth(22),
    fontFamily: fonts.handBold,
    fontSize: 22,
    color: notebook.graphite,
  },
  countIdle: {
    fontFamily: fonts.hand,
    color: 'rgba(56, 56, 61, 0.5)',
  },
  selectionIcons: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  micWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
  },
  menu: {
    position: 'absolute',
    alignSelf: 'center',
    minWidth: 220,
    paddingVertical: 4,
    backgroundColor: '#FFFDF5',
    borderWidth: 1,
    borderColor: 'rgba(56, 56, 61, 0.25)',
    borderRadius: 3,
    transform: [{ rotate: '-1deg' }],
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 1, height: 3 },
    elevation: 6,
  },
  option: {
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  optionDivider: {
    borderTopWidth: 1,
    borderTopColor: notebook.rule,
  },
  optionPressed: {
    backgroundColor: '#F3EEDF',
  },
  optionText: {
    fontFamily: fonts.handBold,
    fontSize: 22,
    color: notebook.graphite,
  },
})
