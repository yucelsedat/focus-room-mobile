// Metin (markdown) tile'ı Skia ile çizer — web'deki .mdtile düzeninin karşılığı
// (focus-room-main/src/utils/markdownRender.js):
//   - 1 birim = 200 px; yükseklik sabit (5 birim = 1000 px), içerik 600 px'lik
//     sütunlara akar: genişlik = sütun sayısı × 3 birim
//   - iç boşluk: üst 44, yan/alt 24, 2 px kenarlık; sütun aralığı 48
//   - zemin rgba(255,255,255,.95), köşe 8 px, yazı #1a1a1a, 16 px, satır 1.6
// Yazı tipleri: gövde DM Sans 300, kalın/başlık DM Sans 800, kod JetBrains Mono.
//
// Skia dışarıdan verilir (uygulamada native, testte CanvasKit) — bu dosya React
// Native'e bağlı değildir. Enum'lar sayı olarak yazılır (iki ortamda da aynı).
import { parseMarkdown } from './parse.js'

export const MD = {
  PX_PER_UNIT: 200,
  COL_PX: 600,
  HEIGHT: 5,
  BORDER: 2,
  PAD: 24,
  PAD_TOP: 44,
}
export const MD_COL_UNITS = MD.COL_PX / MD.PX_PER_UNIT // 3

export const FAMILY = { body: 'DM Sans', mono: 'JetBrains Mono' }

const W_BODY = 300
const W_BOLD = 800
const SLANT_ITALIC = 1
const DECO_UNDERLINE = 1
const DECO_LINE_THROUGH = 4
const CLIP_INTERSECT = 1
const COLOR_RGBA_8888 = 4
const ALPHA_UNPREMUL = 3

const INK = '#1a1a1a'
const PAPER = 'rgba(255, 255, 255, 0.95)'
const CODE_BG = '#1c2128'
const CODE_INK = '#adbac7'
const CODE_LABEL_BG = 'rgba(255, 255, 255, 0.07)'
const CODE_LABEL_INK = 'rgba(148, 163, 184, 0.7)'

// Açık zemin (metin tile: .cvmd-light) ve koyu zemin (canvas metin kutusu: .cvmd)
export const THEME = {
  light: {
    link: '#1d4ed8', soft: 'rgba(15, 23, 42, 0.07)', rule: 'rgba(15, 23, 42, 0.2)',
    grid: 'rgba(15, 23, 42, 0.22)', headBg: 'rgba(15, 23, 42, 0.06)', quoteBar: 'rgba(15, 23, 42, 0.28)',
    box: 'rgba(15, 23, 42, 0.45)', tick: '#ffffff',
  },
  dark: {
    link: '#60a5fa', soft: 'rgba(255, 255, 255, 0.1)', rule: 'rgba(255, 255, 255, 0.18)',
    grid: 'rgba(255, 255, 255, 0.18)', headBg: 'rgba(255, 255, 255, 0.08)', quoteBar: 'rgba(255, 255, 255, 0.25)',
    box: 'rgba(255, 255, 255, 0.45)', tick: '#111827',
  },
}

