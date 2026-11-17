// Kitaplıkta bir rafa yan yana kaç defter sığar; raflar ekranın eni kadardır
export const BOOKS_PER_SHELF = 3

// Her kategorinin kitaplığı en az bu kadar raftan oluşur; dolunca aşağıya yeni raflar eklenir
export const DEFAULT_SHELF_COUNT = 5

// Yeni defterin gireceği raf: yukarıdan aşağı, yeri olan ilk raf; hepsi doluysa en alta yeni raf.
// counts: her raftaki defter sayısı
export function nextShelf(counts) {
  const shelf = counts.findIndex((count) => count < BOOKS_PER_SHELF)
  return shelf === -1 ? counts.length : shelf
}

// Defter bir rafa girince raf taşarsa en sağdaki defter alttaki rafın başına iner; o da taşarsa
// bir alttakine, ... shelves yerinde değişir.
export function settleOverflow(shelves, from) {
  for (let s = from; s < shelves.length && shelves[s].length > BOOKS_PER_SHELF; s++) {
    if (s + 1 === shelves.length) shelves.push([])
    shelves[s + 1].unshift(...shelves[s].splice(BOOKS_PER_SHELF))
  }
}
