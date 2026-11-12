// Metin (markdown) tile için küçük bir markdown ayrıştırıcı. Web, metni `marked`
// (GFM, breaks: false) ile HTML'e çevirip DOM'da çizer; mobilde DOM olmadığından
// içerik bloklara ayrılır ve Skia ile dokuya çizilir (bkz. render.js).
// Kapsam: başlık (# / setext), paragraf, madde/numaralı/görev listesi (iç içe),
// alıntı (iç içe), kod bloğu (```/~~~), yatay çizgi, GFM tablo; satır içinde
// kalın, italik, üstü çizili, `kod`, bağlantı, otomatik bağlantı, görsel (alt metni).
// HTML etiketleri atılır (<br> → satır sonu). React Native'e bağlı değildir.
//
// Blok: { type, quote, ... }
//   heading { level, inlines }   para { inlines }   code { lang, text }   hr
//   li { depth, marker, inlines, last }   table { header: [inlines], rows: [[inlines]] }
// Satır içi parça (run): { t, b?, i?, c?, s?, a? }  (kalın, italik, kod, üstü çizili, bağlantı)

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
const decodeEntities = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+[0-9]*);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : m
  }
  return ENTITIES[e.toLowerCase()] ?? m
})

// --- Satır içi -------------------------------------------------------------------

