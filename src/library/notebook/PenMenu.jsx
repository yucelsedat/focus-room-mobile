import { Pressable, StyleSheet, Text, View } from 'react-native'

import { HandDrawing } from './HandIcon'
import { HighlightStroke } from './HighlightStroke'
import { TornPaperMenu } from '../components/TornPaperMenu'

import { fonts, HAND_TAIL, handTailWidth, highlighters, inks, notebook } from '../theme'

const SIZE = 56
const LETTER_SIZE = 42

// Kalem rengi: yırtık kâğıda yazılmış "A" harfleri. Üstte her biri başka renk kalemle yazılmış,
// altta her birinin üstünden başka renk fosforlu kalem geçmiş. Yazı kalemi seçilince fosforlu
// kalem bırakılır; fosforlu kalem seçilince o renkle açılır.
export function PenMenu({ visible, pen, onChange, onClose }) {
  function choose(next) {
    onChange(next)
    onClose()
  }

  return (
    <TornPaperMenu visible={visible} title="Kalem rengi" onClose={onClose}>
      <Text style={styles.section}>{'Yazı kalemi' + HAND_TAIL}</Text>
      <View style={styles.samples}>
        {inks.map((ink) => (
          <Sample
            key={ink.key}
            name={ink.name}
            letterColor={ink.color}
            selected={pen.ink === ink.key}
            onPress={() => choose({ ...pen, ink: ink.key, active: false })}
          />
        ))}
      </View>

      <Text style={styles.section}>{'Fosforlu kalem' + HAND_TAIL}</Text>
      <View style={styles.samples}>
        {highlighters.map((highlighter, i) => (
          <Sample
            key={highlighter.key}
            name={`${highlighter.name} fosforlu kalem`}
            strokeColor={highlighter.color}
            seed={i * 31 + 7}
            selected={pen.active && pen.color === highlighter.key}
            onPress={() => choose({ ...pen, active: true, color: highlighter.key })}
          />
        ))}
      </View>
    </TornPaperMenu>
  )
}

// Seçili örneğin çevresine elle halka çizilir
function Sample({ name, letterColor = notebook.graphite, strokeColor, seed = 0, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      style={({ pressed }) => [styles.sample, pressed && styles.pressed]}
    >
      {strokeColor && (
        <HighlightStroke
          width={38}
          height={24}
          color={strokeColor}
          strength={0.6}
          seed={seed}
          style={styles.stroke}
        />
      )}
      <Text style={[styles.letter, { color: letterColor }]}>{'A' + HAND_TAIL}</Text>
      {selected && (
        <View style={styles.ring} pointerEvents="none">
          <HandDrawing shape="ring" size={SIZE} />
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Kâğıdın kırmızı kenar çizgisinin sağından başlar (bkz. TornPaperMenu)
  section: {
    alignSelf: 'flex-start',
    marginLeft: 42,
    marginRight: -handTailWidth(20),
    fontFamily: fonts.hand,
    fontSize: 20,
    color: 'rgba(56, 56, 61, 0.6)',
  },
  samples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    paddingLeft: 42,
    paddingRight: 12,
    paddingBottom: 6,
  },
  sample: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SIZE / 2,
  },
  pressed: {
    backgroundColor: 'rgba(56, 56, 61, 0.08)',
  },
  // Harfin alt yarısından geçen kalem
  stroke: {
    top: 26,
    left: (SIZE - 38) / 2,
  },
  letter: {
    marginRight: -handTailWidth(LETTER_SIZE),
    fontFamily: fonts.handBold,
    fontSize: LETTER_SIZE,
    lineHeight: 50,
  },
  ring: {
    position: 'absolute',
  },
})
