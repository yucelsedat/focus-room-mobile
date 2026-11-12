// Oda kabuğu: zemin tile'ları, iç duvar, iki bahçe duvarı halkası ve kapı yüzeyleri.
// Web'deki Grid/Walls/OuterWalls/BlueDoor'un mobil karşılığı: her yüzey 1×1
// tile'lardan oluşan tek bir instancedMesh; her tile dokuyu bir kez gösterir.
// Tile rengi instanceColor'dadır (duvar #aaaaaa, zemin #cccccc) — HoverSystem
// + işaretinin baktığı tile'ı camgöbeğine boyar.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../store/useStore'
import { useTexture, bundledTexture, repeatWrap } from './textures'
import { tileMeshes } from './hover'
import { TILE_COLORS } from './HoverSystem'
import {
  ROOM_CONFIGS, RINGS, OUTDOOR_SIZE, WALL_H, wallTileCount,
  innerWallTransform, ringWallTransform, doorWorldPos,
} from './geometry'

function useRoomConfig() {
  const roomType = useStore((s) => s.currentRoomType)
  return ROOM_CONFIGS[roomType] ?? ROOM_CONFIGS.room
}

// Doku asenkron gelir. three.js, `map` sonradan atanınca shader'ı yeniden
// derlemez (USE_MAP tanımı eksik kalır → doku hiç görünmez). Bu yüzden malzeme
// dokuya bağlı bir key ile yeniden kurulur.
function TileMaterial({ tex, side = THREE.FrontSide }) {
  return <meshStandardMaterial key={tex ? tex.uuid : 'plain'} map={tex ?? null} side={side} />
}

/**
 * count adet 1×1 tile. layout(id) → [[x,y,z], rotX, rotY]
 * hidden: gizli (kapı boşluğu) tile id'leri — sıfıra ölçeklenir
 * registryKey: HoverSystem'in bu mesh'i bulacağı ad
 */
function TileMesh({ count, layout, hidden, texture, registryKey, name, side }) {
  const meshRef = useRef()
  const hiddenSet = useMemo(() => new Set(hidden ?? []), [hidden])
  const tmp = useMemo(() => new THREE.Object3D(), [])

  // Renkler yalnız kurulumda: kapı değişince sıfırlanırsa hover rengi silinir
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return undefined
    const color = TILE_COLORS[registryKey]
    for (let id = 0; id < count; id++) mesh.setColorAt(id, color)
    mesh.instanceColor.needsUpdate = true
    tileMeshes[registryKey] = mesh
    return () => { if (tileMeshes[registryKey] === mesh) tileMeshes[registryKey] = null }
  }, [count, registryKey])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let id = 0; id < count; id++) {
      if (hiddenSet.has(id)) {
        tmp.position.set(0, -9999, 0)
        tmp.rotation.set(0, 0, 0)
        tmp.scale.set(0, 0, 0)
      } else {
        const [pos, rotX, rotY] = layout(id)
        tmp.position.set(pos[0], pos[1], pos[2])
        tmp.rotation.set(rotX, rotY, 0)
        tmp.scale.set(1, 1, 1)
      }
      tmp.updateMatrix()
      mesh.setMatrixAt(id, tmp.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [count, layout, hiddenSet, tmp])

  return (
    <instancedMesh ref={meshRef} name={name} args={[null, null, count]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <TileMaterial tex={texture} side={side} />
    </instancedMesh>
  )
}

export function Floors() {
  const floorTexture = useStore((s) => s.floorTexture)
  const config = useRoomConfig()
  const roomType = useStore((s) => s.currentRoomType)
  const src = bundledTexture(floorTexture)
  const tileTex = useTexture(src, repeatWrap(1))
  // Dış zemin kendi dokusunu yükler: repeat paylaşılırsa oda tile'ları bozulur (web ile aynı)
  const outdoorTex = useTexture(src, repeatWrap(OUTDOOR_SIZE))

  // Web Grid sırası: x dış döngü, z iç döngü → i = x * gz + z
  const layout = useMemo(() => (i) => {
    const x = Math.floor(i / config.gz)
    const z = i % config.gz
    return [[x - config.gx / 2 + 0.5, 0, z - config.gz / 2 + 0.5], -Math.PI / 2, 0]
  }, [config])

  return (
    <>
      <mesh name="floor" rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[OUTDOOR_SIZE, OUTDOOR_SIZE]} />
        <meshStandardMaterial key={outdoorTex ? outdoorTex.uuid : 'plain'} map={outdoorTex ?? null} color={outdoorTex ? '#ffffff' : '#2a2a2a'} />
      </mesh>
      <TileMesh
        key={roomType}
        name="floor"
        registryKey="floor"
        count={config.gx * config.gz}
        layout={layout}
        texture={tileTex}
        side={THREE.DoubleSide}
      />
    </>
  )
}

