// Resim ve GIF panelleri — web MediaOverlay'deki ImageMesh / GifMesh karşılığı.
//  - Resim: arka plansız, saydam (PNG alfası korunur), z = 0.02 (web ile aynı)
//  - GIF: web'de <img> ile oynar; expo-gl GIF'in yalnız ilk karesini çözebilir.
//    Sunucu GIF'i bir kez çözüp her kareyi ayrı dosya yazar (/api/gif-frames);
//    telefon kareleri sırayla önbelleğe indirir ve TEK bir dokuya yükler — her
//    karede yalnız o dokunun içeriği değişir (texSubImage2D). Çözünürlük ve kare
//    hızı korunur, GPU'da GIF başına tek doku kalır. Kareler sunucuda üretildikçe
//    oynatma baştan başlar; sıradaki kare henüz inmediyse kısa bir an beklenir.
import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber/native'
import * as THREE from 'three'
import * as FileSystem from 'expo-file-system/legacy'
import { api, assetUrl } from '../api/client'
import { useTexture } from './textures'

const Z = 0.02

function LoadingPlane({ width, height }) {
  return (
    <mesh position={[0, 0, Z]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color="#111111" side={THREE.DoubleSide} />
    </mesh>
  )
}

const noRaycast = () => {}

// overlay: canvas üstündeki GIF katmanı — dokunuşlar alttaki canvas'a gitsin (öğe isabeti uv ile)
function TexturedPlane({ texture, width, height, meshRef, overlay }) {
  return (
    <mesh ref={meshRef} position={[0, 0, Z]} raycast={overlay ? noRaycast : undefined}>
      <planeGeometry args={[width, height]} />
      {/* key: map sonradan değişirse three shader'ı yeniden derlemez (bkz. RoomShell) */}
      <meshBasicMaterial key={texture.uuid} map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function ImagePlane({ url, width, height }) {
  const tex = useTexture(assetUrl(url))
  return tex ? <TexturedPlane texture={tex} width={width} height={height} /> : <LoadingPlane width={width} height={height} />
}

// --- GIF ---------------------------------------------------------------------

const POLL_MS = 1200        // sunucu kareleri üretirken `ready` yoklama aralığı
const DOWNLOADS = 4         // GIF başına eşzamanlı kare indirme
const DOWNLOADS_ALL = 8     // tüm GIF'ler toplamı (çok GIF'li odada ağ / bellek taşmasın)

// Ortak indirme sırası: her GIF kendi payını ister, toplam DOWNLOADS_ALL'ı aşmaz
let globalActive = 0
const globalWaiting = []
const acquire = () => new Promise((resolve) => {
  if (globalActive < DOWNLOADS_ALL) { globalActive++; resolve() } else globalWaiting.push(resolve)
})
const release = () => {
  const next = globalWaiting.shift()
  if (next) next()
  else globalActive--
}
const PLAY_DISTANCE = 60    // daha uzaktaki GIF'ler oynatılmaz (zaten küçük görünür)

const frameName = (k, ext) => `${String(k).padStart(4, '0')}.${ext}` // sunucuyla aynı

// Kare listesi / üretim durumu. null → bekleniyor, false → desteklenmiyor
function useGifFrames(url) {
  const eligible = !!url?.startsWith('/uploads/')
  const [meta, setMeta] = useState(eligible ? null : false)
  useEffect(() => {
    if (!eligible) return undefined
    let alive = true
    let timer = null
    let started = false
    const tick = () => api(`/api/gif-frames?src=${encodeURIComponent(url)}`, { timeout: 30000 })
      .then((m) => {
        if (!alive) return
        if (!m?.frames) { setMeta(false); return }
        started = true
        setMeta(m)
        if (!m.done) timer = setTimeout(tick, POLL_MS)
      })
      .catch(() => {
        if (!alive) return
        // Üretim sürerken anlık ağ hatası: oynatmayı bozma, yeniden dene.
        // Hiç başlamadıysa (eski sunucu / hata) → ilk karede kal.
        if (started) timer = setTimeout(tick, POLL_MS * 2)
        else setMeta(false)
      })
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [url, eligible])
  return meta
}

// Kareleri sırayla önbelleğe indirir; local[k] hazır olunca dosya yolunu tutar.
// Önbellek sunucunun anahtarına bağlı: GIF değişirse anahtar da değişir.
class FrameCache {
  constructor(meta, onFirst) {
    this.meta = meta
    this.dir = `${FileSystem.cacheDirectory}gif-${meta.key}/`
    this.local = new Array(meta.frames).fill(null)
    this.next = 0
    this.active = 0
    this.available = 0
    this.done = 0
    this.alive = true
    this.onFirst = onFirst
    this.ready = this.init()
  }

  async init() {
    await FileSystem.makeDirectoryAsync(this.dir, { intermediates: true }).catch(() => {})
    const complete = await FileSystem.getInfoAsync(`${this.dir}complete`).catch(() => ({ exists: false }))
    if (complete.exists) {
      // Önceki oturumda tamamı inmiş: hiçbir şey indirme
      for (let k = 0; k < this.local.length; k++) this.local[k] = this.path(k)
      this.next = this.done = this.local.length
      this.onFirst()
    }
  }

  path(k) { return `${this.dir}${frameName(k, this.meta.ext)}` }

  update(available) {
    this.available = Math.max(this.available, available)
    this.ready.then(() => this.pump())
  }

  pump() {
    while (this.alive && this.active < DOWNLOADS && this.next < this.available) {
      const k = this.next++
      this.active++
      acquire()
        .then(() => (this.alive ? this.fetch(k, 0) : null))
        .finally(() => { release(); this.active--; this.pump() })
    }
  }

  async fetch(k, attempt) {
    try {
      const url = assetUrl(`${this.meta.base}${frameName(k, this.meta.ext)}`)
      const { status } = await FileSystem.downloadAsync(url, this.path(k))
      if (status >= 400) throw new Error(`HTTP ${status}`)
      if (!this.alive) return
      this.local[k] = this.path(k)
      if (k === 0) this.onFirst()
      if (++this.done === this.local.length) {
        FileSystem.writeAsStringAsync(`${this.dir}complete`, '1').catch(() => {})
      }
    } catch (err) {
      if (!this.alive || attempt >= 3) {
        if (__DEV__ && attempt >= 3) console.warn('[gif] kare indirilemedi', k, err?.message)
        return
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      return this.fetch(k, attempt + 1)
    }
  }
}

// Tek doku; içeriği kare kare değişir. R3F native'in TextureLoader polyfill'iyle
// aynı biçim: { data: { localUri } } → EXGL dosyayı kendisi çözer.
// crop: görselin gösterilecek kısmı (0..1, sol-üstten) — canvas kenarında kırpılan GIF
function makeFrameTexture(meta, localUri, crop) {
  const t = new THREE.Texture()
  if (crop) {
    t.repeat.set(crop.r - crop.l, crop.b - crop.t)
    t.offset.set(crop.l, 1 - crop.b) // flipY: v = 0 görselin altı
  }
  t.image = { data: { localUri }, width: meta.frameWidth, height: meta.frameHeight }
  t.isDataTexture = true // DOM'suz yükleme yolu (bkz. polyfill)
  t.flipY = true
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.minFilter = THREE.LinearFilter // mipmap her karede yeniden üretilmesin
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

const _pos = new THREE.Vector3()
const _sphere = new THREE.Sphere()
const _frustum = new THREE.Frustum()
const _vp = new THREE.Matrix4()

function FramePlayer({ meta, width, height, crop, overlay }) {
  const cacheRef = useRef(null)
  const [texture, setTexture] = useState(null)
  const meshRef = useRef(null)
  const anim = useRef({ k: 0, acc: 0 })

  // Önbellek GIF başına bir kez kurulur (meta yoklamada güncellense de)
  useEffect(() => {
    let tex = null
    const cache = new FrameCache(meta, () => {
      if (!cache.alive || tex) return
      tex = makeFrameTexture(meta, cache.local[0], crop)
      setTexture(tex)
    })
    cacheRef.current = cache
    return () => {
      cache.alive = false
      tex?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.key])

  useEffect(() => { cacheRef.current?.update(meta.ready) }, [meta.ready])

  useFrame(({ camera }, delta) => {
    const cache = cacheRef.current
    const mesh = meshRef.current
    if (!texture || !cache || !mesh || meta.frames < 2) return

    // Görünmüyorsa ya da uzaktaysa oynatma: her kare bir görsel çözümü demek
    mesh.getWorldPosition(_pos)
    if (_pos.distanceTo(camera.position) > PLAY_DISTANCE) return
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_vp)
    _sphere.set(_pos, Math.hypot(width, height) / 2)
    if (!_frustum.intersectsSphere(_sphere)) return

    const a = anim.current
    const delays = meta.delays
    a.acc += Math.min(delta, 0.25) * 1000
    let changed = false
    while (a.acc >= delays[a.k]) {
      const nk = (a.k + 1) % meta.frames
      if (!cache.local[nk]) { a.acc = delays[a.k]; break } // sıradaki kare inmedi: bekle
      a.acc -= delays[a.k]
      a.k = nk
      changed = true
    }
    if (changed) {
      texture.image.data = { localUri: cache.local[a.k] }
      texture.needsUpdate = true
    }
  })

  if (!texture) return overlay ? null : <LoadingPlane width={width} height={height} />
  return <TexturedPlane texture={texture} width={width} height={height} meshRef={meshRef} overlay={overlay} />
}

// Sunucu kareleri veremiyorsa (eski sunucu, dış bağlantı): yalnız ilk kare
function FirstFramePlane({ url, width, height }) {
  const tex = useTexture(assetUrl(url))
  return tex ? <TexturedPlane texture={tex} width={width} height={height} /> : <LoadingPlane width={width} height={height} />
}

/**
 * overlay: canvas dokusunun üstünde oynayan GIF (CanvasPlane) — ilk kare zaten
 * canvas'ta çizili olduğundan yüklenirken / kareler alınamazsa hiçbir şey çizilmez.
 * crop: { l, t, r, b } görselin görünen kısmı (canvas kenarı).
 */
export function GifPlane({ url, width, height, overlay = false, crop = null }) {
  const meta = useGifFrames(url)
  if (meta === false) return overlay ? null : <FirstFramePlane url={url} width={width} height={height} />
  if (!meta) return overlay ? null : <LoadingPlane width={width} height={height} />
  // Kırpma dokuya kurulurken uygulanır: değişirse oynatıcı yeniden kurulsun
  const ck = crop ? `${crop.l.toFixed(3)},${crop.t.toFixed(3)},${crop.r.toFixed(3)},${crop.b.toFixed(3)}` : ''
  return <FramePlayer key={`${meta.key}|${ck}`} meta={meta} width={width} height={height} crop={crop} overlay={overlay} />
}
