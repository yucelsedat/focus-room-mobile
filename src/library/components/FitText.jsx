import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

// Satırlarına sığmayan yazının harfleri küçülür (adjustsFontSizeToFit gibi). Android'in
// adjustsFontSizeToFit'i yazıyı her yeniden ölçülüşünde o anki alana göre yeniden küçültür; alan
// bir an daralırsa (ör. kitaplık arkada dururken yeniden ölçülünce) yazı küçük kalabilir. Burada
// boy yalnızca yazıya, stiline ve genişliğe bağlıdır: görünmez bir kopya sınırsız satırla ölçülür,
// sığana kadar adım adım küçültülür. Aynı genişlikte aynı yazı hep aynı boyda çıkar.
export function FitText({ children, style, numberOfLines, minimumFontScale }) {
  const flat = StyleSheet.flatten(style) ?? {}
  const base = flat.fontSize ?? 14
  const lineRatio = typeof flat.lineHeight === 'number' ? flat.lineHeight / base : null
  const min = base * minimumFontScale
  const [width, setWidth] = useState(null)
  // Yazı, boyu ya da genişlik değişince ölçüm baştan başlar
  const key = `${width}|${base}|${children}`
  const [fit, setFit] = useState({ key: '', size: base, done: false })
  const current = fit.key === key ? fit : { key, size: base, done: false }
  const sized =
    lineRatio === null
      ? { fontSize: current.size }
      : { fontSize: current.size, lineHeight: current.size * lineRatio }

  return (
    <View
      onLayout={(e) => {
        const next = e.nativeEvent.layout.width
        setWidth((prev) => (prev === next ? prev : next))
      }}
    >
      {/* Boy bulunana kadar görünmez; büyük boyda bir an görünüp küçülmesin */}
      <Text style={[style, sized, !current.done && styles.hidden]} numberOfLines={numberOfLines}>
        {children}
      </Text>
      {width !== null && !current.done && (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.mirror}
        >
          <Text
            // Ölçüm her başladığında kopya yeniden kurulur ki satırları mutlaka bildirilsin
            key={key}
            style={[style, sized]}
            onTextLayout={(e) => {
              const fits = e.nativeEvent.lines.length <= numberOfLines
              if (fits || current.size <= min) {
                setFit({ key, size: current.size, done: true })
              } else {
                setFit({ key, size: Math.max(min, current.size - 1), done: false })
              }
            }}
          >
            {children}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  hidden: {
    opacity: 0,
  },
  mirror: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
})
