import Storage from './storage'
import { useSyncExternalStore } from 'react'

// PDF defterinin ayarı: yazıya dokununca ham Markdown'ı mı açılsın (açık), yoksa yazı biçimli
// görünürken mi yazılsın (kapalı, varsayılan). Bütün PDF defterlerinde ortaktır; açık duran bütün
// sayfalar değişikliği hemen görür.
const RAW_MARKDOWN_KEY = 'document.rawMarkdown'

let rawMarkdown = null
const listeners = new Set()

function read() {
  if (rawMarkdown === null) {
    try {
      rawMarkdown = Storage.getItemSync(RAW_MARKDOWN_KEY) === '1'
    } catch {
      rawMarkdown = false
    }
  }
  return rawMarkdown
}

function subscribe(listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setRawMarkdown(on) {
  rawMarkdown = on
  Storage.setItemAsync(RAW_MARKDOWN_KEY, on ? '1' : '0').catch(() => {})
  for (const listener of listeners) listener()
}

export function useRawMarkdown() {
  return useSyncExternalStore(subscribe, read)
}
