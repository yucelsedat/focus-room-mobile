import { useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { colors, fonts, HAND_TAIL } from '../theme'

// Defter açılırken ekranın ortasında yaprakları rüzgarda savrulan küçük bir defter.
// Animasyon UI iş parçacığında döner; defterin sayfaları kurulurken JS meşgul olsa da takılmaz.

const PAGE_W = 64
const PAGE_H = 86
const COVER = 6
const LEAVES = 3
// Bir tur: yapraklar sırayla sola savrulur, sonra tersten geri kapanır
const CYCLE = 2400
const FORWARD = 0.3
const BACK = 0.24
// Defter ne kadar çabuk hazır olursa olsun animasyon en az bu kadar görünür (ms)
const MIN_VISIBLE = 1000

function easeInOut(x) {
  'worklet'
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function clamp01(x) {
  'worklet'
  return Math.min(1, Math.max(0, x))
}

export function NotebookLoader({ done, onHidden }) {
  const cycle = useSharedValue(0)
  const fade = useSharedValue(1)
  const shownAt = useRef(0)

  useEffect(() => {
    shownAt.current = Date.now()
    cycle.set(withRepeat(withTiming(1, { duration: CYCLE, easing: Easing.linear }), -1))
    return () => cancelAnimation(cycle)
  }, [cycle])

  useEffect(() => {
    if (!done) return
    const wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt.current))
    fade.set(
      withDelay(
        wait,
        withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) scheduleOnRN(onHidden)
        }),
      ),
    )
  }, [done, fade, onHidden])

  const overlayStyle = useAnimatedStyle(() => ({ opacity: fade.get() }))

  return (
    <Animated.View
      pointerEvents={done ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
    >
      <View style={styles.book}>
        <View style={[styles.page, styles.leftPage]}>
          <Lines />
        </View>
        <View style={[styles.page, styles.rightPage]}>
          <Lines />
        </View>
        {Array.from({ length: LEAVES }, (_, i) => (
          <Leaf key={i} index={i} cycle={cycle} />
        ))}
        <View style={styles.spine} />
      </View>
      <Text style={styles.caption}>{`Defter açılıyor${HAND_TAIL}`}</Text>
    </Animated.View>
  )
}

// Sırttan dönen tek yaprak: sağ sayfanın üstünden kalkıp sol sayfanın üstüne iner, sonra geri döner
function Leaf({ index, cycle }) {
  const style = useAnimatedStyle(() => {
    const t = cycle.get()
    const forward = easeInOut(clamp01((t - index * 0.1) / FORWARD))
    const back = easeInOut(clamp01((t - (0.52 + (LEAVES - 1 - index) * 0.12)) / BACK))
    const turn = forward - back
    return {
      transform: [{ perspective: PAGE_W * 6 }, { rotateY: `${-180 * turn}deg` }],
      // Sağda ilk savrulacak yaprak üstte durur; solda en son inen yaprak üste gelir
      zIndex: 10 + (turn > 0.5 ? index : LEAVES - index),
    }
  })

  // Yaprak dikleştikçe ışıktan uzaklaşır, kararır
  const shadeStyle = useAnimatedStyle(() => {
    const t = cycle.get()
    const forward = easeInOut(clamp01((t - index * 0.1) / FORWARD))
    const back = easeInOut(clamp01((t - (0.52 + (LEAVES - 1 - index) * 0.12)) / BACK))
    return { opacity: 0.28 * Math.sin(Math.PI * (forward - back)) }
  })

  return (
    <Animated.View style={[styles.page, styles.leaf, style]}>
      <Lines />
      <Animated.View style={[StyleSheet.absoluteFill, styles.shade, shadeStyle]} />
    </Animated.View>
  )
}

function Lines() {
  return (
    <View style={styles.lines}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[styles.line, i === 5 && styles.shortLine]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2B2620',
    zIndex: 100,
  },
  book: {
    width: PAGE_W * 2 + COVER * 2,
    height: PAGE_H + COVER * 2,
    padding: COVER,
    flexDirection: 'row',
    borderRadius: 6,
    backgroundColor: colors.ink,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  page: {
    width: PAGE_W,
    height: PAGE_H,
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  leftPage: {
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
  },
  rightPage: {
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  leaf: {
    position: 'absolute',
    top: COVER,
    left: COVER + PAGE_W,
    backgroundColor: colors.card,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    transformOrigin: 'left center',
  },
  shade: {
    backgroundColor: '#000',
  },
  spine: {
    position: 'absolute',
    top: COVER,
    bottom: COVER,
    left: COVER + PAGE_W - 1,
    width: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    zIndex: 50,
  },
  lines: {
    flex: 1,
    paddingHorizontal: 9,
    paddingTop: 16,
    gap: 10,
  },
  line: {
    height: 1,
    backgroundColor: colors.line,
  },
  shortLine: {
    width: '55%',
  },
  caption: {
    marginTop: 22,
    fontFamily: fonts.hand,
    fontSize: 24,
    color: 'rgba(244, 239, 230, 0.72)',
  },
})
