// Uygulama tarafı: native Skia + yazı tipleri ile markdown çiziciyi hazırlar.
// Çizimler sıraya alınır: büyük bir metin JS iş parçacığını yüzlerce ms
// tutabilir; birden çok tile aynı anda çizilmeye çalışılmasın.
import { Skia } from '@shopify/react-native-skia'
import { Asset } from 'expo-asset'
import { createMarkdownRenderer, FAMILY } from './render'
import { createCanvasRenderer } from '../canvas/render'

const FONT_FILES = {
  [FAMILY.body]: [
    require('@expo-google-fonts/dm-sans/300Light/DMSans_300Light.ttf'),
    require('@expo-google-fonts/dm-sans/300Light_Italic/DMSans_300Light_Italic.ttf'),
    require('@expo-google-fonts/dm-sans/800ExtraBold/DMSans_800ExtraBold.ttf'),
    require('@expo-google-fonts/dm-sans/800ExtraBold_Italic/DMSans_800ExtraBold_Italic.ttf'),
  ],
  [FAMILY.mono]: [
    require('@expo-google-fonts/jetbrains-mono/300Light/JetBrainsMono_300Light.ttf'),
    require('@expo-google-fonts/jetbrains-mono/800ExtraBold/JetBrainsMono_800ExtraBold.ttf'),
  ],
}

let rendererPromise = null

export function getMarkdownRenderer() {
  if (!rendererPromise) {
    rendererPromise = (async () => {
      const mgr = Skia.TypefaceFontProvider.Make()
      for (const [family, mods] of Object.entries(FONT_FILES)) {
        for (const mod of mods) {
          const [asset] = await Asset.loadAsync(mod)
          const data = await Skia.Data.fromURI(asset.localUri ?? asset.uri)
          const tf = Skia.Typeface.MakeFreeTypeFaceFromData(data)
          if (tf) mgr.registerFont(tf, family)
        }
      }
      return createMarkdownRenderer(Skia, mgr)
    })()
    rendererPromise.catch(() => { rendererPromise = null }) // sonraki denemede yeniden yükle
  }
  return rendererPromise
}

let queue = Promise.resolve()

/** job(renderer) sırayla çalışır; aralarda bir kare nefes alınır */
export function enqueueRender(job) {
  const run = queue.then(async () => {
    const r = await getMarkdownRenderer()
    await new Promise((res) => setTimeout(res, 0))
    return job(r)
  })
  queue = run.catch(() => {})
  return run
}

let canvasRenderer = null
const canvasFor = (md) => {
  if (canvasRenderer?.md !== md) canvasRenderer = { md, cv: createCanvasRenderer(Skia, md) }
  return canvasRenderer.cv
}

/** Canvas çizimi de aynı sıradan geçer (job(canvasRenderer)) */
export const enqueueCanvas = (job) => enqueueRender((md) => job(canvasFor(md)))

/** Tam ekran düzenleyici: kısa Picture kayıtları sırayı beklemeden, eşzamanlı yapılır */
export const getCanvasRenderer = () => getMarkdownRenderer().then(canvasFor)
