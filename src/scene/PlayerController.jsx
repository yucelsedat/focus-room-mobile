// Birinci şahıs kamera — web Player.jsx'in dokunmatik karşılığı.
// Hareket/çarpışma/kapı geçişi mantığı web ile aynıdır; yalnızca girdi
// klavye+fare yerine joystick + sürükleyerek bakıştır. Dikey ekranda yatay
// görüş açısı daralmasın diye dikey FOV en-boy oranına göre ayarlanır.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber/native'
import * as THREE from 'three'
import { useStore } from '../store/useStore'
import { loadRoom } from '../api/loadRoom'
import { input } from '../controls/input'
import {
  ROOM_CONFIGS, RINGS, encodeWallId, decodeWallId,
  GROUND_Y, FAR_LIMIT, MAX_FLY_Y,
} from './geometry'

const MOVE_SPEED = 5
const FLY_SPEED = 8
const FAST_FALL_SPEED = 20
const LOOK_SENS = 0.0055       // rad / px
const PITCH_LIMIT = Math.PI / 2 - 0.05
const TARGET_HFOV = 62          // derece — yatay görüş
const MAX_VFOV = 96

// Kapı açık mı? (h=1 veya h=2 tile'ı gizli mi) — iç duvar, kare/dikdörtgen
function canPass(hidden, face, along, config) {
  const { gx, gz } = config
  const width = face < 2 ? gx : gz
  const half = width / 2
  const j = Math.floor(along + half)
  if (j < 0 || j >= width) return false
  return hidden.has(encodeWallId(1, face, j, config)) || hidden.has(encodeWallId(2, face, j, config))
}

function canPassRing(hidden, face, along, config, offset) {
  const j = Math.floor(along + offset)
  if (j < 0 || j >= config.gx) return false
  return hidden.has(encodeWallId(1, face, j, config)) || hidden.has(encodeWallId(2, face, j, config))
}

// Dikdörtgen sınır (iç duvar: ox/oz farklı olabilir; halka: ox = oz = offset)
function collide(prev, nx, nz, ox, oz, pass) {
  const inX = nx > -ox && nx < ox
  if (inX) {
    if (prev.z > -oz && nz <= -oz && !pass(0, nx)) nz = -oz + 0.01
    if (prev.z < -oz && nz >= -oz && !pass(0, nx)) nz = -oz - 0.01
    if (prev.z < oz && nz >= oz && !pass(1, nx)) nz = oz - 0.01
    if (prev.z > oz && nz <= oz && !pass(1, nx)) nz = oz + 0.01
  }
  const inZ = nz > -oz && nz < oz
  if (inZ) {
    if (prev.x > -ox && nx <= -ox && !pass(2, nz)) nx = -ox + 0.01
    if (prev.x < -ox && nx >= -ox && !pass(2, nz)) nx = -ox - 0.01
    if (prev.x < ox && nx >= ox && !pass(3, nz)) nx = ox - 0.01
    if (prev.x > ox && nx <= ox && !pass(3, nz)) nx = ox + 0.01
  }
  return [nx, nz]
}

// Kapıdan geçildi mi? Geçildiyse hedef odadaki varsayılan doğma noktası
function crossedPortal(door, config, ox, oz, prev, nx, nz, rooms) {
  const { face, j } = decodeWallId(door.anchorId, config)
  const target = rooms.find((r) => r.id === door.targetRoomId)
  const tc = ROOM_CONFIGS[target?.roomType] ?? ROOM_CONFIGS.room
  const tx = tc.gx / 2
  const tz = tc.gz / 2
  const clampX = (v) => Math.max(-tx + 1, Math.min(tx - 1, v))
  const clampZ = (v) => Math.max(-tz + 1, Math.min(tz - 1, v))
  const hit = (along, half) => {
    const pj = Math.floor(along + half)
    return pj === j || pj === j + 1
  }
  if (face === 0 && prev.z > -oz && nz <= -oz && hit(nx, ox)) return [clampX(nx), tz - 2]
  if (face === 1 && prev.z < oz && nz >= oz && hit(nx, ox)) return [clampX(nx), -(tz - 2)]
  if (face === 2 && prev.x > -ox && nx <= -ox && hit(nz, oz)) return [tx - 2, clampZ(nz)]
  if (face === 3 && prev.x < ox && nx >= ox && hit(nz, oz)) return [-(tx - 2), clampZ(nz)]
  return null
}

// Hedef odada geldiğimiz odaya dönen kapı varsa onun önünde doğ
function returnDoorSpawn(fromRoomId) {
  const st = useStore.getState()
  const cfg = ROOM_CONFIGS[st.currentRoomType] ?? ROOM_CONFIGS.room
  const layers = [
    [[...st.specialDoors, ...st.roomLinks], cfg, cfg.gx / 2, cfg.gz / 2],
    [[...st.outerSpecialDoors, ...st.outerRoomLinks], RINGS[0].config, RINGS[0].offset, RINGS[0].offset],
    [[...st.outerSpecialDoors2, ...st.outerRoomLinks2], RINGS[1].config, RINGS[1].offset, RINGS[1].offset],
  ]
  for (const [doors, config, rx, rz] of layers) {
    const door = doors.find((d) => d.targetRoomId === fromRoomId)
    if (!door) continue
    const { face, j } = decodeWallId(door.anchorId, config)
    if (face === 0) return [j - rx + 1, -rz + 2]
    if (face === 1) return [j - rx + 1, rz - 2]
    if (face === 2) return [-rx + 2, j - rz + 1]
    return [rx - 2, j - rz + 1]
  }
  return null
}

