// Metin (markdown) tile — web'deki MarkdownMesh'in mobil karşılığı. Web metni
// DOM'da (<Html>) çizer; mobilde içerik Skia ile piksellere çizilip doku olur
// (bkz. src/markdown). Çok geniş metin birden çok dokuya bölünür; her parça
// kendi düzlemiyle yan yana durur.
import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber/native'
import * as THREE from 'three'
import { enqueueRender } from '../markdown/skia'

const Z = 0.02

function makeTexture({ pixels, pw, ph }) {
  const t = new THREE.DataTexture(pixels, pw, ph, THREE.RGBAFormat, THREE.UnsignedByteType)
  // Skia satırları yukarıdan aşağı verir; GL aşağıdan yukarı okur → UV'yi çevir
  t.repeat.set(1, -1)
  t.offset.set(0, 1)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter // uzaktan bakınca yazı kırpışmasın
  t.generateMipmaps = true
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

export function MarkdownPlane({ content, width, height }) {
  const maxTex = useThree((s) => s.gl.capabilities.maxTextureSize)
  const [parts, setParts] = useState(null)

  useEffect(() => {
    let alive = true
    let made = []
    enqueueRender((R) => {
      if (!alive) return
      const chunks = R.render(content ?? '', width, height, { maxSide: Math.min(4096, maxTex || 4096) })
      made = chunks.map((c) => ({ tex: makeTexture(c), x: c.x, w: c.w }))
      setParts(made)
    }).catch((err) => { if (__DEV__) console.warn('[metin] çizilemedi', err?.message ?? err) })
    return () => {
      alive = false
      made.forEach((p) => p.tex.dispose())
    }
  }, [content, width, height, maxTex])

  if (!parts) {
    // Çizilene kadar kâğıt rengi boş yüzey
    return (
      <mesh position={[0, 0, Z]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#f4f4f4" transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
    )
  }
  return (
    <group position={[0, 0, Z]}>
      {parts.map((p) => (
        <mesh key={p.tex.uuid} position={[-width / 2 + p.x + p.w / 2, 0, 0]}>
          <planeGeometry args={[p.w, height]} />
          <meshBasicMaterial key={p.tex.uuid} map={p.tex} transparent toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}
