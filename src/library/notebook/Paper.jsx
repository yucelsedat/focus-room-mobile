import { useMemo, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { isDocumentPaper } from '../lib/documentPaper'
import { docPage, notebook } from '../theme'

// Kareli ve noktalı kâğıdın aralığı: iki kare bir satır, satır çizgileri kare çizgilerine denk gelir
const GRID = notebook.lineHeight / 2
// Kâğıttaki leke sayısı ve lekelerin toplandığı saydamlık kademeleri
const SPECKS = 260
const SPECK_LEVELS = [0.055, 0.08, 0.105, 0.13]

// Her açılışta aynı lekeler çıksın diye sabit tohumlu basit rastgele sayı üreteci
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// Kâğıt dokusu, kenar gölgesi ve kırmızı kenar boşluğu çizgileri
export function Paper({ children, seed = 42, paper = 'oxford' }) {
  // PDF'in sayfası dokusuz, düz beyazdır
  if (isDocumentPaper(paper)) return <View style={styles.desk}>{children}</View>
  return (
    <TexturedPaper seed={seed} paper={paper}>
      {children}
    </TexturedPaper>
  )
}

function TexturedPaper({ children, seed = 42, paper = 'oxford' }) {
  const window = useWindowDimensions()
  // Android'de pencere boyu sistem çubuklarını saymayabilir, kâğıt ondan uzun kalır; doku ve gölge
  // kâğıdın ölçülen boyutuna yayılır, ölçülene kadar pencere boyu kullanılır
  const [measured, setMeasured] = useState({ width: 0, height: 0 })
  const width = Math.max(window.width, measured.width)
  const height = Math.max(window.height, measured.height)

  // Her leke ayrı bir <Circle> olsaydı sayfa başına yüzlerce SVG düğümü kurulurdu; aynı
  // saydamlıktaki lekeler tek bir yola (<Path>) çizilir, sayfa birkaç düğümle çıkar
  const specks = useMemo(() => {
    const rand = seeded(seed)
    const paths = SPECK_LEVELS.map(() => '')
    for (let i = 0; i < SPECKS; i++) {
      const x = rand() * width
      const y = rand() * height
      const r = 0.3 + rand() * 0.8
      const level = Math.min(SPECK_LEVELS.length - 1, Math.floor(rand() * SPECK_LEVELS.length))
      paths[level] += circlePath(x, y, r)
    }
    return paths
  }, [seed, width, height])

  return (
    <View
      style={styles.paper}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout
        setMeasured((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
      }}
    >
      <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
        <Defs>
          <RadialGradient id="vignette" cx="50%" cy="45%" rx="75%" ry="70%">
            <Stop offset="0.6" stopColor={notebook.paperEdge} stopOpacity="0" />
            <Stop offset="1" stopColor={notebook.paperEdge} stopOpacity="0.22" />
          </RadialGradient>
        </Defs>
        {specks.map((d, i) => (
          <Path key={i} d={d} fill={notebook.paperEdge} opacity={SPECK_LEVELS[i]} />
        ))}
        <Rect width={width} height={height} fill="url(#vignette)" />
      </Svg>
      {/* Kenar boşluğu çizgileri pencere ölçüsüne bağlı kalmasın, kâğıdın boyu kadar uzasın */}
      {paper === 'oxford' && (
        <>
          <View pointerEvents="none" style={[styles.margin, styles.marginMain]} />
          <View pointerEvents="none" style={[styles.margin, styles.marginSecond]} />
        </>
      )}
      {children}
    </View>
  )
}

// Kaydırılan içeriğin arkasına, içerik yüksekliği kadar satır çizgisi (kareli kâğıtta kareler,
// noktalı kâğıtta noktalar; düz kâğıt boş kalır).
// İçerik ölçülene kadar en az bir ekran boyu çizilir; çizgiler sayfayla birlikte gelsin.
// Çizgiler SVG değil, görünümün yinelenen gradyan arka planıdır: Android'de her SVG kendi boyunda
// bir bitmap'e çizilir, çok uzun sayfada o bitmap yüzlerce MB tutar ve uygulama kapanırdı.
// Gradyan bitmap ayırmadan çizilir.
export function RuledLines({ height: contentHeight, paper = 'oxford' }) {
  const { width, height: screenHeight } = useWindowDimensions()
  const height = Math.max(contentHeight, screenHeight)

  if (paper === 'plain' || isDocumentPaper(paper)) return null

  return (
    <View
      pointerEvents="none"
      style={[
        styles.rules,
        { width, height },
        paper === 'grid' ? GRID_STYLE : paper === 'dot' ? DOT_STYLE : LINE_STYLE,
      ]}
    />
  )
}

// Karşıdan karşıya ince bir çizgi: [from, to) aralığı çizginin rengi, gerisi saydam
function band(direction, from, to) {
  return `linear-gradient(${direction}, transparent ${from}px, ${notebook.rule} ${from}px, ${notebook.rule} ${to}px, transparent ${to}px)`
}

// Satır çizgisi satırın en altında (eskiden y = satır sonu - 0,5, kalınlık 0,9)
const LINE_STYLE = {
  backgroundImage: band('to bottom', notebook.lineHeight - 0.95, notebook.lineHeight - 0.05),
  backgroundSize: `100% ${notebook.lineHeight}px`,
  backgroundRepeat: 'repeat',
}

// Karenin sağ ve alt kenarı (kalınlık 0,7); yan yana dizilince ızgara olur
const GRID_EDGE = GRID - 0.5
const GRID_STYLE = {
  backgroundImage: `${band('to bottom', GRID_EDGE - 0.35, GRID_EDGE + 0.35)}, ${band('to right', GRID_EDGE - 0.35, GRID_EDGE + 0.35)}`,
  backgroundSize: `${GRID}px ${GRID}px`,
  backgroundRepeat: 'repeat',
}

// Karenin sağ alt köşesinde bir nokta
const DOT_STYLE = {
  backgroundImage: `radial-gradient(circle 1.5px at ${GRID_EDGE}px ${GRID_EDGE}px, ${notebook.rule} 1.1px, transparent 1.5px)`,
  backgroundSize: `${GRID}px ${GRID}px`,
  backgroundRepeat: 'repeat',
}

// r yarıçaplı, (x, y) merkezli dairenin yolu: iki yarım yay
function circlePath(x, y, r) {
  const left = (x - r).toFixed(1)
  const cy = y.toFixed(1)
  const rr = r.toFixed(2)
  const d = (2 * r).toFixed(2)
  return `M${left} ${cy}a${rr} ${rr} 0 1 0 ${d} 0a${rr} ${rr} 0 1 0 -${d} 0`
}

const styles = StyleSheet.create({
  rules: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  desk: {
    flex: 1,
    backgroundColor: docPage.sheet,
  },
  paper: {
    flex: 1,
    backgroundColor: notebook.paper,
  },
  margin: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: notebook.margin,
  },
  marginMain: {
    left: notebook.marginX - 0.6,
    width: 1.2,
  },
  marginSecond: {
    left: notebook.marginX + 4 - 0.4,
    width: 0.8,
    opacity: 0.7,
  },
})
