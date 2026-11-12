// Paketlenen dokuların expo-gl (stb_image) tarafından çözülebildiğini denetler.
// Uzantı değil içerik önemlidir: WebP/HEIC/AVIF dosyası .jpg adıyla bile siyah görünür.
// Kullanım: node scripts/check-textures.mjs   (hata varsa çıkış kodu 1)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'textures')

function kind(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // Segmentleri uzunluklarıyla yürü, ilk SOF işaretçisine bak. stb_image
    // baseline (C0/C1) ve progressive (C2) çözer; lossless/aritmetik kodlamayı çözmez.
    let i = 2
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return 'jpeg (bozuk)'
      const m = b[i + 1]
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) return 'jpeg'
      if (m >= 0xc3 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return 'jpeg (desteklenmeyen kodlama)'
      i += 2 + b.readUInt16BE(i + 2)
    }
    return 'jpeg (SOF yok)'
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return 'heic/avif'
  return 'bilinmiyor'
}

let bad = 0
for (const f of fs.readdirSync(dir)) {
  const k = kind(fs.readFileSync(path.join(dir, f)))
  const ok = k === 'jpeg' || k === 'png'
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${f}: ${k}`)
}
process.exit(bad ? 1 : 0)
