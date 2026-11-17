// Kitaplık verisi: seyir defterinin db/database.ts fonksiyonlarının focus-room karşılıkları.
// Mobilde cihazdaki SQLite yerine focus-room-main sunucusu (server/library.js, /api/library/*);
// web istemcisi (src/pages/library/api.js) ile aynı uçlar ve aynı veri. Fonksiyonlar orijinal
// imzaları korur, yalnızca ilk parametre (db) yoktur. Alan adları snake_case (category_id, ...).
import { api } from '../api/client'

const R = '/api/library'

function call(method, path, body) {
  return api(`${R}${path}`, { method, body, timeout: 15000 })
}

// Aynı kayda peş peşe giden yazmalar (ör. her tuşta bloğun içeriği) sırayla gider: yolda en fazla
// bir istek olur, beklerken gelenlerden yalnızca sonuncusu gönderilir. Yerel SQLite'ta yazmalar
// sırayla işlenirdi; ağda istekler sırasız tamamlanıp eski içerik yenisinin üstüne yazılabilirdi.
// Birleşen yazmaları bekleyenler, onların yerine giden yazma bitince sonuçlanır.
const lanes = new Map()

function latest(key, send) {
  let lane = lanes.get(key)
  if (!lane) {
    lane = { busy: false, next: null }
    lanes.set(key, lane)
  }
  return new Promise((resolve, reject) => {
    if (lane.next) {
      lane.next.send = send
      lane.next.waiters.push({ resolve, reject })
    } else {
      lane.next = { send, waiters: [{ resolve, reject }] }
    }
    pump(key, lane)
  })
}

async function pump(key, lane) {
  if (lane.busy || !lane.next) return
  const job = lane.next
  lane.next = null
  lane.busy = true
  try {
    const result = await job.send()
    for (const w of job.waiters) w.resolve(result)
  } catch (err) {
    for (const w of job.waiters) w.reject(err)
  } finally {
    lane.busy = false
    if (lane.next) pump(key, lane)
    else lanes.delete(key)
  }
}

export const GENERAL_CATEGORY_ID = 1
export const GENERAL_CATEGORY_NAME = 'Genel'
export const MAX_CATEGORY_NAME = 20
// Not defteri bu kadar sayfayla başlar (sunucuda da aynı)
export const FIRST_PAGE_COUNT = 10

// ─── Kategoriler ───────────────────────────────────────────────────────────────
// Sekmelerdeki sırasıyla; Genel hep en baştadır
export const getCategories = () => call('GET', '/categories')

// Her kategoride kaç defter var: Map<id, sayı>
export async function getCategoryCounts() {
  const obj = await call('GET', '/categories/counts')
  return new Map(Object.entries(obj ?? {}).map(([k, v]) => [Number(k), v]))
}

export const createCategory = (name) => call('POST', '/categories', { name }).then((r) => r.id)
export const renameCategory = (id, name) => call('PATCH', `/categories/${id}`, { name })
export const setCategoryOrder = (ids) => latest('category-order', () => call('PUT', '/categories/order', { ids }))
export const deleteCategory = (id) => call('DELETE', `/categories/${id}`)

// ─── Defterler ─────────────────────────────────────────────────────────────────
export const getNotebooks = () => call('GET', '/books')
export const getNotebook = (id) => call('GET', `/books/${id}`)
export const createNotebook = (settings) => call('POST', '/books', settings).then((r) => r.id)
export const updateNotebook = (id, settings) => call('PATCH', `/books/${id}`, settings)
// Yeni yeri döner (kategori değişmediyse null)
export const setNotebookCategory = (id, categoryId) =>
  call('PUT', `/books/${id}/category`, { category_id: categoryId })
export const setNotebookShelves = (shelves) => latest('shelves', () => call('PUT', '/books/shelves', { shelves }))
export const setNotebookPageCount = (id, count) =>
  latest(`page-count:${id}`, () => call('PUT', `/books/${id}/page-count`, { count }))
export const deleteNotebook = (id) => call('DELETE', `/books/${id}`)

// ─── Sayfalar ve bloklar (page = { notebookId, kind: 'page', ref }) ───────────────
const pagePath = (page) => `/books/${page.notebookId}/pages/${page.ref}`
const kindQuery = (page) => (page.kind && page.kind !== 'page' ? `?kind=${page.kind}` : '')
const pageKey = (page) => `${page.notebookId}:${page.kind ?? 'page'}:${page.ref}`

export const getPageNotes = (page) => call('GET', `${pagePath(page)}/notes${kindQuery(page)}`)
// Yeni blok sayfanın en altına gelir; satırın tamamı döner
export const createNote = (page) => call('POST', `${pagePath(page)}/notes${kindQuery(page)}`)
export const setNoteOrder = (page, ids) =>
  latest(`order:${pageKey(page)}`, () => call('PUT', `${pagePath(page)}/order${kindQuery(page)}`, { ids }))
export const deleteEmptyNotes = (page) => call('DELETE', `${pagePath(page)}/empty-notes${kindQuery(page)}`)
export const updateNote = (page, id, content, highlights = '', inks = '', times = '', time = null) =>
  latest(`note:${id}`, () => call('PUT', `/notes/${id}`, { content, highlights, inks, times, time }))
export const deleteNote = (page, id) => call('DELETE', `/notes/${id}`)

// Yazılı sayfalar: [{ kind, at, ref }]
export const getWrittenPages = (notebookId) => call('GET', `/books/${notebookId}/written`)
export const getPageTexts = (notebookId) => call('GET', `/books/${notebookId}/page-texts`)

// Başlık yazılmış sayfalar: Map<sayfa numarası, başlık>
export async function getPageTitles(notebookId) {
  const obj = await call('GET', `/books/${notebookId}/titles`)
  return new Map(Object.entries(obj ?? {}).map(([k, v]) => [Number(k), v]))
}
export const getPageTitle = (notebookId, ref) =>
  call('GET', `/books/${notebookId}/pages/${ref}/title`).then((r) => r?.title ?? '')
export const setPageTitle = (notebookId, ref, title) =>
  latest(`title:${notebookId}:${ref}`, () => call('PUT', `/books/${notebookId}/pages/${ref}/title`, { title }))

export const insertNotebookPage = (notebookId, number) =>
  call('POST', `/books/${notebookId}/pages/${number}/insert`)
// Silinen yazıların içerikleri döner (eklerinin dosyaları ayrıca silinir)
export const deleteNotebookPage = (notebookId, number) =>
  call('DELETE', `/books/${notebookId}/pages/${number}`).then((r) => r?.contents ?? [])

// ─── Ayraçlar ve çizimler ───────────────────────────────────────────────────────
export const isFavorite = (page) =>
  call('GET', `${pagePath(page)}/favorite${kindQuery(page)}`).then((r) => !!r?.favorite)
export const setFavorite = (page, favorite) =>
  latest(`favorite:${pageKey(page)}`, () => call('PUT', `${pagePath(page)}/favorite${kindQuery(page)}`, { favorite }))
export const getFavorites = () => call('GET', '/favorites')
export const getPageDrawing = (page) =>
  call('GET', `${pagePath(page)}/drawing${kindQuery(page)}`).then((r) => r?.strokes ?? '')
export const setPageDrawing = (page, strokes) =>
  latest(`drawing:${pageKey(page)}`, () => call('PUT', `${pagePath(page)}/drawing${kindQuery(page)}`, { strokes }))
