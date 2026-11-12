// Video tile — web MediaOverlay VideoMesh karşılığı: duvarda sessiz, döngülü oynar.
// expo-gl'de <video> dokusu yok; kareler Skia'nın yerel çözücüsünden (Skia.Video) alınır,
// GPU'da dik çevrilip okunur ve tek bir DataTexture'a yüklenir (tampon yeniden kullanılır).
//  - Aynı anda en fazla MAX_PLAYING video oynar: görüş alanındaki en yakınlar. Diğerleri
//    son karelerinde ya da önizleme karesinde (poster) durur.
//  - Poster: video yaklaşınca bir kez üretilir (expo-video-thumbnails, tam çözünürlük),
//    diskte kalır. Skia video desteği olmayan yerde (Expo Go Android) duvarda poster durur.
//  - Doku çözünürlüğü videonun ekranda kapladığı piksele göre seçilir (ekranın
//    gösterebileceğinden azı değil): yaklaşınca netleşir, en fazla videonun kendi
//    çözünürlüğü. Sesli / tam çözünürlüklü izleme: VideoPlayer (dokununca).
import { useEffect, useRef, useState } from 'react'
import { PixelRatio, Platform } from 'react-native'
import { useFrame, useThree } from '@react-three/fiber/native'
import * as THREE from 'three'
import { FrameGrabber, fitSide, getPoster, openVideo, skiaVideoAvailable, uprightOf } from '../video/video'
import { useTexture } from './textures'

const Z = 0.03            // panel yazısının önünde
const MAX_PLAYING = 2
const PLAY_IN = 24        // bu mesafeden yakında oynamaya aday…
const PLAY_OUT = 30       // …bunun ötesinde durur
const POSTER_IN = 45      // poster bu mesafeden yakında (görüş alanında) üretilir
const CHECK_EVERY = 0.4   // s
const RELEASE_AFTER = 8000 // ms — durduktan sonra çözücü bu kadar bekleyip bırakılır
const STEPS = [360, 540, 720, 1080, 1440, 1920, 2560, 3840] // doku uzun kenarı adımları
const ANDROID = Platform.OS === 'android'
// Android: Skia'nın çözücüsü yamalı (patches/@shopify+react-native-skia+2.15.2.patch) —
// kendi iş parçacığında, karelerin zaman damgalarına göre oynar; döngü de orada.
// currentTime() ekrana bırakılan son karenin zamanıdır: değişmediyse yeni kare yoktur
// ve nextImage() hiç çağrılmaz (her çağrı yeni bir GPU dokusu demek).
// iOS: AVPlayer kendi saatiyle ilerler; kare nextImage() ile alınır.

// Oynatma adayları: id → { d, inView, at }
const candidates = new Map()
const choosePlaying = () => {
  const now = Date.now()
  const list = []
  for (const [id, c] of candidates) {
    if (now - c.at > 2000) { candidates.delete(id); continue } // sökülmüş düzlem
    if (skiaVideoAvailable() && c.inView && c.d < (c.playing ? PLAY_OUT : PLAY_IN)) list.push([id, c.d])
  }
  list.sort((a, b) => a[1] - b[1])
  return new Set(list.slice(0, MAX_PLAYING).map(([id]) => id))
}

