// Canvas tile — web CanvasMesh'in duvardaki görünümü. İçerik Skia ile çizilip
// doku olur (bkz. src/canvas/render.js); dokununca öğe isabeti TouchLayer'da.
//
// Ayrıntı düzeyi: bir odada onlarca canvas olabilir; hepsini 1920 px çizmek
// telefon GPU belleğini doldurur (her biri ≈10 MB). Uzaktakiler 768 px, oyuncu
// yaklaşınca tam çözünürlük. Yeni doku hazır olana kadar eskisi görünür kalır.
//
// GIF: canvas dokusunda ilk karesi çizilir; oyuncu yakındayken canvas'ta görünen
// kısmının üstüne sunucu kareleriyle oynayan bir katman konur (GifPlane overlay).
// Üstünü başka bir öğe örten GIF katman almaz (sıra bozulmasın), ilk karede kalır.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber/native'
import * as THREE from 'three'
import { useStore } from '../store/useStore'
import { enqueueCanvas } from '../markdown/skia'
import { canvasImageUrls, canvasPxSize, itemBox, parseCanvas } from '../canvas/render'
import { prepareImages } from '../canvas/images'
import { isGifUrl } from '../api/media'
import { GifPlane } from './ImageMedia'

const Z = 0.02
const LO = 0.4          // uzaktan: 768 px genişlik
const HI_IN = 14        // bu mesafeden yakında tam çözünürlük…
const HI_OUT = 19       // …bu mesafeden uzaklaşınca düşük (titreşmesin)
const CHECK_EVERY = 0.4 // s
const GIF_IN = 30       // GIF katmanları bu mesafeden yakında kurulur…
const GIF_OUT = 36      // …uzaklaşınca kaldırılır (kare indirme / bellek)
const GIF_Z = 0.006     // canvas dokusunun hemen önü
const GIF_HOLD = 2      // s — görüş alanından çıkınca katmanlar bu kadar bekleyip kaldırılır

// Kutunun yüzey (pan/zoom öncesi) sınırları; ok için uç noktalarının kutusu
const boundsOf = (it) => {
  if (it.type === 'arrow') {
    const pad = (it.strokeWidth || 4) * 6
    return { x0: Math.min(it.x1, it.x2) - pad, y0: Math.min(it.y1, it.y2) - pad, x1: Math.max(it.x1, it.x2) + pad, y1: Math.max(it.y1, it.y2) + pad }
  }
  const b = itemBox(it)
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
}
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Canvas'taki oynatılabilir GIF'ler → düzlem üzerindeki konum / boyut / kırpma */
export function canvasGifs(content, width, height) {
  const view = parseCanvas(content)
  const { pxW, pxH } = canvasPxSize(width, height)
  const out = []
  view.items.forEach((it, i) => {
    if (it.type !== 'image' || !isGifUrl(it.url) || !it.url.startsWith('/uploads/')) return
    const own = boundsOf(it)
    if (view.items.slice(i + 1).some((o) => overlaps(own, boundsOf(o)))) return
    // Ekran (canvas px) kutusu ve canvas'ta görünen kısmı
    const x0 = own.x0 * view.zoom + view.pan.x
    const y0 = own.y0 * view.zoom + view.pan.y
    const x1 = own.x1 * view.zoom + view.pan.x
    const y1 = own.y1 * view.zoom + view.pan.y
    const cx0 = Math.max(0, x0)
    const cy0 = Math.max(0, y0)
    const cx1 = Math.min(pxW, x1)
    const cy1 = Math.min(pxH, y1)
    if (cx1 - cx0 < 2 || cy1 - cy0 < 2 || x1 - x0 < 1 || y1 - y0 < 1) return
    const full = cx0 === x0 && cy0 === y0 && cx1 === x1 && cy1 === y1
    out.push({
      key: it.id,
      url: it.url,
      w: ((cx1 - cx0) / pxW) * width,
      h: ((cy1 - cy0) / pxH) * height,
      x: -width / 2 + (((cx0 + cx1) / 2) / pxW) * width,
      y: height / 2 - (((cy0 + cy1) / 2) / pxH) * height,
      crop: full ? null : { l: (cx0 - x0) / (x1 - x0), t: (cy0 - y0) / (y1 - y0), r: (cx1 - x0) / (x1 - x0), b: (cy1 - y0) / (y1 - y0) },
    })
  })
  return out
}

