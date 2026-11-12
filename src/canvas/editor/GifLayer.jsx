// Düzenleyicide GIF / animasyonlu WebP oynatımı. Her görsel adresi için tek
// SkAnimatedImage vardır (aynı GIF canvas'ta birkaç kez dursa da kareler bir kez
// çözülür); tüm adresler tek bir kare saatinde (requestAnimationFrame) kendi kare
// süreleriyle, tam çözünürlükte ilerler. Yalnız karesi değişen GifItem yeniden çizilir.
//  - Ekranda görünmeyen GIF kare çözmez (bulunduğu karede bekler)
//  - Her GIF en fazla iki kare tutar: ekrandaki + bir önceki. Önceki, bir sonraki
//    karede bırakılır; o ana kadar React yeni kareyi çoktan çizmiştir (useSyncExternalStore
//    güncellemesi bir sonraki rAF'ten önce işlenir). Eskiden bırakma 250 ms sonraydı ve
//    çok GIF'te onlarca tam boy kare birikip uygulamayı kapatıyordu.
// (Reanimated kullanılmaz: Expo Go'daki yerel sürümle uyuşmazlık düzenleyiciyi açılışta düşürüyordu.)
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Group, Image, Skia } from '@shopify/react-native-skia'

const frameDelay = (d) => (d > 10 ? d : 100) // tarayıcılar gibi: ≤10 ms → 100 ms

function createClock() {
  let frames = []
  const listeners = new Set()
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    frame: (i) => frames[i] ?? null,
    set(next) { frames = next; listeners.forEach((fn) => fn()) },
    all: () => frames,
  }
}

/**
 * urls (sıralı, benzersiz) → saat: GifItem'lar kendi dizinindeki kareyi okur.
 * visible: şu an ekranda görünen GIF adresleri (Set) — yalnız onlar ilerler.
 */
export function useGifClock(urls, getAnim, version, visible) {
  const anims = useMemo(() => urls.map((u) => getAnim(u)), [urls, getAnim, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const [clock] = useState(createClock)
  const visibleRef = useRef(visible)
  useEffect(() => { visibleRef.current = visible }, [visible])

  useEffect(() => {
    if (!anims.length) { clock.set([]); return undefined }
    const start = Date.now()
    clock.set(anims.map((a) => a?.getCurrentFrame() ?? null))
    const prev = anims.map(() => null)
    const due = anims.map((a) => start + frameDelay(a?.currentFrameDuration() ?? 0))
    let raf = 0
    const loop = () => {
      const t = Date.now()
      const vis = visibleRef.current
      let next = null
      anims.forEach((a, i) => {
        if (!a || t < due[i]) return
        if (vis && !vis.has(urls[i])) { due[i] = t + 120; return } // görünmüyor: çözme, ara ara bak
        const d = a.decodeNextFrame()
        next = next ?? clock.all().slice()
        prev[i]?.dispose?.()
        prev[i] = next[i]
        next[i] = a.getCurrentFrame()
        // Tekrar etmeyen GIF: son kare -1 ile gelir → o karede kal.
        // Uzun duraklamadan sonra kareler arka arkaya yetişmeye çalışmasın.
        due[i] = d < 0 ? Infinity : Math.max(due[i] + frameDelay(d), t)
      })
      if (next) clock.set(next)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      // Ekrandaki son kareler bir sonraki saat kurulana dek çizilebilir: biraz sonra bırak
      const old = [...prev, ...clock.all()]
      setTimeout(() => old.forEach((f) => f?.dispose?.()), 300)
    }
  }, [anims, clock, urls])

  return clock
}

/** Tek GIF öğesi: kutuya gerdirilir, köşeler web ImageItem gibi 4 px yuvarlak */
export function GifItem({ item, clock, index }) {
  const image = useSyncExternalStore(clock.subscribe, () => clock.frame(index))
  const { x, y, w, h } = item
  const clip = useMemo(() => Skia.RRectXY(Skia.XYWHRect(x, y, w, h), 4, 4), [x, y, w, h])
  if (!image) return null
  return (
    <Group clip={clip}>
      <Image image={image} x={x} y={y} width={w} height={h} fit="fill" />
    </Group>
  )
}
