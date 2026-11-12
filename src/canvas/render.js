// Canvas tile'ı Skia ile çizer — web CanvasMesh'in "render mode"u (duvardaki
// salt görünüm) karşılığı (focus-room-main/src/components/CanvasMesh.jsx,
// canvas/cards.jsx, canvas/TextItem.jsx, canvas/ArrowLayer.jsx):
//   - mantıksal kutu 1920 × (1920·h/w) px; içerik yüzeyi translate(pan)·scale(zoom)
//   - öğeler (x, y, w, h) yüzey px'inde; oklar en üstte
// Kart görünümleri web'deki ölçülerle; emoji yerine basit vektör simgeler
// (Skia'nın gömülü yazı tiplerinde emoji yok).
//
// Skia ve markdown çizici dışarıdan verilir (uygulamada native, testte CanvasKit).
import { THEME } from '../markdown/render.js'

export const CANVAS_PX_W = 1920
const A4_RATIO = 297 / 210
const TEXT_DEFAULT_BG = '#374151'
const TEXT_DEFAULT_INK = '#e2e8f0'
const DEFAULT_BG = '#1a1a2e'
const SYNC_RED = '#ef4444'
const CARD_GREY = '#3a3f47'
const BOOK_CLOTH = ['#7a3b2e', '#2f4f3e', '#2c3d63', '#6a5233', '#55345e', '#2e5a5f', '#4b4f2a']

const CLIP_INTERSECT = 1
const TILE_CLAMP = 0
const ALIGN_CENTER = 2
const FILTER_LINEAR = 1
const MIPMAP_LINEAR = 2
const COLOR_RGBA_8888 = 4
const ALPHA_UNPREMUL = 3

const a4MaxH = (w) => Math.max(60, Math.round((w || 0) * A4_RATIO))
const clothOf = (key = '') => {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return BOOK_CLOTH[Math.abs(h) % BOOK_CLOTH.length]
}

export function parseCanvas(content) {
  let c = {}
  try { c = JSON.parse(content || '{}') || {} } catch { c = {} }
  return {
    items: Array.isArray(c.items) ? c.items : [],
    bg: c.bg || DEFAULT_BG,
    pan: { x: Number(c.pan?.x) || 0, y: Number(c.pan?.y) || 0 },
    zoom: Number(c.zoom) > 0 ? Number(c.zoom) : 1,
  }
}

export const canvasPxSize = (width, height) => ({ pxW: CANVAS_PX_W, pxH: Math.round(CANVAS_PX_W * (height / width)) })

// Öğenin yüzeydeki kutusu (metin kutusunun yüksekliği içerikle değişir; tahmin için h)
const boxOf = (it) => ({ x: it.x || 0, y: it.y || 0, w: it.w || 0, h: it.type === 'text' ? Math.min(Math.max(it.h || 60, 60), a4MaxH(it.w)) : (it.h || 0) })
export const itemBox = boxOf

/** Öğenin çiziminde kullanılan görsel (yoksa null) */
export function imageUrlOf(it) {
  if (it.type === 'image') return it.url || null
  if (it.type === 'music') return it.coverUrl || null
  if (it.type === 'notebook') return it.cover || null
  if (it.type === 'link' || it.type === 'youtube' || it.type === 'insta') return it.thumbUrl || null
  return null
}

/** Animasyonlu olabilecek görsel (GIF / animasyonlu WebP) — düzenleyici ve duvar kare kare oynatır */
export const isAnimatedUrl = (url) => typeof url === 'string' && (/\.(gif|webp)(\?|#|$)/i.test(url) || /giphy\.com|tenor\.com/i.test(url))

/** Yüzey noktasındaki en üstteki öğe (oklar hariç) */
export function hitTestItems(items, sx, sy) {
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k]
    if (it.type === 'arrow') continue
    const b = boxOf(it)
    if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return it
  }
  return null
}

function visible(it, view, pxW, pxH) {
  if (it.type === 'arrow') return true
  const b = boxOf(it)
  const x0 = b.x * view.zoom + view.pan.x
  const y0 = b.y * view.zoom + view.pan.y
  return x0 < pxW && y0 < pxH && x0 + b.w * view.zoom > 0 && y0 + b.h * view.zoom > 0
}

