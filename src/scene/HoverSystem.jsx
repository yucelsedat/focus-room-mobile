// Ekran ortasındaki + işaretinin baktığı tile'ı camgöbeği yapar ve store'a
// hoveredTile olarak yazar (web ile aynı şekil: { id, position, rotation }).
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber/native'
import * as THREE from 'three'
import { useStore } from '../store/useStore'
import { pickTile, tileMeshes } from './hover'

export const HOVER_COLOR = new THREE.Color('#00f2ff')
export const TILE_COLORS = {
  floor: new THREE.Color('#cccccc'),
  wall: new THREE.Color('#aaaaaa'),
  outer: new THREE.Color('#aaaaaa'),
  outer2: new THREE.Color('#aaaaaa'),
}

const INTERVAL = 0.05 // ~20 Hz, web ile aynı throttle

export function HoverSystem() {
  const last = useRef(0)
  const current = useRef(null) // { mesh, index, key }
  const dir = useRef(new THREE.Vector3())

  useFrame((state) => {
    const now = state.clock.elapsedTime
    if (now - last.current < INTERVAL) return
    last.current = now

    const st = useStore.getState()
    state.camera.getWorldDirection(dir.current)
    const hit = pickTile(state.camera.position, dir.current, st)
    const mesh = hit ? tileMeshes[hit.key] : null
    const prev = current.current

    if (prev && mesh === prev.mesh && hit.index === prev.index) return

    // Önceki tile'ı eski rengine döndür (oda değiştiyse mesh artık kullanılmıyor olabilir)
    if (prev?.mesh?.instanceColor && prev.index < prev.mesh.count) {
      prev.mesh.setColorAt(prev.index, TILE_COLORS[prev.key])
      prev.mesh.instanceColor.needsUpdate = true
    }

    if (hit && mesh?.instanceColor && hit.index < mesh.count) {
      mesh.setColorAt(hit.index, HOVER_COLOR)
      mesh.instanceColor.needsUpdate = true
      current.current = { mesh, index: hit.index, key: hit.key }
      st.setHoveredTile({ id: hit.id, position: hit.position, rotation: hit.rotation, kind: hit.kind, row: hit.row })
    } else {
      current.current = null
      if (st.hoveredTile) st.setHoveredTile(null)
    }
  })

  return null
}