// '#rrggbb' / '#rgb' / 'rgb(a)(…)' → aynı renk, alfa çarpılmış (alıntıdaki opacity .8)
export function withAlpha(c, k) {
  let m = /^#([0-9a-f]{3})$/i.exec(c)
  if (m) c = `#${m[1].split('').map((x) => x + x).join('')}`
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(c)
  if (m) {
    const a = m[4] ? parseInt(m[4], 16) / 255 : 1
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${(a * k).toFixed(3)})`
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c)
  if (m) {
    const [r, g, bl, a = 1] = m[1].split(',').map((x) => parseFloat(x))
    return `rgba(${r}, ${g}, ${bl}, ${(a * k).toFixed(3)})`
  }
  return c
}

const HEADING = { // font boyutu (em), üst / alt boşluk (kendi boyutunun em'i)
  1: { size: 1.75, mt: 0, mb: 0.3 },
  2: { size: 1.4, mt: 0.6, mb: 0.25 },
  3: { size: 1.15, mt: 0.5, mb: 0.2 },
  4: { size: 1, mt: 0.5, mb: 0.2 },
  5: { size: 0.9, mt: 0.5, mb: 0.2 },
  6: { size: 0.85, mt: 0.5, mb: 0.2 },
}

/** Web ile aynı sütun geometrisi (px, ölçek uygulanmamış) */
export function columnGeometry(pxW, pxH) {
  const n = Math.max(1, Math.round(pxW / MD.COL_PX))
  const gap = MD.PAD * 2
  const contentW = pxW - MD.BORDER * 2 - MD.PAD * 2
  const colW = (contentW - (n - 1) * gap) / n
  const colH = pxH - MD.BORDER * 2 - MD.PAD_TOP - MD.PAD
  return { n, gap, colW, colH, x0: MD.BORDER + MD.PAD, y0: MD.BORDER + MD.PAD_TOP }
}

export function createMarkdownRenderer(Skia, fontMgr) {
  // Bir çizim boyunca oluşturulan Skia nesneleri (paragraf, boya, yol…) çizim
  // bitince topluca bırakılır; yoksa native/WASM bellek GC'yi beklerken şişer.
  let tracked = null
  const track = (o) => { if (tracked && o) tracked.push(o); return o }
  function tracking(fn) {
    if (tracked) return fn() // iç içe: dıştaki kapsam bırakır
    tracked = []
    try { return fn() } finally {
      const list = tracked
      tracked = null
      for (const o of list) { try { o.dispose?.() } catch { /* zaten bırakılmış */ } }
    }
  }

  const color = (c) => Skia.Color(c)
  const paint = (c) => { const p = track(Skia.Paint()); p.setColor(color(c)); p.setAntiAlias(true); return p }

  const stroke = (c, w) => { const p = paint(c); p.setStyle(1); p.setStrokeWidth(w); return p } // paint zaten kayıtlı

  // right: işaretin sağ kenarı, cy: dikey orta. Tarayıcının disc / circle / square
  // işaretleri ve devre dışı onay kutusu karşılıkları.
  function drawMarker(c, marker, right, cy, em, ink, th) {
    if (marker === '☐' || marker === '☑') {
      const sz = 0.8 * em
      const r = Skia.RRectXY(Skia.XYWHRect(right - sz, cy - sz / 2, sz, sz), 0.18 * em, 0.18 * em)
      if (marker === '☐') { c.drawRRect(r, stroke(th.box, Math.max(1, 0.08 * em))); return }
      c.drawRRect(r, paint(ink))
      const path = track(Skia.PathBuilder.Make()
        .moveTo(right - sz * 0.76, cy + sz * 0.02)
        .lineTo(right - sz * 0.56, cy + sz * 0.22)
        .lineTo(right - sz * 0.22, cy - sz * 0.2)
        .build())
      const tick = stroke(th.tick, 0.11 * em)
      tick.setStrokeCap(1) // Round
      tick.setStrokeJoin(1)
      c.drawPath(path, tick)
      return
    }
    const r = 0.16 * em
    if (marker === '◦') c.drawCircle(right - r, cy, r - 0.04 * em, stroke(ink, Math.max(1, 0.08 * em)))
    else if (marker === '▪') c.drawRect(Skia.XYWHRect(right - 2 * r, cy - r, 2 * r, 2 * r), paint(ink))
    else c.drawCircle(right - r, cy, r, paint(ink))
  }

  function textStyle(run, base) {
    const st = {
      fontFamilies: [run.c || base.mono ? FAMILY.mono : FAMILY.body],
      fontSize: run.c && !base.mono ? base.size * 0.85 : base.size,
      color: color(run.a ? (base.th ?? THEME.light).link : base.ink),
      heightMultiplier: base.lh,
      halfLeading: true,
      fontStyle: { weight: run.b || base.bold ? W_BOLD : W_BODY, slant: run.i || base.italic ? SLANT_ITALIC : 0 },
    }
    if (base.letterSpacing) st.letterSpacing = base.letterSpacing
    let deco = 0
    if (run.a) deco |= DECO_UNDERLINE
    if (run.s) deco |= DECO_LINE_THROUGH
    if (deco) { st.decoration = deco; st.decorationColor = st.color; st.decorationThickness = 1 }
    if (run.c && !base.mono) st.backgroundColor = color((base.th ?? THEME.light).soft)
    return st
  }

  // pstyle: { maxLines, ellipsis, textAlign } (kartlarda satır sınırı / ortalama)
  function paragraph(runs, base, width, pstyle) {
    const b = track(Skia.ParagraphBuilder.Make({ textStyle: textStyle({}, base), ...pstyle }, fontMgr))
    for (const r of runs) {
      if (!r.t) continue
      b.pushStyle(textStyle(r, base))
      b.addText(r.t)
      b.pop()
    }
    if (!runs.some((r) => r.t)) b.addText('​') // boş satır yine de yükseklik alsın
    const p = track(b.build())
    p.layout(Math.max(1, width))
    return p
  }

  // Satır sınırları (blok içi y): sütun kırılımı yalnız satır aralarında olur
  function lineTops(p) {
    const lines = p.getLineMetrics()
    const tops = [0]
    for (let k = 1; k < lines.length; k++) tops.push(lines[k].baseline - lines[k].ascent)
    tops.push(p.getHeight())
    return tops
  }

  /**
   * Blokları ölçüp çizilebilir öğelere çevirir.
   * opts: { base: yazı boyutu (px), lh: satır yüksekliği, ink, th: THEME.*, width: px }
   * → [{ tops, mt, mb, keepWithNext?, draw(canvas, x, y) }]
   */
  function buildItems(blocks, { base, lh, ink: baseInk, th, width }) {
    const s = base / 16 // 16 px'e göre ölçek (çizgi kalınlığı, köşe, girinti)
    const items = []
    for (const blk of blocks) {
      const qIndent = blk.quote * 15 * s // 3 px çizgi + .75em boşluk
      const ink = blk.quote ? withAlpha(baseInk, 0.8) : baseInk
      const w = width - qIndent
      let it
      if (blk.type === 'heading') {
        const h = HEADING[blk.level]
        const size = base * h.size
        const p = paragraph(blk.inlines, { size, ink, lh, th, bold: true }, w)
        it = { tops: lineTops(p), mt: h.mt * size, mb: h.mb * size, keepWithNext: true, draw: (c, x, y) => p.paint(c, x + qIndent, y) }
      } else if (blk.type === 'para') {
        const p = paragraph(blk.inlines, { size: base, ink, lh, th }, w)
        it = { tops: lineTops(p), mt: 0, mb: 0.55 * base, draw: (c, x, y) => p.paint(c, x + qIndent, y) }
      } else if (blk.type === 'li') {
        const ind = 1.5 * base * (blk.depth + 1)
        const p = paragraph(blk.inlines, { size: base, ink, lh, th }, w - ind)
        // Madde/kutucuk işaretleri şekil olarak çizilir (yazı tipinde ◦ ☐ ☑ yok);
        // numaralar yazıyla
        const numeric = /^\d/.test(blk.marker)
        const mk = numeric ? paragraph([{ t: blk.marker }], { size: base, ink, lh, th }, ind) : null
        const mid = p.getLineMetrics()[0].baseline - 0.3 * base // ilk satırın x-yüksekliği ortası
        const right = ind - 0.45 * base
        it = {
          tops: lineTops(p), mt: 0, mb: blk.last ? 0.55 * base : 0.2 * base,
          draw: (c, x, y) => {
            const ox = x + qIndent
            if (mk) mk.paint(c, ox + right - mk.getLongestLine(), y)
            else drawMarker(c, blk.marker, ox + right, y + mid, base, ink, th)
            p.paint(c, ox + ind, y)
          },
        }
      } else if (blk.type === 'code') {
        const padT = 0.9 * base
        const padB = 0.8 * base
        const padX = base
        const size = 0.88 * base
        const p = paragraph([{ t: blk.text || ' ' }], { size, ink: CODE_INK, lh: 1.55, th, mono: true }, w - padX * 2)
        const lt = lineTops(p)
        const tops = lt.map((t, k) => (k === 0 ? 0 : padT + t))
        tops[tops.length - 1] = padT + p.getHeight() + padB
        const label = paragraph([{ t: (blk.lang || 'code').toLowerCase() }], { size: 0.72 * base, ink: CODE_LABEL_INK, lh: 1.4, th, mono: true }, w)
        const lw = label.getLongestLine() + 1.4 * size * 0.72 * 1.4
        const lh = label.getHeight() + 0.36 * size * 0.72
        const total = tops[tops.length - 1]
        it = {
          tops, mt: 0, mb: 0.6 * base,
          draw: (c, x, y) => {
            const r = 8 * s
            c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x + qIndent, y, w, total), r, r), paint(CODE_BG))
            c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x + qIndent + w - lw, y, lw, lh), 6 * s, 6 * s), paint(CODE_LABEL_BG))
            label.paint(c, x + qIndent + w - lw + (lw - label.getLongestLine()) / 2, y + 0.18 * size * 0.72)
            p.paint(c, x + qIndent + padX, y + padT)
          },
        }
      } else if (blk.type === 'hr') {
        const m = 0.6 * base
        it = {
          tops: [0, Math.max(1, s)], mt: m, mb: m,
          draw: (c, x, y) => c.drawRect(Skia.XYWHRect(x + qIndent, y, w, Math.max(1, s)), paint(th.rule)),
        }
      } else if (blk.type === 'table') {
        const n = Math.max(1, blk.header.length)
        const cellW = w / n
        const padX = 0.55 * base
        const padY = 0.25 * base
        const rows = [blk.header, ...blk.rows].map((cells, r) => {
          const ps = cells.map((ins) => paragraph(ins, { size: base, ink, lh, th, bold: r === 0 }, cellW - padX * 2))
          return { ps, h: Math.max(...ps.map((p) => p.getHeight())) + padY * 2 }
        })
        const tops = [0]
        for (const row of rows) tops.push(tops[tops.length - 1] + row.h)
        it = {
          tops, mt: 0, mb: 0.55 * base,
          draw: (c, x, y) => {
            const line = paint(th.grid)
            const lw = Math.max(1, s)
            const tx = x + qIndent
            c.drawRect(Skia.XYWHRect(tx, y, w, rows[0].h), paint(th.headBg))
            rows.forEach((row, r) => {
              const ry = y + tops[r]
              row.ps.forEach((p, k) => p.paint(c, tx + k * cellW + padX, ry + padY))
              c.drawRect(Skia.XYWHRect(tx, ry, w, lw), line)
            })
            c.drawRect(Skia.XYWHRect(tx, y + tops[rows.length] - lw, w, lw), line)
            for (let k = 0; k <= n; k++) c.drawRect(Skia.XYWHRect(Math.min(tx + k * cellW, tx + w - lw), y, lw, tops[rows.length]), line)
          },
        }
      }
      if (!it) continue
      if (blk.quote) {
        // Alıntı çizgisi bloğun tamamı boyunca (her iç içe düzey için bir çizgi)
        const inner = it.draw
        const total = it.tops[it.tops.length - 1]
        const qMb = it.mb
        it.draw = (c, x, y) => {
          for (let q = 0; q < blk.quote; q++) c.drawRect(Skia.XYWHRect(x + q * 15 * s, y - qMb / 2, 3 * s, total + qMb), paint(th.quoteBar))
          inner(c, x, y)
        }
      }
      items.push(it)
    }
    return items
  }

  /**
   * Öğeleri sütunlara yerleştirir (H: sütun yüksekliği, px).
   * → { cols: kullanılan sütun sayısı, slices: [{ it, i0, i1, col, y }] }
   */
  function layoutColumns(items, H) {

    // Akış: kenar boşlukları çakışır (CSS margin collapse), sütun başında sıfırlanır
    const slices = []
    let col = 0
    let y = 0
    let prevMb = 0
    for (let n = 0; n < items.length; n++) {
      const it = items[n]
      const units = it.tops.length - 1
      if (y > 0) y += Math.max(prevMb, it.mt)
      // Başlık sütun sonunda yalnız kalmasın (CSS break-after: avoid): başlık ve
      // sonraki bloğun ilk satırı bu sütuna sığmıyorsa başlık da sonraki sütuna geçer
      const next = items[n + 1]
      if (it.keepWithNext && next && y > 0) {
        const need = it.tops[units] + Math.max(it.mb, next.mt) + (next.tops[1] - next.tops[0])
        if (y + need > H && need <= H) { col++; y = 0 }
      }
      let start = 0
      let startY = y
      for (let u = 0; u < units; u++) {
        const h = it.tops[u + 1] - it.tops[u]
        if (y + h > H && y > 0) {
          if (u > start) slices.push({ it, i0: start, i1: u, col, y: startY })
          col++
          y = 0
          start = u
          startY = 0
        }
        y += h
      }
      slices.push({ it, i0: start, i1: units, col, y: startY })
      prevMb = it.mb
    }
    return { cols: col + 1, slices }
  }

  // Metin tile: açık tema, 16 px, satır 1.6; s: piksel ölçeği, colW/colH ölçeksiz
  const flow = (content, s, colW, colH) => layoutColumns(
    buildItems(parseMarkdown(content), { base: 16 * s, lh: 1.6, ink: INK, th: THEME.light, width: colW * s }),
    colH * s,
  )

  /**
   * Tek kutu (canvas metin öğesi): markdown alt alta dizilir, sütun yok.
   * → { height, draw(canvas, x, y) }
   */
  function layoutBox(content, opts) {
    const items = buildItems(parseMarkdown(content), opts)
    const placed = []
    let y = 0
    let prevMb = 0
    for (const it of items) {
      if (placed.length) y += Math.max(prevMb, it.mt)
      placed.push({ it, y })
      y += it.tops[it.tops.length - 1]
      prevMb = it.mb
    }
    return { height: y, draw: (c, x, top) => placed.forEach((p) => p.it.draw(c, x, top + p.y)) }
  }

  /** Düz metin (markdown değil, pre-wrap) paragrafı */
  const plainParagraph = (text, { base, lh, ink, th, width }) =>
    paragraph([{ t: text || ' ' }], { size: base, ink, lh, th }, width)

  /** Tile genişliği (birim): içeriğin tamamı 5 birim yükseklikte kaç sütun tutar × 3 */
  function measureWidth(content, height = MD.HEIGHT) {
    return tracking(() => {
      const g = columnGeometry(MD.COL_PX, height * MD.PX_PER_UNIT)
      const { cols } = flow(content, 1, g.colW, g.colH)
      return cols * MD_COL_UNITS
    })
  }

  /**
   * width × height (birim) tile'ı çizer. maxSide: tek dokunun en büyük kenarı,
   * budget: toplam piksel sınırı (telefon belleği). Geniş metin birden çok
   * dokuya bölünür → [{ pixels(RGBA, düz alfa), pw, ph, x: birim, w: birim }]
   * preview: true → tek PNG (base64) döner, sütun sınırı yok
   */
  function render(content, width, height, opts = {}) {
    return tracking(() => renderNow(content, width, height, opts))
  }

  // keepImage: true → parça SkImage'ı da döner (önizleme PNG'si için; çağıran bırakır)
  function renderNow(content, width, height, { maxSide = 4096, budget = 6e6, scale = 1, keepImage = false }) {
    const pxW = width * MD.PX_PER_UNIT
    const pxH = height * MD.PX_PER_UNIT
    const g = columnGeometry(pxW, pxH)
    const s = Math.min(scale, Math.sqrt(budget / (pxW * pxH)), maxSide / pxH)
    const { slices } = flow(content, s, g.colW, g.colH)
    const W = Math.max(1, Math.round(pxW * s))
    const Hh = Math.max(1, Math.round(pxH * s))

    const drawAll = (c, x0, x1) => {
      c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, W, Hh), 8 * s, 8 * s), paint(PAPER))
      for (const sl of slices) {
        if (sl.col >= g.n) continue // web'de de taşan sütunlar görünmez
        const cx = (g.x0 + sl.col * (g.colW + g.gap)) * s
        if (cx > x1 || cx + g.colW * s < x0) continue
        const top = (g.y0 * s) + sl.y
        const h = sl.it.tops[sl.i1] - sl.it.tops[sl.i0]
        c.save()
        c.clipRect(Skia.XYWHRect(cx - 4 * s, top - (sl.i0 === 0 ? 8 * s : 0), g.colW * s + 8 * s, h + (sl.i0 === 0 ? 8 * s : 0) + (sl.i1 === sl.it.tops.length - 1 ? 8 * s : 0)), CLIP_INTERSECT, true)
        sl.it.draw(c, cx, top - sl.it.tops[sl.i0])
        c.restore()
      }
    }

    const chunks = []
    const n = Math.ceil(W / maxSide)
    for (let k = 0; k < n; k++) {
      const x0 = Math.round((k * W) / n)
      const x1 = Math.round(((k + 1) * W) / n)
      const pw = x1 - x0
      const surface = Skia.Surface.Make(pw, Hh)
      const c = surface.getCanvas()
      c.clear(Skia.Color('transparent'))
      c.save()
      c.translate(-x0, 0)
      drawAll(c, x0, x1)
      c.restore()
      surface.flush()
      const img = surface.makeImageSnapshot()
      const pixels = img.readPixels(0, 0, { width: pw, height: Hh, colorType: COLOR_RGBA_8888, alphaType: ALPHA_UNPREMUL })
      chunks.push({ pixels, pw, ph: Hh, x: (x0 / W) * width, w: (pw / W) * width, image: keepImage ? img : null })
      if (!keepImage) img.dispose?.()
      surface.dispose?.()
    }
    return chunks
  }

  return { flow, measureWidth, render, layoutBox, paragraph, plainParagraph, paint, stroke, color, track, tracking }
}
