// Ekran yönü: uygulama dikey ve yatayda çalışır (yön kilidi yok; yalnız canvas
// düzenleyici yataya, video oynatıcı videonun yönüne kilitlenir, kapanınca kilit kalkar).
import { useWindowDimensions } from 'react-native'

export function useScreen() {
  const { width, height } = useWindowDimensions()
  return { width, height, landscape: width > height }
}

// Yatayda alt sayfalar sağdan açılan yan panel olur; panelin (iç boşluk dahil) genişliği
export function sidePanelWidth(screenW) {
  return Math.min(520, Math.max(340, Math.round(screenW * 0.55)))
}
