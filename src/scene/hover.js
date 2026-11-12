// Crosshair hover'ı — ekranın tam ortasından çıkan ışının çarptığı tile.
//
// Web'de her tile mesh'i kendi instance'larına raycast atar (~6000 instance,
// 20 Hz) ve öncelik için "defer" kuralları gerekir. Telefonda (Hermes) bu pahalı;
// tile'lar ise bilinen düzlemlerde durur. Bu yüzden ışın her duvar/zemin
// düzlemiyle analitik olarak kesiştirilir ve EN YAKIN, gizli olmayan (kapı
// boşluğu değil) tile seçilir — kapı boşluğundan bakınca ışın arkadaki halkaya geçer.
import { ROOM_CONFIGS, RINGS, encodeWallId } from './geometry'

const MAX_DIST = 70 // sis sonu: görünmeyen tile hover olmasın

// Instance mesh kaydı: hover rengi bu mesh'lere uygulanır
export const tileMeshes = { floor: null, wall: null, outer: null, outer2: null }

const setCache = new WeakMap()
function toSet(arr) {
  let s = setCache.get(arr)
  if (!s) { s = new Set(arr); setCache.set(arr, s) }
  return s
}

// Dikey düzlem (x = c veya z = c) kesişimi → { t, along, y } | null
function hitPlane(o, d, axis, c) {
  const dc = axis === 'x' ? d.x : d.z
  if (Math.abs(dc) < 1e-6) return null
  const t = (c - (axis === 'x' ? o.x : o.z)) / dc
  if (t <= 0 || t > MAX_DIST) return null
  return {
    t,
    along: axis === 'x' ? o.z + t * d.z : o.x + t * d.x,
    y: o.y + t * d.y,
  }
}

// Yüz → [eksen, sabit, rotY]: web Walls/OuterWalls yerleşimiyle aynı
const faces = (ox, oz) => [
  ['z', -oz, 0],
  ['z', oz, Math.PI],
  ['x', -ox, Math.PI / 2],
  ['x', ox, -Math.PI / 2],
]

function tilePose(axis, c, along, h, rotY, jBase) {
  // Tile merkezi + yüzey normali yönünde 0.01 (web hoveredTile ile aynı)
  const center = jBase + 0.5
  const nx = Math.sin(rotY) * 0.01
  const nz = Math.cos(rotY) * 0.01
  const position = axis === 'z' ? [center + nx, h + 0.5, c + nz] : [c + nx, h + 0.5, center + nz]
  return { position, rotation: [0, rotY, 0, 'XYZ'] }
}

/**
 * o: ışın başlangıcı, d: birim yön (THREE.Vector3 benzeri)
 * st: store durumu
 * → { key, index, id, position, rotation } | null
 */
export function pickTile(o, d, st) {
  const config = ROOM_CONFIGS[st.currentRoomType] ?? ROOM_CONFIGS.room
  const ox = config.gx / 2
  const oz = config.gz / 2
  let best = null
  const consider = (cand) => { if (!best || cand.t < best.t) best = cand }

  // İç duvar
  const innerHidden = toSet(st.hiddenWalls)
  faces(ox, oz).forEach(([axis, c, rotY], face) => {
    const hit = hitPlane(o, d, axis, c)
    if (!hit) return
    const half = face < 2 ? ox : oz
    const width = face < 2 ? config.gx : config.gz
    const j = Math.floor(hit.along + half)
    const h = Math.floor(hit.y)
    if (j < 0 || j >= width || h < 0 || h >= config.wh) return
    const index = encodeWallId(h, face, j, config)
    if (innerHidden.has(index)) return
    consider({ t: hit.t, key: 'wall', index, id: `wall-${index}`, axis, c, along: hit.along, h, rotY, jBase: j - half })
  })

  // Bahçe halkaları (kare, eski j*4+face kodlaması)
  const ringHidden = [toSet(st.hiddenOuterWalls), toSet(st.hiddenOuterWalls2)]
  RINGS.forEach((ring, r) => {
    const { offset } = ring
    const size = ring.config.gx
    faces(offset, offset).forEach(([axis, c, rotY], face) => {
      const hit = hitPlane(o, d, axis, c)
      if (!hit) return
      const j = Math.floor(hit.along + offset)
      const h = Math.floor(hit.y)
      if (j < 0 || j >= size || h < 0 || h >= ring.config.wh) return
      const index = h * size * 4 + j * 4 + face
      if (ringHidden[r].has(index)) return
      consider({ t: hit.t, key: ring.idPrefix, index, id: `${ring.idPrefix}-${index}`, axis, c, along: hit.along, h, rotY, jBase: j - offset })
    })
  })

  // Oda zemini (web Grid: i = x * gz + z)
  if (d.y < -1e-6) {
    const t = -o.y / d.y
    if (t > 0 && t <= MAX_DIST) {
      const px = o.x + t * d.x
      const pz = o.z + t * d.z
      const xi = Math.floor(px + ox)
      const zi = Math.floor(pz + oz)
      if (xi >= 0 && xi < config.gx && zi >= 0 && zi < config.gz) {
        const index = xi * config.gz + zi
        consider({
          t, key: 'floor', index, id: index, floor: true,
          position: [xi - ox + 0.5, 0.01, zi - oz + 0.5],
          rotation: [-Math.PI / 2, 0, 0, 'XYZ'],
        })
      }
    }
  }

  if (!best) return null
  const pose = best.floor
    ? { position: best.position, rotation: best.rotation }
    : tilePose(best.axis, best.c, best.along, best.h, best.rotY, best.jBase)
  // kind: 'wall' | 'outer' | 'outer2' | 'floor'; row: duvardaki satır (0 = zemin hizası)
  return { key: best.key, index: best.index, id: best.id, kind: best.key, row: best.floor ? 0 : best.h, ...pose }
}
