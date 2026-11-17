import Storage from './storage'

import { getNotebook, getNotebooks } from '../db'

const LAST_NOTEBOOK_KEY = 'notebook.last'

// Her defter kaldığı sayfayı ayrı saklar (anahtarlar storage.js'te "library." önekiyle durur)
export function lastPageKey(notebookId) {
  return `notebook.${notebookId}.lastPage`
}

export function rememberNotebook(notebookId) {
  Storage.setItemAsync(LAST_NOTEBOOK_KEY, String(notebookId)).catch(() => {})
}

// Defter sekmesinin açacağı defter: en son açılan; silinmişse ya da hiç defter açılmadıysa
// raftaki ilk defter. Tür verilirse (ör. takvimden bir gün açılırken ajanda) yalnızca o türdekiler.
// Rafta defter yoksa null.
export async function getLastNotebook(kind) {
  let saved = null
  try {
    saved = await Storage.getItemAsync(LAST_NOTEBOOK_KEY)
  } catch {}
  if (saved) {
    const notebook = await getNotebook(Number(saved)).catch(() => null)
    if (notebook && (!kind || notebook.kind === kind)) return notebook
  }
  const notebooks = await getNotebooks()
  return notebooks.find((notebook) => !kind || notebook.kind === kind) ?? null
}

// Silinen defterin kaldığı sayfa ve son açılan defter kaydı temizlenir
export async function forgetNotebook(notebookId) {
  try {
    await Storage.removeItemAsync(lastPageKey(notebookId))
    if ((await Storage.getItemAsync(LAST_NOTEBOOK_KEY)) === String(notebookId)) {
      await Storage.removeItemAsync(LAST_NOTEBOOK_KEY)
    }
  } catch {}
}
