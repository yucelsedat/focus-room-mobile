import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { G, Line, Path } from 'react-native-svg'
import { scheduleOnRN } from 'react-native-worklets'

import { HandDrawing, HandIcon } from './HandIcon'
import { colors, fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

// Yırtık kenarın dişlerinin derinliği; kâğıt bu kadar içeriden başlar
const TEAR = 7
// Kırmızı kenar boşluğu çizgisinin yeri; simgeler ve yazılar onun sağına yazılır
const MARGIN = 34
// Gölge kâğıdın soluna düşer; çizim alanı kâğıttan bu kadar sola taşar
const SHADOW = 14
const TITLE_SIZE = 34
const SUBTITLE_SIZE = 19
const LABEL_SIZE = 25
const HINT_SIZE = 17

// Her açılışta kâğıt aynı yerinden yırtılmış görünsün diye sabit tohumlu rastgele sayı üreteci
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// Defterden boydan boya yırtılmış şerit: sol kenarı dişli, öbür kenarları ekranın kenarında
function stripShape(width, height) {
  const rand = seeded(11)
  const points = []
  for (let y = 0; y < height; y += 5 + rand() * 9) {
    points.push([TEAR / 2 + (rand() - 0.5) * TEAR, y])
  }
  points.push([TEAR / 2 + (rand() - 0.5) * TEAR, height])
  const edge = points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')
  return {
    outline: `M${width} 0 L${edge} L${width} ${height} Z`,
    // Yırtılan yerde kâğıdın lifleri açık renkte görünür
    edge: `M${edge}`,
  }
}

// Sayfanın ayarları: üst çubuktaki üç noktaya basınca ekranın sağına dayalı, defterden yırtılmış
// bir şerit sağ üst köşeden içeri döner. Seçilen iş şerit kapanınca yapılır (ör. soru penceresi
// kapanmakta olan pencerenin üstünde açılmasın).
export function PageSidebar({ visible, title, subtitle, sections, onClose }) {
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const width = Math.min(Math.round(window.width * 0.8), 330)
  const height = window.height
  const shape = useMemo(() => stripShape(width, height), [width, height])
  const progress = useSharedValue(0)
  const pending = useRef(null)

  // Kapanırken şerit dışarı dönene kadar pencere açık kalır
  const [shown, setShown] = useState(visible)
  if (visible && !shown) setShown(true)

  useEffect(() => {
    if (visible) {
      progress.set(withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }))
    } else {
      progress.set(
        withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) }, (finished) => {
          if (finished) scheduleOnRN(setShown, false)
        }),
      )
    }
  }, [visible, progress])

  // Pencere kapanınca seçilen iş yapılır
  useEffect(() => {
    if (shown) return
    const action = pending.current
    pending.current = null
    action?.()
  }, [shown])

  function choose(item) {
    pending.current = item.onPress
    onClose()
  }

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }))

  // Sağ üst köşesinden menteşeli gibi döner: alt ucu dışarıdan gelir
  const panelStyle = useAnimatedStyle(() => {
    const rest = 1 - progress.get()
    return {
      transform: [{ translateX: rest * (width + SHADOW) }, { rotate: `${-rest * 6}deg` }],
    }
  })

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Kapat" />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            { width, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 16 },
            panelStyle,
          ]}
        >
          <Svg style={styles.drawing} width={width + SHADOW} height={height} pointerEvents="none">
            <G translateX={SHADOW}>
              <Path d={shape.outline} fill="#000" opacity={0.3} translateX={-6} />
              <Path d={shape.outline} fill={notebook.paper} />
              <Line x1={MARGIN} y1={0} x2={MARGIN} y2={height} stroke={notebook.margin} strokeWidth={1.5} />
              <Path d={shape.edge} fill="none" stroke="#FFFFFF" strokeWidth={2} opacity={0.8} />
            </G>
          </Svg>

          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>
                {title + HAND_TAIL}
              </Text>
              <HandIcon shape="close" label="Ayarları kapat" size={26} onPress={onClose} />
            </View>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle + HAND_TAIL}
              </Text>
            ) : null}
          </View>

          {sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title.toLocaleUpperCase('tr')}</Text>
              {section.items.map((item, i) => (
                <SidebarRow
                  key={item.label}
                  item={item}
                  last={i === section.items.length - 1}
                  onPress={() => choose(item)}
                />
              ))}
            </View>
          ))}
        </Animated.View>
      </View>
    </Modal>
  )
}

// Şeridin mavi satırlarına yazılmış bir iş: simgesi ve adı, altında ne yapacağı
function SidebarRow({ item, last, onPress }) {
  const ink = item.disabled ? FADED : item.danger ? colors.accent : notebook.graphite
  return (
    <Pressable
      onPress={onPress}
      disabled={item.disabled}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityHint={item.hint}
      accessibilityState={item.disabled ? { disabled: true } : undefined}
      style={({ pressed }) => [styles.row, last && styles.lastRow, pressed && styles.rowPressed]}
    >
      <HandDrawing shape={item.icon} size={28} color={ink} />
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: ink }]}>{item.label + HAND_TAIL}</Text>
        {item.hint ? (
          <Text style={[styles.hint, item.disabled && styles.hintFaded]}>{item.hint + HAND_TAIL}</Text>
        ) : null}
      </View>
    </Pressable>
  )
}

// El yazısına opacity verilmez (bkz. theme HAND_TAIL); soluk yazı rengin saydamlığıyla yazılır
const FADED = 'rgba(56, 56, 61, 0.3)'

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: 'rgba(20, 16, 12, 0.45)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    transformOrigin: 'right top',
  },
  drawing: {
    position: 'absolute',
    top: 0,
    left: -SHADOW,
  },
  header: {
    paddingLeft: MARGIN + 12,
    paddingRight: 10,
    paddingBottom: 18,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontFamily: fonts.handBold,
    fontSize: TITLE_SIZE,
    lineHeight: TITLE_SIZE * 1.3,
    marginRight: -handTailWidth(TITLE_SIZE),
    color: notebook.graphite,
  },
  subtitle: {
    alignSelf: 'flex-start',
    fontFamily: fonts.hand,
    fontSize: SUBTITLE_SIZE,
    marginRight: -handTailWidth(SUBTITLE_SIZE),
    color: 'rgba(56, 56, 61, 0.6)',
  },
  section: {
    paddingTop: 6,
  },
  // Bölümün adı el yazısından ayrılsın diye küçük, kalın ve aralıklı basma harfle
  sectionTitle: {
    paddingLeft: MARGIN + 12,
    paddingBottom: 8,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: 'rgba(56, 56, 61, 0.45)',
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: MARGIN + 8,
    paddingRight: 16,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: notebook.rule,
  },
  lastRow: {
    borderBottomWidth: 1,
    borderBottomColor: notebook.rule,
  },
  rowPressed: {
    backgroundColor: 'rgba(56, 56, 61, 0.08)',
  },
  rowText: {
    flex: 1,
    alignItems: 'flex-start',
  },
  label: {
    fontFamily: fonts.handBold,
    fontSize: LABEL_SIZE,
    lineHeight: LABEL_SIZE * 1.15,
    marginRight: -handTailWidth(LABEL_SIZE),
  },
  hint: {
    fontFamily: fonts.hand,
    fontSize: HINT_SIZE,
    lineHeight: HINT_SIZE * 1.2,
    marginRight: -handTailWidth(HINT_SIZE),
    color: 'rgba(56, 56, 61, 0.6)',
  },
  hintFaded: {
    color: FADED,
  },
})
