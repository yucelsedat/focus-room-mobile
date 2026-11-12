// Oda geometrisi — web'deki Grid/Walls/OuterWalls/Player ile birebir aynı ölçüler.
// Oda boyutları ve duvar ID kodlaması ortak modelden gelir (src/shared/roomConfig — web ile ortak).
import {
  ROOM_CONFIGS,
  encodeWallId,
  decodeWallId,
  wallTileCount,
} from '../shared/roomConfig'

export { ROOM_CONFIGS, encodeWallId, decodeWallId, wallTileCount }

export const TILE = 1
export const GROUND_Y = 2.5        // göz yüksekliği
export const WALL_H = 6
export const OUTDOOR_SIZE = 400
export const FAR_LIMIT = 200
export const MAX_FLY_Y = 80

// İki bahçe duvarı halkası: layer 1 = ±30, layer 2 = ±40
export const RINGS = [
  { layer: 1, idPrefix: 'outer', config: { gx: 60, gz: 60, wh: 6 }, offset: 30 },
  { layer: 2, idPrefix: 'outer2', config: { gx: 80, gz: 80, wh: 6 }, offset: 40 },
]

// İç duvar tile'ı (kare ve dikdörtgen oda) → [x, y, z], rotY
export function innerWallTransform(id, config) {
  const { gx, gz } = config
  const { h, face, j } = decodeWallId(id, config)
  const y = h * TILE + TILE / 2
  const ox = gx / 2
  const oz = gz / 2
  switch (face) {
    case 0: return [[j - ox + 0.5, y, -oz], 0]
    case 1: return [[j - ox + 0.5, y, oz], Math.PI]
    case 2: return [[-ox, y, j - oz + 0.5], Math.PI / 2]
    default: return [[ox, y, j - oz + 0.5], -Math.PI / 2]
  }
}

// Bahçe halkası tile'ı (her zaman kare, eski j*4+face kodlaması)
export function ringWallTransform(id, gridSize, offset) {
  const h = Math.floor(id / (gridSize * 4))
  const j = Math.floor((id % (gridSize * 4)) / 4)
  const face = id % 4
  const y = h * TILE + TILE / 2
  const pos = j * TILE - offset + TILE / 2
  switch (face) {
    case 0: return [[pos, y, -offset], 0]
    case 1: return [[pos, y, offset], Math.PI]
    case 2: return [[-offset, y, pos], Math.PI / 2]
    default: return [[offset, y, pos], -Math.PI / 2]
  }
}

// Kapı yüzeyinin dünya konumu (web BlueDoor.doorWorldPos)
export function doorWorldPos(anchorId, config) {
  const { gx, gz } = config
  const { face, j } = decodeWallId(anchorId, config)
  const ox = gx / 2
  const oz = gz / 2
  const y = 1.5
  switch (face) {
    case 0: return { position: [j - ox + TILE, y, -oz], rotationY: 0 }
    case 1: return { position: [j - ox + TILE, y, oz], rotationY: Math.PI }
    case 2: return { position: [-ox, y, j - oz + TILE], rotationY: Math.PI / 2 }
    case 3: return { position: [ox, y, j - oz + TILE], rotationY: -Math.PI / 2 }
    default: return { position: [0, y, 0], rotationY: 0 }
  }
}
