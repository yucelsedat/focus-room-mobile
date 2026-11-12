// three.js typeface fontu üretir (Türkçe karakterli). Kullanım:
//   node scripts/gen-typeface.mjs <font.ttf> <çıktı.typeface.json>
// Mevcut font: node scripts/gen-typeface.mjs node_modules/@expo-google-fonts/dm-sans/800ExtraBold/DMSans_800ExtraBold.ttf src/scene/fonts/dmsans-800.typeface.json
import opentype from 'opentype.js'
import fs from 'fs'
const [,, src, out] = process.argv
const font = opentype.loadSync(src)
const chars = []
for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c))
chars.push(...'ğĞşŞıİüÜöÖçÇâÂîÎûÛéÉèàá–—…‘’“”•·→←°€₺×'.split(''))
const scale = 1000 / font.unitsPerEm
const r = (v) => Math.round(v * scale)
const glyphs = {}

// Değişken fonttan türetilmiş statik ağırlıklarda bazı düz konturlar küçük
// "papyon" döngüleri içerir (iki bacak kesişip geri döner, ör. 'w'). earcut
// bunu üçgenleyemez. Yalnız düz çizgili konturlarda, aralarında tek segment
// olan iki segment kesişiyorsa aradaki iki noktayı kesişim noktasıyla değiştir.
function segX(a, b, c, d) {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])
  if (!den) return null
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
  return [Math.round(a[0] + t * (b[0] - a[0])), Math.round(a[1] + t * (b[1] - a[1]))]
}
function untangle(o) {
  // o: düz token dizisi → kontur kontur ayır
  const contours = []
  for (let i = 0; i < o.length;) {
    const cmd = o[i]
    const n = cmd === 'b' ? 6 : cmd === 'q' ? 4 : 2
    if (cmd === 'm') contours.push([])
    contours.at(-1).push([cmd, ...o.slice(i + 1, i + 1 + n)])
    i += 1 + n
  }
  const out = []
  for (const c of contours) {
    if (c.every((t) => t[0] === 'm' || t[0] === 'l')) {
      let pts = c.map((t) => [t[1], t[2]])
      let changed = true
      while (changed && pts.length > 4) {
        changed = false
        const n = pts.length
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n], c2 = pts[(i + 2) % n], d = pts[(i + 3) % n]
          const x = segX(a, b, c2, d)
          if (x) {
            const bi = (i + 1) % n, ci = (i + 2) % n
            pts[bi] = x
            pts = pts.filter((_, k) => k !== ci)
            changed = true
            break
          }
        }
      }
      pts.forEach((p, k) => out.push(k ? 'l' : 'm', p[0], p[1]))
    } else {
      for (const t of c) out.push(...t)
    }
  }
  o.length = 0
  o.push(...out)
}
for (const ch of chars) {
  const g = font.charToGlyph(ch)
  if (!g || (g.index === 0 && ch !== ' ')) continue
  // Sıfır uzunluklu segmentler ve kapanıştaki başlangıç tekrarı atılır:
  // three.js'in earcut üçgenlemesi tekrarlanan noktalarda bozuluyor (ör. 'w').
  const o = []
  let cx = null, cy = null, sx = null, sy = null
  const cmds = g.path.commands
  for (let k = 0; k < cmds.length; k++) {
    const cmd = cmds[k]
    const x = r(cmd.x), y = r(cmd.y)
    const next = cmds[k + 1]
    const closesToStart = (!next || next.type === 'Z' || next.type === 'M') && x === sx && y === sy
    if (cmd.type === 'M') { o.push('m', x, y); sx = x; sy = y }
    else if (cmd.type === 'L') { if ((x === cx && y === cy) || closesToStart) continue; o.push('l', x, y) }
    else if (cmd.type === 'Q') o.push('q', x, y, r(cmd.x1), r(cmd.y1))
    else if (cmd.type === 'C') o.push('b', x, y, r(cmd.x1), r(cmd.y1), r(cmd.x2), r(cmd.y2))
    else continue
    cx = x; cy = y
  }
  untangle(o)
  const bb = g.getBoundingBox()
  glyphs[ch] = { ha: r(g.advanceWidth), x_min: r(bb.x1), x_max: r(bb.x2), o: o.join(' ') }
}
const json = {
  glyphs, familyName: 'DM Sans', ascender: r(font.ascender), descender: r(font.descender),
  underlinePosition: r(font.tables.post.underlinePosition), underlineThickness: r(font.tables.post.underlineThickness),
  boundingBox: { yMin: r(font.tables.head.yMin), xMin: r(font.tables.head.xMin), yMax: r(font.tables.head.yMax), xMax: r(font.tables.head.xMax) },
  resolution: 1000, original_font_information: { format: 0, fontFamily: 'DM Sans' }, cssFontWeight: 'bold', cssFontStyle: 'normal',
}
fs.writeFileSync(out, JSON.stringify(json))
console.log('glyphs', Object.keys(glyphs).length, 'bytes', fs.statSync(out).size)
