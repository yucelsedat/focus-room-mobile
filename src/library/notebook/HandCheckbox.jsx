import Svg, { G, Path } from 'react-native-svg'

import { notebook } from '../theme'

export const CHECKBOX_SIZE = 24

// Kalem kâğıttan kalkmadan çizilmiş, ucu başlangıcı biraz geçen kare
const BOX_PATH =
  'M4 4.6 C8.4 4 13.4 4 18 4.4 C18.4 9 18.4 13.6 18.2 18.2 C13.6 18.6 8.8 18.6 4.2 18.4 C3.8 13.8 3.8 9.2 4.2 3.8'
// Kutudan sağ üste taşan onay işareti
const CHECK_PATH = 'M7.4 10.8 C8.6 12 9.6 13.2 10.6 14.6 C13.2 10.4 16.4 6.2 21.6 1.6'

// Yapılacak satırının başındaki el çizimi kutu
export function HandCheckbox({ checked, tilt }) {
  return (
    <Svg
      width={CHECKBOX_SIZE}
      height={CHECKBOX_SIZE}
      viewBox="0 0 24 24"
      style={{ transform: [{ rotate: `${tilt}deg` }] }}
    >
      <G
        fill="none"
        stroke={notebook.graphite}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.92}
      >
        <Path d={BOX_PATH} />
        {checked && <Path d={CHECK_PATH} />}
      </G>
    </Svg>
  )
}
