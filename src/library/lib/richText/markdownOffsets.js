// Bir token'ın içindeki token listeleri (tablo hücreleri sırayla, satır satır)
function childLists(token) {
  switch (token.type) {
    case 'list':
      return token.items
    case 'table': {
      const table = token
      return [...table.header, ...table.rows.flat()]
    }
    default:
      return 'tokens' in token && Array.isArray(token.tokens) ? [{ tokens: token.tokens }] : []
  }
}

// Her token kardeşlerinden sonra, üstündeki token'ın ham yazısının içinde aranır. Alıntı ve iç içe
// liste gibi marked'ın girintiyi silip yeniden okuduğu yerlerde token bulunamaz; orada işaretler
// çizilmez, yazı yine doğru görünür.
function locate(tokens, source, base, map) {
  let cursor = 0
  for (const token of tokens) {
    let raw = token.raw ?? token.text ?? ''
    let at = raw === '' ? -1 : source.indexOf(raw, cursor)
    // marked boş liste maddesinin sonundaki boşluğu siler ("- " → "-\n"); sondaki boşluklar olmadan
    // da aranır
    if (at < 0 && raw.trimEnd() !== '' && raw.trimEnd() !== raw) {
      raw = raw.trimEnd()
      at = source.indexOf(raw, cursor)
    }
    if (at < 0) continue
    map.set(token, base + at)
    cursor = at + raw.length
    if (!('type' in token)) {
      // Tablo hücresi
      if (token.tokens) locate(token.tokens, raw, base + at, map)
      continue
    }
    const type = token.type
    const lists = childLists(token)
    if (type === 'list' || type === 'table') locate(lists, raw, base + at, map)
    else for (const list of lists) if (list.tokens) locate(list.tokens, raw, base + at, map)
  }
  return map
}

// Token'ların (iç içe olanlar dahil) ham yazıdaki başlangıçları; bulunamayanlar haritada yoktur
export function locateTokens(tokens, source) {
  return locate(tokens, source, 0, new Map())
}
