import Svg, { Circle, Path } from 'react-native-svg'

import { colors } from '../theme'

// Pano sekmesinin simgesi: sağ alt köşesi kıvrık yapışkan not, üst ortasında raptiye başı.
// Ionicons'la aynı ölçüde çizilir (24'lük kutu, ~1,5 kalınlığında çizgi).
export function StickyNoteIcon({ size = 24, color, filled = false, background = colors.ink }) {
  // Notun gövdesi: kıvrık köşe kesik
  const body = 'M5 6.5 H19 V15 L14 20 H5 Z'
  // Kıvrılan köşe
  const fold = 'M14 20 V15 H19'
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {filled ? (
        <>
          <Path d={body} fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          {/* Kıvrılan köşe kâğıdın arkası: notun renginden biraz koyu */}
          <Path d={`${fold} Z`} fill={background} />
          <Path d={`${fold} Z`} fill={color} opacity={0.55} />
          <Path
            d={fold}
            fill="none"
            stroke={background}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <Path d={body} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          <Path
            d={fold}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
      <Circle cx={12} cy={6.5} r={2.6} fill={color} stroke={background} strokeWidth={1.4} />
    </Svg>
  )
}