function makeTexture({ pixels, pw, ph }) {
  const t = new THREE.DataTexture(pixels, pw, ph, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.repeat.set(1, -1) // Skia satırları yukarıdan aşağı → UV'yi çevir
  t.offset.set(0, 1)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

const _pos = new THREE.Vector3()
const _sphere = new THREE.Sphere()
const _frustum = new THREE.Frustum()
const _vp = new THREE.Matrix4()

export function CanvasPlane({ item }) {
  const { content, width, height, syncGroupId, syncCount } = item
  const maxTex = useThree((s) => s.gl.capabilities.maxTextureSize)
  const currentRoomId = useStore((s) => s.currentRoomId)
  const [hi, setHi] = useState(false)
  const [near, setNear] = useState(false)
  const [tex, setTex] = useState(null)
  const meshRef = useRef(null)
  const timer = useRef(0)
  const outFor = useRef(0)

  useFrame(({ camera }, delta) => {
    timer.current += delta
    if (timer.current < CHECK_EVERY || !meshRef.current) return
    timer.current = 0
    meshRef.current.getWorldPosition(_pos)
    const d = _pos.distanceTo(camera.position)
    if (!hi && d < HI_IN) setHi(true)
    else if (hi && d > HI_OUT) setHi(false)
    // GIF katmanları yalnız yakında ve görüş alanındayken kurulur (kare indirme / doku)
    let inView = false
    if (d < GIF_OUT) {
      _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      _frustum.setFromProjectionMatrix(_vp)
      _sphere.set(_pos, Math.hypot(width, height) / 2)
      inView = _frustum.intersectsSphere(_sphere)
    }
    outFor.current = inView ? 0 : outFor.current + CHECK_EVERY
    if (!near && d < GIF_IN && inView) setNear(true)
    else if (near && (d > GIF_OUT || outFor.current > GIF_HOLD)) setNear(false)
  })

  useEffect(() => {
    let alive = true
    const scale = hi ? Math.min(1, (maxTex || 4096) / 1920) : LO
    ;(async () => {
      // Görseller diske iner (tüm canvas'lar için en fazla 4 eşzamanlı); çizimde her
      // görsel diskten okunup çözülür ve hemen bırakılır — bellekte aynı anda tek görsel
      const getImage = await prepareImages(canvasImageUrls(content, width, height))
      if (!alive) return
      await enqueueCanvas((cv) => {
        if (!alive) return
        const r = cv.render(content, width, height, { scale, getImage, currentRoomId, syncGroupId, syncCount })
        if (alive) setTex(makeTexture(r))
      })
    })().catch((err) => { if (__DEV__) console.warn('[canvas] çizilemedi', err?.message ?? err) })
    return () => { alive = false }
  }, [content, width, height, hi, maxTex, currentRoomId, syncGroupId, syncCount])

  // Önceki doku, yenisi ekrana geçtikten sonra bırakılır
  useEffect(() => () => tex?.dispose(), [tex])

  const gifs = useMemo(() => canvasGifs(content, width, height), [content, width, height])

  return (
    <>
      <mesh ref={meshRef} position={[0, 0, Z]} userData={{ canvasPlane: true }}>
        <planeGeometry args={[width, height]} />
        {tex
          ? <meshBasicMaterial key={tex.uuid} map={tex} transparent toneMapped={false} side={THREE.DoubleSide} />
          : <meshBasicMaterial color={parseCanvas(content).bg} side={THREE.DoubleSide} />}
      </mesh>
      {near && tex && gifs.map((g) => (
        <group key={g.key} position={[g.x, g.y, GIF_Z]}>
          <GifPlane url={g.url} width={g.w} height={g.h} crop={g.crop} overlay />
        </group>
      ))}
    </>
  )
}
