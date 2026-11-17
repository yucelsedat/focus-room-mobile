import * as Clipboard from 'expo-clipboard'
import { StringFormat } from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'

import { clipboardToMarkdown, looksLikeHtml } from './htmlToMarkdown'

// Panodaki zengin metin. React Native'in yazı alanında panodaki HTML'i veren bir onPaste yoktur;
// iki yol vardır:
//  a) "Biçimli yapıştır" düğmesi: panodaki HTML ve düz metin okunur, Markdown'a çevrilip imlecin
//     yerine eklenir. iOS 16+'da pano izin sormasın diye düğme sistemin yapıştırma düğmesidir
//     (ClipboardPasteButton); izin reddedilirse boş yazı gelir, düz metne düşülür.
//  b) Android'de sistem "Yapıştır" menüsü: yazı alanına tek seferde giren parça panodaki düz metne
//     eşitse ve panoda HTML varsa, o parça Markdown karşılığıyla değiştirilir (bkz. pastedChunk).
//     iOS'ta pano her okunuşta izin sorduğu için bu yol kapalıdır.

function normalize(text) {
  return text.replace(/\r\n?/g, '\n').replace(/ /g, ' ')
}

// Panonun HTML'i ve düz metni Markdown'a çevrilir; pano boşsa (ya da izin verilmediyse) null
export async function readClipboardMarkdown() {
  const html = await Clipboard.getStringAsync({ preferredFormat: StringFormat.HTML }).catch(() => '')
  const plain = await Clipboard.getStringAsync().catch(() => '')
  if (!html && !plain) return null
  // HTML yoksa Android düz metni HTML'e sarıp verebilir; o durumda biçim yok sayılır
  return clipboardToMarkdown({ html: looksLikeHtml(html) ? html : null, plain: plain || html })
}

// iOS yapıştırma düğmesinin verdiği yazı ("html" türü istenince düz metin de HTML olarak gelir)
export function pasteEventMarkdown(data) {
  if (data.type !== 'text' || !data.text) return null
  return looksLikeHtml(data.text)
    ? clipboardToMarkdown({ html: data.text, plain: '' })
    : clipboardToMarkdown({ html: null, plain: data.text })
}

// iOS 16+'da sistemin yapıştırma düğmesi kullanılır
export const NATIVE_PASTE_BUTTON = Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable

// (b) Android: yazıya giren parça panodaki düz metinse ve panoda biçimli HTML varsa Markdown'ı
export async function richReplacementFor(chunk) {
  if (Platform.OS !== 'android' || chunk.length < 2) return null
  const plain = await Clipboard.getStringAsync().catch(() => '')
  if (!plain || normalize(plain) !== normalize(chunk)) return null
  const html = await Clipboard.getStringAsync({ preferredFormat: StringFormat.HTML }).catch(() => '')
  if (!looksLikeHtml(html)) return null
  const result = clipboardToMarkdown({ html, plain })
  return result.rich ? result : null
}

export function missingLinksNotice(count) {
  return count === 1
    ? '1 linkin adresi kaynakta yok, düz metin olarak eklendi'
    : `${count} linkin adresi kaynakta yok, düz metin olarak eklendi`
}

// Panoda yazı var mı; "Biçimli yapıştır" düğmesi panoda yazı yokken soluk durur. Pano değişince ve
// uygulamaya dönülünce yeniden bakılır (pano okunmaz, yalnızca türüne bakılır).
export function useClipboardHasText(enabled) {
  const [hasText, setHasText] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const check = () => {
      Clipboard.hasStringAsync()
        .then((has) => !cancelled && setHasText(has))
        .catch(() => !cancelled && setHasText(false))
    }
    check()
    const clipboardSub = Clipboard.addClipboardListener(check)
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
    })
    return () => {
      cancelled = true
      clipboardSub.remove()
      appStateSub.remove()
    }
  }, [enabled])

  return hasText
}
