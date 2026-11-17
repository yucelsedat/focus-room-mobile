import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, G, Path } from 'react-native-svg'

import { FitText } from './FitText'

import { colors, fonts, type } from '../theme'

// Kapak/en oranı: defter biçimi
export const BOOK_RATIO = 1.45

// Etiketteki adın boyu: raftaki küçük kapakta gövde, büyük önizlemede başlık boyu
export function coverTitleStyle(width) {
  const fontSize = width >= 160 ? type.title : type.body
  return [styles.title, { fontSize, lineHeight: fontSize * 1.15 }]
}

// Önü dönük duran defter: solda sırt, sağda lastik bant (telli defterde solda spiral), ortada
// kâğıt etiket. Kapağın arkasından sayfaların kenarı görünür.
export function BookCover({
  width,
  title,
  children,
  color = colors.ink,
  band = colors.accent,
  binding = 'band',
  subtitle,
  hint,
  onPress,
  onLongPress,
}) {
  const height = width * BOOK_RATIO
  const spiral = binding === 'spiral'
  const label = (
    <>
      {children ?? (
        <FitText style={coverTitleStyle(width)} numberOfLines={2} minimumFontScale={0.7}>
          {title ?? ''}
        </FitText>
      )}
      {subtitle && <Text style={[styles.subtitle, width < 160 && styles.subtitleSmall]}>{subtitle}</Text>}
    </>
  )
  if (binding === 'file') {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={title}
        accessibilityHint={hint}
        accessibilityActions={onLongPress && [{ name: 'longpress', label: 'Seçenekler' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && onLongPress?.()}
        style={({ pressed }) => [{ width, height }, pressed && styles.lifted]}
      >
        <FileCover width={width} height={height} color={color} band={band}>
          {label}
        </FileCover>
      </Pressable>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityActions={onLongPress && [{ name: 'longpress', label: 'Seçenekler' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && onLongPress?.()}
      style={({ pressed }) => [{ width, height }, pressed && styles.lifted]}
    >
      <View style={styles.pages} />
      <View style={[styles.cover, spiral && styles.spiralCover, { backgroundColor: color }]}>
        {spiral ? (
          <View style={[styles.hinge, { left: width * 0.15 }]} />
        ) : (
          <>
            <View style={[styles.spine, { width: width * 0.09 }]} />
            <View style={[styles.hinge, { left: width * 0.11 }]} />
            <View style={[styles.band, { right: width * 0.13, backgroundColor: band }]} />
          </>
        )}
        <View
          style={[
            styles.label,
            { marginTop: height * 0.22, width: width * 0.62 },
            spiral && { marginLeft: width * 0.08 },
          ]}
        >
          {label}
        </View>
      </View>
      {spiral && <Spiral width={width} height={height} />}
    </Pressable>
  )
}

// PDF: sağ üst köşesi içe kıvrılmış bir belge dosyası. Gövdesi kapağın renginde, kıvrık köşe
// açık tonda; ortada adın yazıldığı kâğıt etiket, altında birkaç satır izi ve sol altta lastik
// bandın renginde "PDF" etiketi.
function FileCover({ width, height, color, band, children }) {
  const fold = width * 0.26
  const r = Math.max(2, width * 0.03)
  const body = `M${r} 0 H${width - fold} L${width} ${fold} V${height - r} Q${width} ${height} ${width - r} ${height} H${r} Q0 ${height} 0 ${height - r} V${r} Q0 0 ${r} 0 Z`
  const corner = `M${width - fold} 0 V${fold - r} Q${width - fold} ${fold} ${width - fold + r} ${fold} H${width} Z`
  const small = width < 160
  return (
    <View style={styles.file}>
      <Svg style={StyleSheet.absoluteFill} width={width + 4} height={height + 5} pointerEvents="none">
        {/* Gölge: gövdenin biraz sağa ve aşağı kaymış koyu kopyası */}
        <Path d={body} fill="rgba(0, 0, 0, 0.4)" translateX={3} translateY={4} />
        <Path d={body} fill={color} />
        <Path d={corner} fill="rgba(255, 255, 255, 0.42)" />
        <Path d={corner} fill="none" stroke="rgba(0, 0, 0, 0.18)" strokeWidth={1} />
      </Svg>
      <View style={[styles.label, { marginTop: height * 0.22, width: width * 0.66 }]}>{children}</View>
      <View style={[styles.fileLines, { left: width * 0.12, right: width * 0.12, bottom: height * 0.2 }]}>
        <View style={styles.fileLine} />
        <View style={[styles.fileLine, { width: '72%' }]} />
      </View>
      <View
        style={[
          styles.fileBadge,
          { left: width * 0.1, bottom: height * 0.07, backgroundColor: band },
          small && styles.fileBadgeSmall,
        ]}
      >
        <Text style={[styles.fileBadgeText, { color, fontSize: small ? 8 : 12 }]}>PDF</Text>
      </View>
    </View>
  )
}

// Telli defterin spirali: kapağın sol kenarındaki deliklerden geçip kenarın üstünden arkaya
// dolanan tel halkalar
function Spiral({ width, height }) {
  const pitch = Math.max(7, width * 0.085)
  const count = Math.floor((height - pitch) / pitch)
  const top = (height - (count - 1) * pitch) / 2
  const hole = width * 0.075
  const out = width * 0.045
  const wire = Math.max(1.4, width * 0.022)
  const drawWidth = hole + out + wire * 2

  return (
    <Svg
      style={[styles.spiral, { left: -out - wire }]}
      width={drawWidth}
      height={height}
      pointerEvents="none"
    >
      {Array.from({ length: count }, (_, i) => {
        const y = top + i * pitch
        const x = hole + out + wire
        const edge = wire
        // Halka delikten çıkıp kenarın dışından bir sonraki deliğin hizasına doğru döner
        const loop = `M${x} ${y} C${x - hole * 0.6} ${y - pitch * 0.55} ${edge} ${y - pitch * 0.5} ${edge} ${y - pitch * 0.05}`
        return (
          <G key={i}>
            <Circle cx={x} cy={y} r={Math.max(1.2, width * 0.018)} fill="rgba(0, 0, 0, 0.55)" />
            <Path d={loop} stroke="#8E949C" strokeWidth={wire} strokeLinecap="round" fill="none" />
            <Path
              d={loop}
              stroke="#E4E7EB"
              strokeWidth={wire * 0.4}
              strokeLinecap="round"
              fill="none"
              translateX={-wire * 0.15}
              translateY={-wire * 0.2}
            />
          </G>
        )
      })}
    </Svg>
  )
}

const styles = StyleSheet.create({
  file: {
    flex: 1,
    alignItems: 'center',
  },
  fileLines: {
    position: 'absolute',
    gap: 5,
  },
  fileLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  fileBadge: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  fileBadgeSmall: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  fileBadgeText: {
    fontFamily: fonts.bodyBold,
    letterSpacing: 1,
  },
  lifted: {
    transform: [{ translateY: -6 }],
  },
  pages: {
    position: 'absolute',
    top: 3,
    right: -3,
    bottom: 0,
    left: 6,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.card,
  },
  cover: {
    flex: 1,
    alignItems: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
    boxShadow: '3px 4px 8px rgba(0, 0, 0, 0.45)',
  },
  // Telli defterin kapağı sırtsız; köşeleri iki yanda da yuvarlak
  spiralCover: {
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  spiral: {
    position: 'absolute',
    top: 0,
  },
  spine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  hinge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 5,
  },
  label: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  title: {
    fontFamily: fonts.displayBold,
    textAlign: 'center',
    color: colors.ink,
  },
  subtitle: {
    marginTop: 4,
    fontFamily: fonts.bodyThin,
    fontSize: type.caption,
    letterSpacing: 3,
    textAlign: 'center',
    color: colors.inkSoft,
  },
  subtitleSmall: {
    marginTop: 2,
    fontSize: 9,
    letterSpacing: 1.5,
  },
})
