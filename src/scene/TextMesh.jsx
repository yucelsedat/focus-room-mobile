// 3D düz yazı. React Native'de DOM/2D canvas olmadığından (web'deki <Html>
// başlıkları burada çalışmaz) yazı, DM Sans 800'den üretilmiş typeface
// fontuyla ShapeGeometry'ye çevrilir. Font Türkçe karakterleri içerir
// (bkz. fonts/dmsans-800.typeface.json — opentype.js ile üretildi).
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Font } from 'three/examples/jsm/loaders/FontLoader.js'
import fontData from './fonts/dmsans-800.typeface.json'

const font = new Font(fontData)
const RES = fontData.resolution
const LINE_GAP = 1.25
const FALLBACK = '?'

const glyphAdvance = (ch) => (fontData.glyphs[ch] ?? fontData.glyphs[FALLBACK]).ha / RES

// Fontta olmayan karakterleri (emoji vb.) at, boşlukları sadeleştir
export function cleanText(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => [...line].filter((ch) => fontData.glyphs[ch]).join('').replace(/\s+/g, ' ').trim())
    .join('\n')
}

// Satırları birim genişliğe (1 = font boyu) göre kelime kelime sarar
function wrap(text, maxUnits) {
  const out = []
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue }
    let line = ''
    let width = 0
    for (const word of para.split(' ')) {
      const w = [...word].reduce((a, ch) => a + glyphAdvance(ch), 0)
      const sp = line ? glyphAdvance(' ') : 0
      if (line && width + sp + w > maxUnits) {
        out.push(line)
        line = word
        width = w
      } else {
        line = line ? `${line} ${word}` : word
        width += sp + w
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Bir panel (width × height) içine sığdırılmış yazı.
 * - fit: 'title' → tek/iki satır, alanı dolduracak kadar büyük (başlık panelleri)
 * - fit: 'body'  → sabit satır boyu, taşan satırlar kesilir (not/markdown)
 */
export function TextMesh({
  text, width, height, color = '#ffffff', fit = 'title',
  lineSize = 0.32, padding = 0.18, maxChars = 420, align = 'center', z = 0.012,
}) {
  const geometry = useMemo(() => {
    const clean = cleanText(text).slice(0, maxChars)
    if (!clean.trim()) return null
    const innerW = Math.max(0.1, width - padding * 2)
    const innerH = Math.max(0.1, height - padding * 2)

    let size
    let lines
    if (fit === 'title') {
      // En fazla 3 satırda dene; alanı en iyi dolduran boyu seç
      let best = { size: 0, lines: [clean] }
      for (let n = 1; n <= 3; n++) {
        const total = [...clean].reduce((a, ch) => a + glyphAdvance(ch), 0)
        const candidate = wrap(clean, total / n + 0.5)
        const widest = Math.max(...candidate.map((l) => [...l].reduce((a, ch) => a + glyphAdvance(ch), 0)), 0.01)
        const s = Math.min(innerW / widest, innerH / (candidate.length * LINE_GAP))
        if (s > best.size) best = { size: s, lines: candidate }
      }
      size = Math.min(best.size, 1.6)
      lines = best.lines
    } else {
      size = lineSize
      const maxLines = Math.max(1, Math.floor(innerH / (size * LINE_GAP)))
      lines = wrap(clean, innerW / size)
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines)
        lines[maxLines - 1] = `${lines[maxLines - 1].replace(/.{0,2}$/, '')}…`
      }
    }

    const shapes = []
    const lineH = size * LINE_GAP
    lines.forEach((line, i) => {
      if (!line) return
      const lineShapes = font.generateShapes(line, size)
      const geo = new THREE.ShapeGeometry(lineShapes, 4)
      geo.computeBoundingBox()
      const bb = geo.boundingBox
      const lw = bb.max.x - bb.min.x
      const dx = align === 'center' ? -lw / 2 - bb.min.x : -innerW / 2 - bb.min.x
      const dy = fit === 'title'
        ? ((lines.length - 1) / 2 - i) * lineH - size * 0.36
        : innerH / 2 - (i + 1) * lineH + size * 0.25
      geo.translate(dx, dy, 0)
      shapes.push(geo)
    })
    if (!shapes.length) return null
    // Tek geometriye birleştir: panel başına tek draw call
    const merged = mergeGeometries(shapes)
    shapes.forEach((g) => g.dispose())
    return merged
  }, [text, width, height, fit, lineSize, padding, maxChars, align])

  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} position={[0, 0, z]}>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Yalnızca position'lı, indeksli ShapeGeometry'leri birleştirir
function mergeGeometries(geos) {
  let vCount = 0
  let iCount = 0
  for (const g of geos) {
    vCount += g.attributes.position.count
    iCount += g.index ? g.index.count : g.attributes.position.count
  }
  const pos = new Float32Array(vCount * 3)
  const idx = new Uint32Array(iCount)
  let vo = 0
  let io = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3)
    if (g.index) {
      const src = g.index.array
      for (let k = 0; k < src.length; k++) idx[io + k] = src[k] + vo
      io += src.length
    } else {
      for (let k = 0; k < g.attributes.position.count; k++) idx[io + k] = vo + k
      io += g.attributes.position.count
    }
    vo += g.attributes.position.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  return out
}
