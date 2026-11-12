// Medya satırlarını (serializeMedia şekli) mobil gösterime çeviren saf yardımcılar.
// Hem 3D paneller hem detay sayfası kullanır.

export function parseJson(content, fallback = {}) {
  try { return JSON.parse(content) ?? fallback } catch { return fallback }
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Markdown → düz metin (3D panelde biçim yok; okunabilir özet)
export function stripMarkdown(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ x]\]\s+/gim, '• ')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`~]/g, '')
    .trim()
}

export function youtubeId(url) {
  const s = String(url ?? '')
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

export const youtubeThumb = (url) => {
  const id = youtubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i

// Tür → panel görünümü
export const TYPE_META = {
  image: { label: 'Görsel', tint: '#1b1b20' },
  video: { label: 'Video', tint: '#111114', icon: '▶' },
  youtube: { label: 'YouTube', tint: '#1a0d0d', icon: '▶' },
  embed: { label: 'Gömülü sayfa', tint: '#10141a', icon: '↗' },
  markdown: { label: 'Not', tint: '#f4f1ea', ink: '#1d1b18' },
  canvas: { label: 'Canvas', tint: '#1a1a2e' },
  header: { label: 'Başlık', tint: '#1a1a2e' },
  defter: { label: 'Defter', tint: '#efe6d2', ink: '#3a2f22' },
  session: { label: 'Claude oturumu', tint: '#151a17', icon: '✳' },
  roomchat: { label: 'Oda sohbeti', tint: '#151a17', icon: '✳' },
  roomsession: { label: 'Oda projesi', tint: '#13161c', icon: '⌘' },
  projectview: { label: 'Proje önizleme', tint: '#13161c', icon: '↗' },
  bluprint: { label: 'Blueprint', tint: '#0f1a2b', icon: '⌗' },
  multiagent: { label: 'Çoklu ajan', tint: '#171320', icon: '✳' },
  slide: { label: 'Slayt', tint: '#16161a' },
}

export const metaFor = (type) => TYPE_META[type] ?? { label: type, tint: '#16161a' }

// Panelde dokuya dönüşecek görsel (yoksa null)
export function panelImage(item) {
  if (item.type === 'image') return item.url
  if (item.type === 'slide' && IMAGE_EXT.test(item.url ?? '')) return item.url
  if (item.type === 'youtube') return youtubeThumb(item.url)
  return null
}

// Panelde yazılacak metin + renkler
export function panelText(item) {
  const meta = metaFor(item.type)
  switch (item.type) {
    case 'header': {
      const c = parseJson(item.content)
      return { text: c.text ?? '', bg: c.bg ?? '#1a1a2e', color: c.color ?? '#ffffff', fit: 'title' }
    }
    case 'markdown':
      return { text: stripMarkdown(item.content), bg: meta.tint, color: meta.ink, fit: 'body' }
    case 'defter': {
      const c = parseJson(item.content, { pages: [] })
      const titles = (c.pages ?? []).map((p) => p.title?.trim()).filter(Boolean)
      return { text: ['Defter', ...titles.slice(0, 6).map((t) => `• ${t}`)].join('\n'), bg: meta.tint, color: meta.ink, fit: 'body' }
    }
    case 'canvas':
      return { text: '', bg: parseJson(item.content).bg ?? meta.tint, color: '#ffffff', fit: 'title' }
    case 'image':
    case 'slide':
      return { text: '', bg: meta.tint, color: '#ffffff', fit: 'title' }
    case 'youtube':
    case 'video':
    case 'embed': {
      // RN'in URL polyfill'i host'u her sürümde desteklemiyor → regex
      const host = (String(item.url ?? '').match(/^https?:\/\/([^/?#]+)/i)?.[1] ?? '').replace(/^www\./, '')
      return { text: `${meta.icon ?? ''} ${meta.label}${host && item.type === 'embed' ? `\n${host}` : ''}`.trim(), bg: meta.tint, color: '#e8e6e1', fit: 'title' }
    }
    default:
      return { text: `${meta.icon ?? ''} ${meta.label}`.trim(), bg: meta.tint, color: '#d9f7ef', fit: 'title' }
  }
}