function makeTexture(pixels, w, h) {
  const t = new THREE.DataTexture(pixels, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.repeat.set(1, -1) // Skia satırları yukarıdan aşağı → UV'yi çevir
  t.offset.set(0, 1)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter // her karede mipmap üretilmesin
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

const _pos = new THREE.Vector3()
const _sphere = new THREE.Sphere()
const _frustum = new THREE.Frustum()
const _vp = new THREE.Matrix4()

export function VideoPlane({ id, url, width, height }) {
  const maxTex = useThree((s) => s.gl.capabilities.maxTextureSize) || 4096
  const meshRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [tex, setTex] = useState(null)
  const [posterUri, setPosterUri] = useState(null)
  const posterTex = useTexture(posterUri)
  const wantPoster = useRef(false)
  const st = useRef({ video: null, grabber: null, up: null, lastT: -1, side: 720, timer: 0, texW: 0, texH: 0 })

  // Görünürlük / mesafe / ekrandaki boyut → oynatma seçimi ve doku çözünürlüğü
  useFrame(({ camera, size }, delta) => {
    const s = st.current
    s.timer += delta
    if (s.timer >= CHECK_EVERY && meshRef.current) {
      s.timer = 0
      meshRef.current.getWorldPosition(_pos)
      const d = _pos.distanceTo(camera.position)
      _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      _frustum.setFromProjectionMatrix(_vp)
      _sphere.set(_pos, Math.hypot(width, height) / 2)
      const inView = _frustum.intersectsSphere(_sphere)
      candidates.set(id, { d, inView, at: Date.now(), playing })
      if (!wantPoster.current && inView && d < POSTER_IN) {
        wantPoster.current = true
        getPoster(url).then((p) => { if (p) setPosterUri(p.uri) })
      }
      const should = choosePlaying().has(id)
      if (should !== playing) setPlaying(should)
      // Düzlemin ekrandaki uzun kenarı (px) → bir üst doku adımı
      const fov = (camera.fov * Math.PI) / 180
      const px = (Math.max(width, height) / (2 * Math.max(0.1, d) * Math.tan(fov / 2))) * size.height * PixelRatio.get()
      s.side = STEPS.find((v) => v >= px * 1.15) ?? STEPS[STEPS.length - 1]
    }

    // Yeni kare → doku
    const v = s.video
    if (!v || !playing) return
    let img = null
    try {
      if (ANDROID && v.currentTime() === s.lastT && tex) return // yeni kare yok
      img = v.nextImage()
      if (!img) return
      const t = v.currentTime()
      if (t === s.lastT && tex) return // yeni kare yok
      const { w, h } = fitSide(s.up.w, s.up.h, Math.min(s.side, maxTex))
      const pixels = s.grabber.grab(img, s.up.rot, w, h)
      if (!pixels) return
      s.lastT = t
      if (!tex || s.texW !== w || s.texH !== h) {
        s.texW = w
        s.texH = h
        setTex(makeTexture(pixels, w, h)) // boyut değişti: yeni doku (eskisi aşağıda bırakılır)
      } else {
        tex.image.data = pixels
        tex.needsUpdate = true
      }
    } finally {
      img?.dispose?.()
    }
  })

  // Oynatma başlar / durur; çözücü bir süre bekletilip bırakılır (gidip gelmede yeniden açılmasın)
  useEffect(() => {
    const s = st.current
    let alive = true
    if (playing) {
      clearTimeout(s.release)
      if (s.video) { s.video.play(); return () => { alive = false } }
      openVideo(url).then((v) => {
        if (!alive) { v.dispose?.(); return }
        v.setVolume(0)
        v.setLooping(true)
        v.play()
        s.video = v
        s.up = uprightOf(v)
        s.grabber = s.grabber ?? new FrameGrabber()
        s.lastT = -1
      }).catch((err) => {
        // Skia video desteği yoksa (Expo Go Android) sessizce posterde kal
        if (__DEV__ && skiaVideoAvailable()) console.warn('[video] açılamadı', url, err?.message ?? err)
        setPlaying(false)
      })
    } else if (s.video) {
      s.video.pause()
      s.release = setTimeout(() => {
        s.video?.dispose?.()
        s.video = null
      }, RELEASE_AFTER)
    }
    return () => { alive = false }
  }, [playing, url])

  useEffect(() => () => {
    const s = st.current
    clearTimeout(s.release)
    candidates.delete(id)
    s.video?.pause()
    s.video?.dispose?.()
    s.video = null
    s.grabber?.dispose()
  }, [id])

  useEffect(() => () => tex?.dispose(), [tex])

  const shown = tex ?? posterTex
  return (
    <mesh ref={meshRef} position={[0, 0, Z]} visible={!!shown}>
      <planeGeometry args={[width, height]} />
      {shown
        ? <meshBasicMaterial key={shown.uuid} map={shown} toneMapped={false} side={THREE.DoubleSide} />
        : <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />}
    </mesh>
  )
}