export function PlayerController() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const yaw = useRef(0)
  const pitch = useRef(0)
  const flyY = useRef(GROUND_Y)
  const falling = useRef(false)
  const teleporting = useRef(false)
  const tmp = useRef({ fwd: new THREE.Vector3(), side: new THREE.Vector3(), dir: new THREE.Vector3(), euler: new THREE.Euler(0, 0, 0, 'YXZ') })

  // Dikey ekran: yatay FOV'u sabit tutacak dikey FOV
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const h = THREE.MathUtils.degToRad(TARGET_HFOV)
    const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect))
    camera.fov = Math.min(MAX_VFOV, Math.max(60, v))
    camera.near = 0.1
    camera.far = 260
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])

  const placeAt = (x, z, look) => {
    flyY.current = GROUND_Y
    falling.current = false
    camera.position.set(x, GROUND_Y, z)
    if (look) {
      const dx = look[0] - x
      const dz = look[2] - z
      yaw.current = Math.atan2(-dx, -dz)
      pitch.current = Math.atan2(look[1] - GROUND_Y, Math.hypot(dx, dz))
    }
  }

  const travel = (door, spawn) => {
    teleporting.current = true
    const fromRoomId = useStore.getState().currentRoomId
    loadRoom(door.targetRoomId, door.targetRoomName)
      .then(() => {
        const back = returnDoorSpawn(fromRoomId)
        const [x, z] = back ?? spawn
        placeAt(x, z)
      })
      .catch(() => {})
      .finally(() => { teleporting.current = false })
  }

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1) // arka plandan dönünce sıçrama olmasın
    const t = tmp.current

    // --- Bakış ---
    if (input.lookDX || input.lookDY) {
      yaw.current -= input.lookDX * LOOK_SENS
      pitch.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current - input.lookDY * LOOK_SENS))
      input.lookDX = 0
      input.lookDY = 0
    }
    t.euler.set(pitch.current, yaw.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(t.euler)

    if (teleporting.current) return

    // --- Doğma / ışınlanma (oda yüklenince ya da zemine çift dokunuş) ---
    if (input.spawn) {
      const { pos, look } = input.spawn
      input.spawn = null
      placeAt(pos[0], pos[1], look)
      return
    }
    if (input.teleport) {
      const [x, z] = input.teleport
      input.teleport = null
      placeAt(x, z)
      return
    }

    // --- Dikey hareket (uçma) ---
    if (input.fastFall) {
      input.fastFall = false
      if (flyY.current > GROUND_Y) falling.current = true
    }
    if (falling.current) {
      flyY.current -= FAST_FALL_SPEED * delta
      if (flyY.current <= GROUND_Y) { flyY.current = GROUND_Y; falling.current = false }
    } else if (input.flyUp && !input.flyDown) {
      flyY.current = Math.min(MAX_FLY_Y, flyY.current + FLY_SPEED * delta)
    } else if (input.flyDown && !input.flyUp) {
      flyY.current = Math.max(GROUND_Y, flyY.current - FLY_SPEED * delta)
    }
    camera.position.y = flyY.current

    // --- Yatay hareket ---
    const { x: mx, y: my } = input.move
    const mag = Math.min(1, Math.hypot(mx, my))
    if (mag < 0.05) return

    t.fwd.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
    t.side.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current))
    t.dir.set(0, 0, 0).addScaledVector(t.fwd, my).addScaledVector(t.side, mx)
    if (t.dir.lengthSq() === 0) return
    t.dir.normalize().multiplyScalar(MOVE_SPEED * mag * delta)

    const prev = camera.position
    let nx = prev.x + t.dir.x
    let nz = prev.z + t.dir.z

    const st = useStore.getState()
    const config = ROOM_CONFIGS[st.currentRoomType] ?? ROOM_CONFIGS.room
    const ox = config.gx / 2
    const oz = config.gz / 2

    // İç duvar (duvarın üstünden uçarken çarpışma yok)
    if (flyY.current <= config.wh + GROUND_Y) {
      const hidden = new Set(st.hiddenWalls)
      ;[nx, nz] = collide(prev, nx, nz, ox, oz, (face, along) => canPass(hidden, face, along, config))
    }

    // İç kapı geçişi
    for (const door of [...st.specialDoors, ...st.roomLinks]) {
      const spawn = crossedPortal(door, config, ox, oz, prev, nx, nz, st.rooms)
      if (spawn) { travel(door, spawn); return }
    }

    // Bahçe halkaları
    const ringHidden = [st.hiddenOuterWalls, st.hiddenOuterWalls2]
    const ringDoors = [
      [...st.outerSpecialDoors, ...st.outerRoomLinks],
      [...st.outerSpecialDoors2, ...st.outerRoomLinks2],
    ]
    for (let r = 0; r < RINGS.length; r++) {
      const ring = RINGS[r]
      if (flyY.current > ring.config.wh + GROUND_Y) continue
      const hidden = new Set(ringHidden[r])
      ;[nx, nz] = collide(prev, nx, nz, ring.offset, ring.offset,
        (face, along) => canPassRing(hidden, face, along, ring.config, ring.offset))
    }
    for (let r = 0; r < RINGS.length; r++) {
      const ring = RINGS[r]
      for (const door of ringDoors[r]) {
        const spawn = crossedPortal(door, ring.config, ring.offset, ring.offset, prev, nx, nz, st.rooms)
        if (spawn) { travel(door, spawn); return }
      }
    }

    camera.position.x = Math.max(-FAR_LIMIT, Math.min(FAR_LIMIT, nx))
    camera.position.z = Math.max(-FAR_LIMIT, Math.min(FAR_LIMIT, nz))
  })

  return null
}
