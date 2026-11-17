import { useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Svg, { ClipPath, Defs, G, Line, Path } from 'react-native-svg'

import { HandCheckbox } from '../notebook/HandCheckbox'
import { colors, fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

// Yırtık kenarın dişlerinin derinliği; içerik bu kadar içeriden başlar
const TEAR = 6
// Kırmızı kenar boşluğu çizgisinin yeri ve satır yüksekliği; kâğıda başka içerik konunca
// (children) o da bu satırlara yazılır
export const PAPER_MARGIN = 30
export const PAPER_LINE = 46
const MARGIN = PAPER_MARGIN
const LINE = PAPER_LINE
const TITLE_SIZE = 30
const MESSAGE_SIZE = 21
const OPTION_SIZE = 27

// Her açılışta kâğıt aynı yerinden yırtılmış görünsün diye sabit tohumlu rastgele sayı üreteci
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// Soldan sağa dişli bir kenar: base çizgisinin iki yanında TEAR kadar oynayan noktalar
function tornEdge(rand, width, base) {
  const points = []
  for (let x = 0; x < width; x += 5 + rand() * 9) {
    points.push([x, base + (rand() - 0.5) * TEAR])
  }
  points.push([width, base + (rand() - 0.5) * TEAR])
  return points
}

// Defterden yırtılmış kâğıt parçası: üstü ve altı dişli, yanları düz
function paperShape(width, height, seed) {
  const rand = seeded(seed)
  const top = tornEdge(rand, width, TEAR / 2)
  const bottom = tornEdge(rand, width, height - TEAR / 2).reverse()
  const toPath = (points) => points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')
  return {
    outline: `M${toPath(top)} L${toPath(bottom)} Z`,
    // Yırtılan yerde kâğıdın lifleri açık renkte görünür
    edges: [`M${toPath(top)}`, `M${toPath(bottom)}`],
  }
}

// El yazısıyla yazılmış seçenekler (ör. kitaplıktaki bir defterin), yırtık kâğıt parçasında
export function TornPaperMenu({ visible, title, message, options = [], children, onClose }) {
  const window = useWindowDimensions()
  const width = Math.min(window.width - 64, 300)
  const [height, setHeight] = useState(0)
  const shape = useMemo(() => height > 0 && paperShape(width, height, 7), [width, height])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Android'de Modal ayrı bir pencerede açılır; kâğıttaki sürüklemeler (ör. kategorilerin
          sırası) çalışsın diye içi ayrıca gesture-handler köküyle sarılır */}
      <GestureHandlerRootView style={styles.root}>
        {/* Kâğıtta yazı alanı varsa (ör. saat) klavye açılınca kâğıt klavyenin üstüne kayar */}
        <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Kapat" />
          <View style={[styles.paper, { width }]} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
            {shape && (
              // Gölge kâğıdın sağına ve altına taşar; çizim alanı kâğıttan biraz büyük
              <Svg style={styles.drawing} width={width + 8} height={height + 8} pointerEvents="none">
                <Defs>
                  <ClipPath id="torn">
                    <Path d={shape.outline} />
                  </ClipPath>
                </Defs>
                <Path d={shape.outline} fill="#000" opacity={0.35} translateX={4} translateY={7} />
                <Path d={shape.outline} fill={notebook.paper} />
                <G clipPath="url(#torn)">
                  <Line
                    x1={MARGIN}
                    y1={0}
                    x2={MARGIN}
                    y2={height}
                    stroke={notebook.margin}
                    strokeWidth={1.5}
                  />
                </G>
                {shape.edges.map((d) => (
                  <Path key={d} d={d} fill="none" stroke="#FFFFFF" strokeWidth={2} opacity={0.8} />
                ))}
              </Svg>
            )}

            <View style={styles.heading}>
              <Text style={[styles.hand, styles.title]} numberOfLines={2}>
                {title + HAND_TAIL}
              </Text>
              {message && <Text style={[styles.hand, styles.message]}>{message + HAND_TAIL}</Text>}
            </View>
            {children}
            {options.map((option, i) => (
              <Pressable
                key={option.label}
                onPress={option.onPress}
                accessibilityRole={option.checked === undefined ? 'button' : 'checkbox'}
                accessibilityState={option.checked === undefined ? undefined : { checked: option.checked }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [
                  styles.option,
                  option.checked !== undefined && styles.checkOption,
                  i === options.length - 1 && styles.lastOption,
                  pressed && styles.optionPressed,
                ]}
              >
                {option.checked !== undefined && (
                  <View style={styles.checkbox}>
                    <HandCheckbox checked={option.checked} tilt={i % 2 === 0 ? -3 : 2} />
                  </View>
                )}
                <Text style={[styles.hand, styles.optionText, option.danger && styles.danger]}>
                  {option.label + HAND_TAIL}
                </Text>
              </Pressable>
            ))}
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 16, 12, 0.55)',
  },
  paper: {
    paddingTop: TEAR + 14,
    paddingBottom: TEAR + 18,
    transform: [{ rotate: '-2deg' }],
  },
  drawing: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  heading: {
    paddingLeft: MARGIN + 12,
    paddingRight: 16,
    paddingBottom: 6,
  },
  hand: {
    alignSelf: 'flex-start',
    color: notebook.graphite,
  },
  title: {
    fontFamily: fonts.handBold,
    fontSize: TITLE_SIZE,
    marginRight: -handTailWidth(TITLE_SIZE),
  },
  message: {
    fontFamily: fonts.hand,
    fontSize: MESSAGE_SIZE,
    marginRight: -handTailWidth(MESSAGE_SIZE),
  },
  // Seçenekler kâğıdın mavi satırlarının üstüne yazılır
  option: {
    height: LINE,
    justifyContent: 'flex-end',
    paddingLeft: MARGIN + 12,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: notebook.rule,
  },
  checkOption: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 10,
    paddingLeft: MARGIN + 8,
  },
  checkbox: {
    paddingBottom: 8,
  },
  lastOption: {
    borderBottomWidth: 1,
    borderBottomColor: notebook.rule,
  },
  optionPressed: {
    backgroundColor: 'rgba(56, 56, 61, 0.08)',
  },
  optionText: {
    fontFamily: fonts.handBold,
    fontSize: OPTION_SIZE,
    marginRight: -handTailWidth(OPTION_SIZE),
  },
  danger: {
    color: colors.accent,
  },
})
