import { NativeModule, requireOptionalNativeModule } from 'expo'

// Expo Go'da bu modül yok; orada "Yapıştır" eskisi gibi yalnızca yazı yapıştırır
const NotePaste = requireOptionalNativeModule('NotePaste')

// Yazı alanının "Yapıştır"ı panodaki resimleri de yakalasın
export function enableImagePaste(viewTag) {
  if (!NotePaste || viewTag == null) return
  NotePaste.enable(viewTag).catch(() => {})
}

export function addImagePasteListener(listener) {
  const subscription = NotePaste?.addListener('onPasteImage', listener)
  return () => subscription?.remove()
}