const PUNCT = /[!-/:-@[-`{-~]/
const isWord = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch)

// Kapanış işaretini bul: içerik boş olmamalı, boşlukla başlayıp bitmemeli
function findClose(src, from, marker) {
  let j = from
  for (;;) {
    j = src.indexOf(marker, j)
    if (j < 0) return -1
    if (j > from && src[j - 1] !== ' ' && src[j - 1] !== '\\') {
      if (marker.length === 1 && src[j + 1] === marker) { j += 2; continue } // ** içindeki *
      if (marker === '_' && isWord(src[j + 1])) { j++; continue }          // kelime_içi_alt_çizgi
      return j
    }
    j++
  }
}

export function parseInline(src, style = {}, out = []) {
  let buf = ''
  const flush = () => { if (buf) { out.push({ ...style, t: decodeEntities(buf) }); buf = '' } }
  const push = (t, extra) => { flush(); out.push({ ...style, ...extra, t }) }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const rest = src.slice(i)
    let m

    if (ch === '\\' && PUNCT.test(src[i + 1] ?? '')) { buf += src[i + 1]; i += 2; continue }
    if (ch === '\\' && src[i + 1] === '\n') { buf += '\n'; i += 2; continue }

    if (ch === '`' && (m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) {
      let code = m[2].replace(/\n/g, ' ')
      if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1)
      push(code, { c: true })
      i += m[0].length
      continue
    }
    if (ch === '!' && (m = /^!\[([^\]]*)\]\(\s*<?[^)\s>]*>?(?:\s+["'][^"']*["'])?\s*\)/.exec(rest))) {
      if (m[1]) push(m[1], { i: true })
      i += m[0].length
      continue
    }
    if (ch === '[' && (m = /^\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+["'][^"']*["'])?\s*\)/.exec(rest))) {
      flush()
      parseInline(m[1], { ...style, a: m[2] || '#' }, out)
      i += m[0].length
      continue
    }
    if (ch === '<') {
      if ((m = /^<((?:https?|mailto):[^>\s]+)>/i.exec(rest))) { push(m[1], { a: m[1] }); i += m[0].length; continue }
      if ((m = /^<br\s*\/?>/i.exec(rest))) { buf += '\n'; i += m[0].length; continue }
      if ((m = /^<\/?[a-z][^>]*>/i.exec(rest)) || (m = /^<!--[\s\S]*?-->/.exec(rest))) { i += m[0].length; continue }
    }
    if ((ch === 'h' || ch === 'w') && !isWord(src[i - 1]) && (m = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;"'!?)\]]/i.exec(rest))) {
      push(m[0], { a: m[0].startsWith('www.') ? `http://${m[0]}` : m[0] })
      i += m[0].length
      continue
    }
    if ((ch === '*' || ch === '_' || ch === '~') && src[i + 1] === ch) {
      const marker = ch + ch
      const leftOk = ch !== '_' || !isWord(src[i - 1])
      const end = leftOk && src[i + 2] !== ' ' ? findClose(src, i + 2, marker) : -1
      if (end > i + 2) {
        flush()
        parseInline(src.slice(i + 2, end), { ...style, ...(ch === '~' ? { s: true } : { b: true }) }, out)
        i = end + 2
        continue
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ' ' && src[i + 1] !== ch) {
      const leftOk = ch !== '_' || !isWord(src[i - 1])
      const end = leftOk ? findClose(src, i + 1, ch) : -1
      if (end > i + 1) {
        flush()
        parseInline(src.slice(i + 1, end), { ...style, i: true }, out)
        i = end + 1
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}

// --- Bloklar ----------------------------------------------------------------------

const RE = {
  blank: /^\s*$/,
  fence: /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/,
  heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}>[ ]?/,
  list: /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/,
  tableSep: /^ *\|?(?: *:?-+:? *\|)+(?: *:?-+:? *)?\|? *$|^ *\|? *:?-+:? *\| *:?-+:? *\|? *$/,
  setext1: /^ {0,3}=+[ \t]*$/,
  setext2: /^ {0,3}-+[ \t]*$/,
}

const splitRow = (line) => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

const startsBlock = (line, next) =>
  RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) ||
  RE.list.test(line) || (line.includes('|') && next !== undefined && RE.tableSep.test(next))

// Paragraf satırlarını birleştir: GFM'de tek satır sonu boşluktur;
// iki boşluk ya da \ ile biten satır gerçek satır sonudur.
const joinLines = (lines) => lines.map((l, k) => {
  const last = k === lines.length - 1
  const t = l.replace(/^[ \t]+/, '')
  if (last) return t.replace(/[ \t]+$/, '')
  if (/ {2,}$/.test(t)) return `${t.replace(/ +$/, '')}\n`
  if (/\\$/.test(t)) return `${t.slice(0, -1)}\n`
  return `${t.replace(/[ \t]+$/, '')} `
}).join('')

export function parseMarkdown(content, quote = 0) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  const blocks = []
  const counters = [] // numaralı liste sayaçları (derinliğe göre)
  let listOpen = false
  let listKind = null
  const closeList = () => {
    if (!listOpen) return
    for (let k = blocks.length - 1; k >= 0; k--) if (blocks[k].type === 'li') { blocks[k].last = true; break }
    listOpen = false
    counters.length = 0
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    let m

    if (RE.blank.test(line)) {
      // Boş satır listeyi bitirmez (gevşek liste); sonraki liste dışı satır bitirir
      i++
      continue
    }

    if ((m = RE.fence.exec(line))) {
      closeList()
      const fence = m[1]
      const body = []
      i++
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++ // kapanış (yoksa belge sonu)
      blocks.push({ type: 'code', quote, lang: m[2] || '', text: body.join('\n') })
      continue
    }

    if ((m = RE.heading.exec(line))) {
      closeList()
      blocks.push({ type: 'heading', quote, level: m[1].length, inlines: parseInline(m[2] ?? '') })
      i++
      continue
    }

    if (RE.hr.test(line)) {
      closeList()
      blocks.push({ type: 'hr', quote })
      i++
      continue
    }

    if (RE.quote.test(line)) {
      closeList()
      const inner = []
      while (i < lines.length && !RE.blank.test(lines[i])) {
        const l = lines[i]
        if (RE.quote.test(l)) inner.push(l.replace(RE.quote, ''))
        else if (startsBlock(l, lines[i + 1])) break
        else inner.push(l) // tembel devam satırı
        i++
      }
      blocks.push(...parseMarkdown(inner.join('\n'), quote + 1))
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      closeList()
      const header = splitRow(line)
      const n = header.length
      const rows = []
      i += 2
      while (i < lines.length && !RE.blank.test(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i++])
        rows.push(Array.from({ length: n }, (_, k) => parseInline(cells[k] ?? '')))
      }
      blocks.push({ type: 'table', quote, header: header.map((c) => parseInline(c)), rows })
      continue
    }

    if ((m = RE.list.exec(line))) {
      const indent = m[1].length
      const depth = Math.min(4, Math.floor(indent / 2))
      const bullet = m[2]
      // Üst düzeyde liste türü değişirse (madde ↔ numara) yeni liste başlar
      const kind = /^\d/.test(bullet) ? 'ol' : 'ul'
      if (listOpen && depth === 0 && kind !== listKind) closeList()
      if (depth === 0) listKind = kind
      let text = m[3] ?? ''
      i++
      // Devam satırları: girintili ya da tembel (yeni blok başlatmayan) satırlar
      const cont = []
      while (i < lines.length && !RE.blank.test(lines[i]) && !startsBlock(lines[i], lines[i + 1])) cont.push(lines[i++])
      if (cont.length) text = joinLines([text, ...cont])

      let marker
      if (/^\d/.test(bullet)) {
        counters.length = depth + 1
        const n = counters[depth] === undefined ? parseInt(bullet, 10) : counters[depth] + 1
        counters[depth] = n
        marker = `${n}${bullet.slice(-1)}`
      } else {
        counters.length = depth
        marker = ['•', '◦', '▪'][Math.min(depth, 2)]
      }
      let checked = null
      const task = /^\[([ xX])\][ \t]+/.exec(text)
      if (task) { checked = task[1] !== ' '; text = text.slice(task[0].length) }
      if (checked !== null) marker = checked ? '☑' : '☐'
      listOpen = true
      blocks.push({ type: 'li', quote, depth, marker, inlines: parseInline(text), last: false })
      continue
    }

    // Paragraf (ya da setext başlık)
    closeList()
    const para = [line]
    i++
    let setext = 0
    while (i < lines.length && !RE.blank.test(lines[i])) {
      if (RE.setext1.test(lines[i])) { setext = 1; i++; break }
      if (RE.setext2.test(lines[i])) { setext = 2; i++; break }
      if (startsBlock(lines[i], lines[i + 1])) break
      para.push(lines[i++])
    }
    const inlines = parseInline(joinLines(para))
    blocks.push(setext ? { type: 'heading', quote, level: setext, inlines } : { type: 'para', quote, inlines })
  }
  closeList()
  return blocks
}
