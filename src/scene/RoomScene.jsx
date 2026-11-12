// 3D oda sahnesi (expo-gl). Işık/sis değerleri web App.jsx ile aynı.
import { Suspense, Component, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber/native'
import { patchExpoGL } from './glSetup'
import * as THREE from 'three'
import { Floors, Walls, Doors } from './RoomShell'
import { MediaPanels } from './MediaPanels'
import { PlayerController } from './PlayerController'
import { HoverSystem } from './HoverSystem'
import { GROUND_Y } from './geometry'
import { pickTile } from './hover'
import { useStore } from '../store/useStore'

class SceneErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('[RoomScene]', error) }
  render() { return this.state.error ? null : this.props.children }
}

// Dokunuş → sahne nesnesi. Kamera/sahne Canvas dışındaki dokunmatik katmana açılır.
export const sceneRef = { current: null }
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()

function SceneBridge() {
  const { camera, scene, size } = useThree()
  useEffect(() => {
    sceneRef.current = { camera, scene, size }
    return () => { sceneRef.current = null }
  }, [camera, scene, size])
  return null
}

// Ekran noktasına (px) en yakın isabet: { kind: 'media', mediaId, uv } | { kind: 'floor', point } | null
export function pick(x, y) {
  const ctx = sceneRef.current
  if (!ctx) return null
  const { camera, scene, size } = ctx
  ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(scene.children, true)
  for (const hit of hits) {
    let o = hit.object
    while (o) {
      // uv: düzlemde dokunulan nokta (canvas öğe isabeti için)
      if (o.userData?.mediaId != null) return { kind: 'media', mediaId: o.userData.mediaId, uv: hit.object.userData?.canvasPlane ? hit.uv : null }
      if (o.name === 'wall') return null // duvar arkasındaki nesne seçilmesin
      if (o.name === 'floor') return { kind: 'floor', point: hit.point }
      o = o.parent
    }
  }
  return null
}

// Ekran noktasından çıkan ışının çarptığı tile (hover ile aynı analitik hesap)
export function pickTileAt(x, y) {
  const ctx = sceneRef.current
  if (!ctx) return null
  const { camera, size } = ctx
  ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  return pickTile(raycaster.ray.origin, raycaster.ray.direction, useStore.getState())
}

export function RoomScene() {
  // Canvas düzenleyici / video oynatıcı (tam ekran) açıkken sahne çizilmez: GPU/JS düzenleyiciye kalsın
  const paused = useStore((s) => !!s.canvasEditor || !!s.videoPlayer)
  return (
    <Canvas
      style={{ flex: 1 }}
      frameloop={paused ? 'never' : 'always'}
      camera={{ fov: 80, position: [0, GROUND_Y, 5], near: 0.1, far: 260 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        patchExpoGL(gl)
        gl.setClearColor('#050505')
      }}
    >
      <color attach="background" args={['#050505']} />
      <fog attach="fog" args={['#050505', 0, 70]} />
      <ambientLight intensity={0.9} />
      <pointLight position={[10, 10, 10]} intensity={1.5} />
      <spotLight position={[0, 10, 0]} angle={0.15} penumbra={1} intensity={2} />
      <SceneBridge />
      <SceneErrorBoundary>
        <Suspense fallback={null}>
          <Floors />
          <Walls />
          <Doors />
          <PlayerController />
          <HoverSystem />
        </Suspense>
      </SceneErrorBoundary>
      <SceneErrorBoundary>
        <MediaPanels />
      </SceneErrorBoundary>
    </Canvas>
  )
}