/** Görünen öğelerin ihtiyaç duyduğu görseller (önden indirilsin diye) */
export function canvasImageUrls(content, width, height) {
  const view = parseCanvas(content)
  const { pxW, pxH } = canvasPxSize(width, height)
  const urls = new Set()
  for (const it of view.items) {
    if (!visible(it, view, pxW, pxH)) continue
    const url = imageUrlOf(it)
    if (url) urls.add(url)
  }
  return [...urls]
}

/**
 * Duvardaki düzlemde dokunulan nokta (uv: 0..1, v yukarı) → üstteki öğe (yoksa null).
 * Metin kutusunun gerçek yüksekliği bilinmediği için h (A4 sınırlı) kullanılır.
 */
export function canvasHitTest(content, width, height, u, v) {
  const view = parseCanvas(content)
  const { pxW, pxH } = canvasPxSize(width, height)
  const sx = (u * pxW - view.pan.x) / view.zoom
  const sy = ((1 - v) * pxH - view.pan.y) / view.zoom
  return hitTestItems(view.items, sx, sy)
}

export function createCanvasRenderer(Skia, md) {
  const { paint, stroke, color, track, tracking } = md
  const pb = () => track(Skia.PathBuilder.Make()) // build() sonucu ayrıca track() ile kayda alınır
  const rect = (x, y, w, h) => Skia.XYWHRect(x, y, w, h)
  const rrect = (x, y, w, h, r) => Skia.RRectXY(rect(x, y, w, h), r, r)
  const text = (t, size, ink, width, { bold, italic, lines, align, lh = 1.3, mono, letterSpacing } = {}) =>
    md.paragraph([{ t: String(t ?? '') }], { size, ink, lh, bold, italic, mono, letterSpacing }, width,
      { ...(lines ? { maxLines: lines, ellipsis: '…' } : {}), ...(align ? { textAlign: align } : {}) })

  const linear = (x0, y0, x1, y1, colors, pos = null) => {
    const p = track(Skia.Paint())
    p.setShader(track(Skia.Shader.MakeLinearGradient(Skia.Point(x0, y0), Skia.Point(x1, y1), colors.map(color), pos, TILE_CLAMP)))
    return p
  }

  // Görseli kutuya çiz: cover (kırp) / contain (sığdır) / fill (gerdir)
  function drawImage(c, img, x, y, w, h, fit = 'fill') {
    const iw = img.width()
    const ih = img.height()
    let src = rect(0, 0, iw, ih)
    let dst = rect(x, y, w, h)
    if (fit === 'cover') {
      const k = Math.max(w / iw, h / ih)
      const sw = w / k
      const sh = h / k
      src = rect((iw - sw) / 2, (ih - sh) / 2, sw, sh)
    } else if (fit === 'contain') {
      const k = Math.min(w / iw, h / ih)
      dst = rect(x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k)
    }
    const p = track(Skia.Paint())
    p.setAntiAlias(true)
    c.drawImageRectOptions(img, src, dst, FILTER_LINEAR, MIPMAP_LINEAR, p)
  }

  const withClip = (c, rr, fn) => { c.save(); c.clipRRect(rr, CLIP_INTERSECT, true); fn(); c.restore() }

  // --- Basit vektör simgeler ---------------------------------------------------

  function iconPicture(c, cx, cy, s, ink) { // çerçeve + dağ
    const p = stroke(ink, 3 * s)
    c.drawRRect(rrect(cx - 28 * s, cy - 22 * s, 56 * s, 44 * s, 6 * s), p)
    const path = track(pb().moveTo(cx - 22 * s, cy + 14 * s).lineTo(cx - 6 * s, cy - 4 * s)
      .lineTo(cx + 4 * s, cy + 6 * s).lineTo(cx + 10 * s, cy).lineTo(cx + 22 * s, cy + 14 * s).close().build())
    c.drawPath(path, paint(ink))
    c.drawCircle(cx + 12 * s, cy - 10 * s, 4 * s, paint(ink))
  }
  function iconLink(c, cx, cy, s, ink) { // iki halka
    const p = stroke(ink, 5 * s)
    c.drawRRect(rrect(cx - 30 * s, cy - 10 * s, 34 * s, 20 * s, 10 * s), p)
    c.drawRRect(rrect(cx - 4 * s, cy - 10 * s, 34 * s, 20 * s, 10 * s), p)
  }
  function iconHouse(c, x, cy, s, ink) {
    const path = track(pb().moveTo(x, cy - 1 * s).lineTo(x + 13 * s, cy - 13 * s).lineTo(x + 26 * s, cy - 1 * s)
      .moveTo(x + 4 * s, cy - 4 * s).lineTo(x + 4 * s, cy + 12 * s).lineTo(x + 22 * s, cy + 12 * s).lineTo(x + 22 * s, cy - 4 * s).build())
    const p = stroke(ink, 2.6 * s)
    p.setStrokeJoin(1)
    p.setStrokeCap(1)
    c.drawPath(path, p)
    c.drawRect(rect(x + 10.5 * s, cy + 3 * s, 5 * s, 9 * s), paint(ink))
  }
  function iconNote(c, cx, cy, s, ink) { // sekizlik nota
    c.drawOval(rect(cx - 30 * s, cy + 14 * s, 30 * s, 22 * s), paint(ink))
    c.drawRect(rect(cx - 6 * s, cy - 40 * s, 6 * s, 66 * s), paint(ink))
    const flag = track(pb().moveTo(cx, cy - 40 * s).cubicTo(cx + 8 * s, cy - 24 * s, cx + 30 * s, cy - 20 * s, cx + 22 * s, cy + 4 * s)
      .cubicTo(cx + 22 * s, cy - 12 * s, cx + 10 * s, cy - 16 * s, cx, cy - 20 * s).close().build())
    c.drawPath(flag, paint(ink))
  }
  function playTriangle(c, cx, cy, r, ink) {
    const path = track(pb().moveTo(cx - r * 0.45, cy - r * 0.6).lineTo(cx + r * 0.65, cy).lineTo(cx - r * 0.45, cy + r * 0.6).close().build())
    c.drawPath(path, paint(ink))
  }
  function youtubeLogo(c, cx, cy) { // 64 × 44 (web SVG ölçüsü)
    c.drawRRect(rrect(cx - 32, cy - 22, 64, 44, 12), paint('#ff0000'))
    playTriangle(c, cx + 2, cy, 14, '#ffffff')
  }
  function pdfGlyph(c, cx, cy, size) { // web PdfGlyph: katlanmış köşeli sayfa + kırmızı etiket
    const k = size / 100
    const x0 = cx - 50 * k
    const y0 = cy - 61 * k
    const page = track(pb().moveTo(x0 + 8 * k, y0 + 4 * k).lineTo(x0 + 68 * k, y0 + 4 * k).lineTo(x0 + 96 * k, y0 + 32 * k)
      .lineTo(x0 + 96 * k, y0 + 114 * k).lineTo(x0 + 4 * k, y0 + 114 * k).lineTo(x0 + 4 * k, y0 + 8 * k).close().build())
    c.drawPath(page, paint('#f8fafc'))
    const fold = track(pb().moveTo(x0 + 68 * k, y0 + 4 * k).lineTo(x0 + 68 * k, y0 + 32 * k).lineTo(x0 + 96 * k, y0 + 32 * k).close().build())
    c.drawPath(fold, paint('#cbd5e1'))
    for (const [ry, rw] of [[46, 52], [56, 64], [104, 40]]) c.drawRRect(rrect(x0 + 18 * k, y0 + ry * k, rw * k, 4 * k, 2 * k), paint('#e2e8f0'))
    c.drawRRect(rrect(x0 - 6 * k, y0 + 70 * k, 80 * k, 28 * k, 5 * k), paint('#dc2626'))
    const t = text('PDF', 19 * k, '#ffffff', 80 * k, { bold: true, align: ALIGN_CENTER, letterSpacing: 1.5 * k, lh: 1 })
    t.paint(c, x0 - 6 * k, y0 + 84 * k - t.getHeight() / 2)
  }

  // --- Kartlar ----------------------------------------------------------------

  // Metin kutusunun içeriği (yerleşmiş) ve çizimdeki yüksekliği (A4 sınırlı)
  function layoutText(it) {
    const w = it.w || 300
    const fs = it.fontSize || 30
    const ink = it.color || TEXT_DEFAULT_INK
    const inner = Math.max(1, w - 28)
    let contentH
    let drawContent
    if (it.markdown && it.content) {
      const box = md.layoutBox(it.content, { base: fs, lh: 1.5, ink, th: THEME.dark, width: inner })
      contentH = box.height
      drawContent = (c, x, y) => box.draw(c, x, y)
    } else {
      const p = md.plainParagraph(it.content ?? '', { base: fs, lh: 1.25, ink, width: inner })
      contentH = p.getHeight()
      drawContent = (c, x, y) => p.paint(c, x, y)
    }
    const maxH = a4MaxH(w)
    return { w, h: Math.min(maxH, Math.max(Math.min(it.h || 60, maxH), contentH + 28)), drawContent }
  }

  function drawTextItem(c, it) {
    const bg = it.bgColor !== undefined ? it.bgColor : TEXT_DEFAULT_BG
    const { w, h, drawContent } = layoutText(it)
    const rr = rrect(it.x, it.y, w, h, 4)
    if (bg && bg !== 'transparent') c.drawRRect(rr, paint(bg))
    withClip(c, rr, () => drawContent(c, it.x + 14, it.y + 14))
  }

  /** Metin kutusunun çizildiği yükseklik (web measureTextItemH): seçim çerçevesi içerikle örtüşsün */
  const textHeight = (it) => tracking(() => Math.ceil(layoutText({ ...it, h: 60 }).h))

  function drawRoom(c, it, here) {
    const { x, y, w, h } = it
    const rr = rrect(x, y, w, h, 8)
    c.drawRRect(rr, paint(it.bgColor ?? 'rgba(96, 165, 250, 0.1)'))
    if (here) {
      c.drawRRect(rrect(x - 2, y - 2, w + 4, h + 4, 10), stroke('rgba(34, 197, 94, 0.35)', 3))
      c.drawRRect(rrect(x + 1, y + 1, w - 2, h - 2, 7), stroke('#22c55e', 2))
    } else {
      c.drawRRect(rrect(x + 0.5, y + 0.5, w - 1, h - 1, 7.5), stroke('rgba(96, 165, 250, 0.35)', 1))
    }
    withClip(c, rr, () => {
      const cy = y + h / 2
      iconHouse(c, x + 18, cy, 1.1, '#93c5fd')
      const tx = x + 18 + 30 + 10
      const t = text(it.roomName || 'Oda', 28, '#93c5fd', Math.max(1, x + w - 18 - tx), { lines: 1, lh: 1.2 })
      t.paint(c, tx, cy - t.getHeight() / 2)
      const lw = Math.min(t.getLongestLine(), x + w - 18 - tx)
      c.drawRect(rect(tx, cy + t.getHeight() / 2 - 2, lw, 1.6), paint('#93c5fd')) // altı çizili
    })
  }

  function bottomCaption(c, it, img, title, sub, { titleSize = 28, lines = 3 } = {}) {
    const { x, y, w, h } = it
    const tw = Math.max(1, w - 28)
    const t = title ? text(title, titleSize, '#ffffff', tw, { bold: true, lines, lh: 1.35 }) : null
    const s = sub ? text(sub, 20, 'rgba(255, 255, 255, 0.7)', tw, { lines: 1, lh: 1.3 }) : null
    if (!t && !s) return
    const oh = 28 + (t ? t.getHeight() : 0) + (s ? 6 + s.getHeight() : 0) + 12
    const oy = y + h - oh
    if (img) c.drawRect(rect(x, oy, w, oh), linear(x, oy, x, y + h, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.88)']))
    else c.drawRect(rect(x, oy, w, oh), paint('rgba(0, 0, 0, 0.25)'))
    let ty = oy + 28
    if (t) { t.paint(c, x + 14, ty); ty += t.getHeight() + 6 }
    if (s) s.paint(c, x + 14, ty)
  }

  function drawLink(c, it, img) {
    const rr = rrect(it.x, it.y, it.w, it.h, 4)
    withClip(c, rr, () => {
      c.drawRRect(rr, paint(CARD_GREY))
      if (img) drawImage(c, img, it.x, it.y, it.w, it.h, 'cover')
      else iconLink(c, it.x + it.w / 2, it.y + it.h / 2, Math.min(1.6, it.w / 200), 'rgba(255, 255, 255, 0.35)')
      bottomCaption(c, it, img, it.title || it.url, it.siteName)
    })
  }

  function drawYoutube(c, it, img) {
    const rr = rrect(it.x, it.y, it.w, it.h, 4)
    withClip(c, rr, () => {
      c.drawRRect(rr, paint('#000000'))
      if (img) drawImage(c, img, it.x, it.y, it.w, it.h, 'cover')
      youtubeLogo(c, it.x + it.w / 2, it.y + it.h / 2)
      if (it.title) bottomCaption(c, it, true, it.title, null, { lines: 4 })
    })
  }

  function drawInsta(c, it, img) {
    const rr = rrect(it.x, it.y, it.w, it.h, 22)
    withClip(c, rr, () => {
      c.drawRRect(rr, paint('#0b0b0b'))
      const user = String(it.title || 'instagram').split(/[:\n]/)[0].trim() || 'instagram'
      const head = 70
      c.drawCircle(it.x + 14 + 23, it.y + head / 2, 23, linear(it.x, it.y + head, it.x + 46, it.y, ['#f09433', '#dc2743', '#bc1888']))
      const t = text(user, 24, '#ffffff', it.w - 90, { bold: true, lines: 1 })
      t.paint(c, it.x + 70, it.y + head / 2 - t.getHeight() / 2)
      const my = it.y + head
      const mh = Math.max(1, it.h - head - 70)
      c.drawRect(rect(it.x, my, it.w, mh), paint('#000000'))
      if (img) drawImage(c, img, it.x, my, it.w, mh, 'contain')
      else c.drawRect(rect(it.x, my, it.w, mh), linear(it.x, my + mh, it.x + it.w, my, ['#f09433', '#dc2743', '#bc1888']))
    })
  }

  function drawMusic(c, it, img) {
    const { x, y, w, h } = it
    const rr = rrect(x, y, w, h, 18)
    withClip(c, rr, () => {
      c.drawRRect(rr, linear(x, y, x + w * 0.34, y + h, ['#1f2937', '#0b0f16']))
      const cw = w - 32
      const cr = rrect(x + 16, y + 16, cw, cw, 12)
      withClip(c, cr, () => {
        if (img) drawImage(c, img, x + 16, y + 16, cw, cw, 'cover')
        else {
          c.drawRRect(cr, linear(x + 16, y + 16, x + 16 + cw, y + 16 + cw, ['#6d28d9', '#db2777']))
          iconNote(c, x + 16 + cw / 2, y + 16 + cw / 2, cw / 220, 'rgba(255, 255, 255, 0.85)')
        }
      })
      let ty = y + 16 + cw + 16
      const t = text(it.title || '', 26, '#ffffff', w - 32, { bold: true, lines: 1, align: ALIGN_CENTER })
      t.paint(c, x + 16, ty)
      ty += t.getHeight() + 6
      const a = text(it.artist || '—', 20, 'rgba(255, 255, 255, 0.6)', w - 32, { lines: 1, align: ALIGN_CENTER })
      a.paint(c, x + 16, ty)
      ty += a.getHeight()
      const cy = ty + Math.max(30, (y + h - 16 - ty) / 2)
      if (cy + 30 <= y + h) {
        c.drawCircle(x + w / 2, cy, 30, paint('rgba(255, 255, 255, 0.14)'))
        playTriangle(c, x + w / 2 + 2, cy, 13, '#ffffff')
      }
    })
  }

  const formatBytes = (n) => {
    if (!n) return ''
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / 1024 / 1024).toFixed(1)} MB`
  }

  function drawPdf(c, it) {
    const { x, y, w, h } = it
    const rr = rrect(x, y, w, h, 18)
    withClip(c, rr, () => {
      c.drawRRect(rr, linear(x, y, x + w * 0.34, y + h, ['#2a1215', '#0b0f16'], [0, 0.7]))
      const iw = w - 32
      const t = text(it.title || 'PDF', 24, '#ffffff', iw, { bold: true, lines: 2, align: ALIGN_CENTER })
      const metaStr = [it.pages > 0 ? `${it.pages} sayfa` : '', formatBytes(it.size)].filter(Boolean).join(' · ') || 'PDF belgesi'
      const m = text(metaStr, 18, 'rgba(255, 255, 255, 0.55)', iw, { lines: 1, align: ALIGN_CENTER })
      const btnH = 52
      const bottom = 14 + t.getHeight() + 6 + Math.max(22, m.getHeight()) + 14 + btnH + 16
      const areaH = Math.max(40, h - 16 - bottom)
      const ar = rrect(x + 16, y + 16, iw, areaH, 12)
      const glow = track(Skia.Paint())
      glow.setShader(track(Skia.Shader.MakeRadialGradient(Skia.Point(x + 16 + iw / 2, y + 16 + areaH * 0.4), Math.max(iw, areaH) * 0.7,
        [color('rgba(220, 38, 38, 0.28)'), color('rgba(255, 255, 255, 0.03)')], null, TILE_CLAMP)))
      c.drawRRect(ar, glow)
      pdfGlyph(c, x + 16 + iw / 2, y + 16 + areaH / 2, Math.min(150, areaH / 1.3, iw * 0.8))
      let ty = y + 16 + areaH + 14
      t.paint(c, x + 16, ty)
      ty += t.getHeight() + 6
      m.paint(c, x + 16, ty)
      ty += Math.max(22, m.getHeight()) + 14
      c.drawRRect(rrect(x + 16, ty, iw, btnH, 12), paint('#dc2626'))
      const b = text('Aç ↗', 20, '#ffffff', iw, { bold: true, align: ALIGN_CENTER, lh: 1 })
      b.paint(c, x + 16, ty + btnH / 2 - b.getHeight() / 2)
    })
  }

  function drawNotebook(c, it, img) {
    const { x, y, w, h } = it
    const u = w / 300
    const rr = rrect(x, y, w, h, 8 * u)
    withClip(c, rr, () => {
      c.drawRRect(rr, paint(clothOf(it.src)))
      if (img) drawImage(c, img, x, y, w, h, 'cover')
      c.drawRect(rect(x, y, 22 * u, h), linear(x, y, x + 22 * u, y, ['rgba(0, 0, 0, 0.55)', 'rgba(0, 0, 0, 0.25)', 'rgba(255, 255, 255, 0.08)'], [0, 0.7, 1]))
      const t = text(it.name || 'Defter', 30 * u, '#f7f2e4', w - 60 * u, { italic: true, lines: 3, lh: 1.08 })
      c.drawRect(rect(x + 22 * u, y + h - t.getHeight() - 36 * u, w - 22 * u, t.getHeight() + 36 * u), paint('rgba(0, 0, 0, 0.35)'))
      t.paint(c, x + 38 * u, y + h - t.getHeight() - 18 * u)
    })
  }

  function drawImageItem(c, it, img) {
    const rr = rrect(it.x, it.y, it.w, it.h, 4)
    withClip(c, rr, () => {
      if (img) drawImage(c, img, it.x, it.y, it.w, it.h, 'fill')
      else {
        c.drawRRect(rr, paint(CARD_GREY))
        iconPicture(c, it.x + it.w / 2, it.y + it.h / 2, Math.min(1.4, it.w / 160), 'rgba(255, 255, 255, 0.35)')
      }
    })
  }

  function drawArrow(c, it) {
    const sw = it.strokeWidth || 4
    const ink = it.color || '#e2e8f0'
    const p = stroke(ink, sw)
    const dx = it.x2 - it.x1
    const dy = it.y2 - it.y1
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    // SVG marker (10 × 7, refX 9) çizgi kalınlığıyla ölçeklenir
    const head = it.hasArrow ? 9 * sw : 0
    c.drawLine(it.x1, it.y1, it.x2 - ux * head * 0.6, it.y2 - uy * head * 0.6, p)
    if (it.hasArrow) {
      const tipX = it.x2 + ux * sw
      const tipY = it.y2 + uy * sw
      const bx = tipX - ux * 10 * sw
      const by = tipY - uy * 10 * sw
      const nx = -uy * 3.5 * sw
      const ny = ux * 3.5 * sw
      const path = track(pb().moveTo(tipX, tipY).lineTo(bx + nx, by + ny).lineTo(bx - nx, by - ny).close().build())
      c.drawPath(path, paint(ink))
    }
  }

  function drawSyncMark(c, pxW, count) {
    const label = `SYNC${count ? ` · ${count}` : ''}`
    const t = text(label, 26, '#ffffff', 600, { bold: true, mono: true, letterSpacing: 2, lh: 1.2 })
    const bw = t.getLongestLine() + 32
    const bh = t.getHeight() + 12
    c.drawRRect(rrect(pxW - 18 - bw, 18, bw, bh, bh / 2), paint(SYNC_RED))
    t.paint(c, pxW - 18 - bw + 16, 24)
  }

  /**
   * Öğeleri yüzey koordinatlarında (pan/zoom uygulanmadan) çizer; oklar en üstte.
   * getImage(url) → SkImage|null; releaseImage(img) çizimden sonra çağrılır
   * (varsayılan: bırak). filter(it) → false olan öğe atlanır (ok hariç).
   */
  function drawItems(c, items, { getImage = () => null, releaseImage = (img) => img?.dispose?.(), currentRoomId, filter } = {}) {
    for (const it of items) {
      if (it.type === 'arrow' || (filter && !filter(it))) continue
      const url = imageUrlOf(it)
      const img = url ? getImage(url) : null
      try {
        switch (it.type) {
          case 'image': drawImageItem(c, it, img); break
          case 'text': drawTextItem(c, it); break
          case 'room': drawRoom(c, it, !!it.roomId && it.roomId === currentRoomId); break
          case 'link': drawLink(c, it, img); break
          case 'youtube': drawYoutube(c, it, img); break
          case 'insta': drawInsta(c, it, img); break
          case 'music': drawMusic(c, it, img); break
          case 'pdf': drawPdf(c, it); break
          case 'notebook': drawNotebook(c, it, img); break
          default: c.drawRRect(rrect(it.x, it.y, it.w || 0, it.h || 0, 4), paint('rgba(255, 255, 255, 0.06)'))
        }
      } finally {
        if (img) releaseImage(img)
      }
    }
    for (const it of items) if (it.type === 'arrow') drawArrow(c, it)
  }

  /**
   * Öğeleri vektörel bir SkPicture'a kaydeder (tam ekran düzenleyici: pan/zoom'da
   * yeniden çizim gerekmez). Ara nesneler bırakılır; picture çağıranındır.
   */
  function recordItems(items, opts = {}) {
    return tracking(() => {
      const rec = track(Skia.PictureRecorder())
      const c = rec.beginRecording(rect(-1e5, -1e5, 2e5, 2e5))
      drawItems(c, items, opts)
      return rec.finishRecordingAsPicture()
    })
  }

  /**
   * Canvas'ı piksellere çizer.
   * opts: { scale (1 = 1920 px genişlik), getImage(url) → SkImage|null (çizimden sonra
   *         dispose edilir), currentRoomId, syncGroupId, syncCount }
   * → { pixels (RGBA düz alfa), pw, ph, image }
   */
  function render(content, width, height, opts = {}) {
    return tracking(() => renderNow(content, width, height, opts))
  }

  function renderNow(content, width, height, { scale = 1, getImage = () => null, currentRoomId, syncGroupId, syncCount, keepImage = false }) {
    const view = parseCanvas(content)
    const { pxW, pxH } = canvasPxSize(width, height)
    const pw = Math.max(1, Math.round(pxW * scale))
    const ph = Math.max(1, Math.round(pxH * scale))
    const surface = Skia.Surface.Make(pw, ph)
    const c = surface.getCanvas()
    c.clear(Skia.Color('transparent'))
    c.save()
    c.scale(pw / pxW, ph / pxH)
    const tile = rrect(0, 0, pxW, pxH, 4)
    c.drawRRect(tile, paint(view.bg))
    c.clipRRect(tile, CLIP_INTERSECT, true)

    c.save()
    c.translate(view.pan.x, view.pan.y)
    c.scale(view.zoom, view.zoom)
    drawItems(c, view.items, { getImage, currentRoomId, filter: (it) => visible(it, view, pxW, pxH) })
    c.restore()

    if (!view.items.length) {
      const t = text('boş canvas', 26, 'rgba(255, 255, 255, 0.18)', pxW, { align: ALIGN_CENTER })
      t.paint(c, 0, pxH / 2 - t.getHeight() / 2)
    }
    if (syncGroupId) {
      c.drawRRect(rrect(4, 4, pxW - 8, pxH - 8, 4), stroke(SYNC_RED, 8))
      drawSyncMark(c, pxW, syncCount)
    }
    c.restore()
    surface.flush()
    const image = surface.makeImageSnapshot()
    const pixels = image.readPixels(0, 0, { width: pw, height: ph, colorType: COLOR_RGBA_8888, alphaType: ALPHA_UNPREMUL })
    if (!keepImage) image.dispose?.()
    surface.dispose?.()
    return { pixels, pw, ph, image: keepImage ? image : null }
  }

  return { render, recordItems, textHeight }
}
