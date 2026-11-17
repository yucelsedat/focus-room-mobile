import { GENERAL_CATEGORY_NAME, MAX_CATEGORY_NAME } from '../db'

// Kategori adı: baştaki/sondaki boşluklar atılır, aradaki boşluklar teke iner
export function cleanCategoryName(name) {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_NAME)
}

// Aynı adda (büyük/küçük harf farkı gözetmeden) iki kategori olmaz; Genel'in adı da alınamaz
export function categoryNameTaken(categories, name, exceptId) {
  const key = name.toLocaleLowerCase('tr')
  if (key === GENERAL_CATEGORY_NAME.toLocaleLowerCase('tr')) return true
  return categories.some((c) => c.id !== exceptId && c.name.toLocaleLowerCase('tr') === key)
}
