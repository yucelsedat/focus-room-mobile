// Duvar/zemin medyası. Web'deki MediaOverlay ile aynı yerleşim: içerik
// group(position, rotation) içinde ((w-1)/2, (h-1)/2) kaydırılır.
// Web'de çoğu panel <Html> (DOM) ile çizilir; mobilde DOM olmadığından paneller
// doku + 3D yazı olarak çizilir (metin ve canvas: Skia dokusu), dokununca native
// detay sayfası açılır.
import { memo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store/useStore'
import { assetUrl } from '../api/client'
import { useTexture } from './textures'
import { TextMesh } from './TextMesh'
import { panelImage, panelText } from './media'
import { ImagePlane, GifPlane } from './ImageMedia'
import { MarkdownPlane } from './MarkdownPlane'
import { CanvasPlane } from './CanvasPlane'
import { VideoPlane } from './VideoMedia'
import { isGifUrl } from '../api/media'

function ImageFill({ url, width, height, z = 0.006, fitInside = false }) {
  const tex = useTexture(assetUrl(url))
  if (!tex) return null
  let w = width
  let h = height
  if (fitInside && tex.image?.width) {
    // Yönü koru: görseli alanın içine sığdır
    const ar = tex.image.width / tex.image.height
    if (w / h > ar) w = h * ar
    else h = w / ar
  }
  return (
    <mesh position={[0, 0, z]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

const Panel = memo(function Panel({ item }) {
  const { width, height } = item

  // Resim / GIF: web ile aynı — arka plan yok, saydamlık korunur
  if (item.type === 'image') {
    return (
      <group position={item.position} rotation={item.rotation}>
        <group position={[(width - 1) / 2, (height - 1) / 2, 0]} userData={{ mediaId: item.id }}>
          {isGifUrl(item.url)
            ? <GifPlane url={item.url} width={width} height={height} />
            : <ImagePlane url={item.url} width={width} height={height} />}
        </group>
      </group>
    )
  }

  // Canvas: web'deki duvar görünümü (kayıtlı kaydırma/yakınlaştırma, kartlar, oklar)
  if (item.type === 'canvas') {
    return (
      <group position={item.position} rotation={item.rotation}>
        <group position={[(width - 1) / 2, (height - 1) / 2, 0]} userData={{ mediaId: item.id }}>
          <CanvasPlane item={item} />
        </group>
      </group>
    )
  }

  // Metin: web'deki gibi beyaz kâğıt üzerinde sütunlu markdown (Skia ile çizilir)
  if (item.type === 'markdown') {
    return (
      <group position={item.position} rotation={item.rotation}>
        <group position={[(width - 1) / 2, (height - 1) / 2, 0]} userData={{ mediaId: item.id }}>
          <MarkdownPlane content={item.content} width={width} height={height} />
        </group>
      </group>
    )
  }

  const image = panelImage(item)
  const { text, bg, color, fit } = panelText(item)
  return (
    <group position={item.position} rotation={item.rotation}>
      <group position={[(width - 1) / 2, (height - 1) / 2, 0]} userData={{ mediaId: item.id }}>
        <mesh>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial color={bg} side={THREE.DoubleSide} />
        </mesh>
        {image && <ImageFill url={image} width={width} height={height} fitInside={item.type !== 'image'} />}
        {item.type === 'video' && item.url && <VideoPlane id={item.id} url={item.url} width={width} height={height} />}
        {!!text && (
          <TextMesh
            text={text}
            width={width}
            height={height}
            color={color}
            fit={fit}
            align={fit === 'body' ? 'left' : 'center'}
          />
        )}
      </group>
    </group>
  )
})

export function MediaPanels() {
  const media = useStore((s) => s.worldMedia)
  return (
    <group name="media">
      {media.map((item) => <Panel key={item.id} item={item} />)}
    </group>
  )
}