export function Walls() {
  const config = useRoomConfig()
  const roomType = useStore((s) => s.currentRoomType)
  const hiddenInner = useStore((s) => s.hiddenWalls)
  const hiddenOuter = useStore((s) => s.hiddenOuterWalls)
  const hiddenOuter2 = useStore((s) => s.hiddenOuterWalls2)
  const ringHidden = [hiddenOuter, hiddenOuter2]
  const wallTex = useTexture(bundledTexture('duvar.jpg'), repeatWrap(1))

  const innerLayout = useMemo(() => (id) => {
    const [pos, rotY] = innerWallTransform(id, config)
    return [pos, 0, rotY]
  }, [config])
  const ringLayouts = useMemo(
    () => RINGS.map((r) => (id) => {
      const [pos, rotY] = ringWallTransform(id, r.config.gx, r.offset)
      return [pos, 0, rotY]
    }),
    [],
  )

  return (
    <>
      <TileMesh
        key={roomType}
        name="wall"
        registryKey="wall"
        count={wallTileCount(config)}
        layout={innerLayout}
        hidden={hiddenInner}
        texture={wallTex}
        side={THREE.DoubleSide}
      />
      {RINGS.map((ring, i) => (
        <TileMesh
          key={ring.idPrefix}
          name="wall"
          registryKey={ring.idPrefix}
          count={ring.config.gx * WALL_H * 4}
          layout={ringLayouts[i]}
          hidden={ringHidden[i]}
          texture={wallTex}
          side={THREE.DoubleSide}
        />
      ))}
    </>
  )
}

// Özel kapı (oda ağacında child) mavi/mor/pembe; bağlantı kapısı yeşil ailesi
const SPECIAL_COLORS = [
  ['#3b82f6', '#1d4ed8'],
  ['#8b5cf6', '#6d28d9'],
  ['#ec4899', '#be185d'],
]
const LINK_COLORS = [
  ['#10b981', '#047857'],
  ['#22d3ee', '#0e7490'],
  ['#a3e635', '#4d7c0f'],
]

function DoorPlane({ anchorId, config, color, emissive }) {
  const { position, rotationY } = doorWorldPos(anchorId, config)
  return (
    <mesh position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[2, 3]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={0.4}
        transparent
        opacity={0.55}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function Doors() {
  const config = useRoomConfig()
  const s = useStore()
  const layers = [
    [s.specialDoors, s.roomLinks, config],
    [s.outerSpecialDoors, s.outerRoomLinks, RINGS[0].config],
    [s.outerSpecialDoors2, s.outerRoomLinks2, RINGS[1].config],
  ]
  return (
    <>
      {layers.map(([specials, links, cfg], layer) => (
        <group key={layer}>
          {specials.map((d) => (
            <DoorPlane key={`s-${d.id}`} anchorId={d.anchorId} config={cfg}
              color={SPECIAL_COLORS[layer][0]} emissive={SPECIAL_COLORS[layer][1]} />
          ))}
          {links.map((d) => (
            <DoorPlane key={`l-${d.id}`} anchorId={d.anchorId} config={cfg}
              color={LINK_COLORS[layer][0]} emissive={LINK_COLORS[layer][1]} />
          ))}
        </group>
      ))}
    </>
  )
}
