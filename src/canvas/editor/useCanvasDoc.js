// Tam ekran canvas düzenleyicisinin belgesi: öğeler + görünüm (pan/zoom) + kayıt.
// Web CanvasMesh doSave/scheduleSave ile aynı: 600 ms gecikmeli PUT /api/media/:id
// { content: { items, bg, pan, zoom } }. Senkron canvas'ta sunucu items/bg'yi grubun
// diğer kopyalarına yayar (her kopyanın kendi pan/zoom'u korunur).
//
// Duvardaki doku (store.worldMedia) düzenleme sürerken güncellenmez: her kayıtta
// yeniden çizim JS iş parçacığını meşgul ederdi. Son yanıt kapanışta store'a yazılır.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { api } from '../../api/client'
import { useStore } from '../../store/useStore'
import { parseCanvas } from '../render'

const SAVE_DELAY = 600

export function useCanvasDoc(media) {
  const [initial] = useState(() => parseCanvas(media.content))
  const [items, setItemsState] = useState(initial.items)
  const [view, setViewState] = useState({ pan: initial.pan, zoom: initial.zoom })
  const [status, setStatus] = useState('idle') // idle | pending | saving | saved | error
  const bg = initial.bg

  const itemsRef = useRef(items)
  const viewRef = useRef(view)
  const timer = useRef(null)
  const inflight = useRef(Promise.resolve())
  const last = useRef(null) // son başarılı yanıt → kapanışta store'a
  const failed = useRef(false)

  const send = useCallback(() => {
    timer.current = null
    const content = JSON.stringify({ items: itemsRef.current, bg, pan: viewRef.current.pan, zoom: viewRef.current.zoom })
    setStatus('saving')
    // Kayıtlar sırayla gider: geç yanıt veren eski kayıt yenisini ezmesin
    inflight.current = inflight.current.then(async () => {
      try {
        last.current = await api(`/api/media/${media.id}`, { method: 'PUT', body: { content }, timeout: 20000 })
        failed.current = false
        if (!timer.current) setStatus('saved')
      } catch {
        failed.current = true
        setStatus('error')
      }
    })
    return inflight.current
  }, [bg, media.id])

  const schedule = useCallback(() => {
    clearTimeout(timer.current)
    setStatus('pending')
    timer.current = setTimeout(send, SAVE_DELAY)
  }, [send])

  /** Bekleyen kaydı hemen gönder; tüm kayıtlar bitince çözülür → hata varsa false */
  const flush = useCallback(async () => {
    // Başarısız son kayıt da yeniden denenir
    if (timer.current || failed.current) { clearTimeout(timer.current); send() }
    await inflight.current
    return !failed.current
  }, [send])

  /** Son kaydı store'a yaz (duvardaki canvas ve senkron kopyaları güncellensin) */
  const publish = useCallback(() => {
    const res = last.current
    if (!res) return
    const { syncSiblings, ...row } = res
    const { updateMedia } = useStore.getState()
    updateMedia(row)
    syncSiblings?.forEach(updateMedia)
  }, [])

  const setItems = useCallback((next) => {
    itemsRef.current = typeof next === 'function' ? next(itemsRef.current) : next
    setItemsState(itemsRef.current)
    schedule()
  }, [schedule])

  // Görünüm her harekette değişir; kayıt yalnız hareket bitince (commitView)
  const setView = useCallback((next) => {
    viewRef.current = next
    setViewState(next)
  }, [])
  const commitView = useCallback(() => schedule(), [schedule])

  // Uygulama arka plana geçerse bekleyen kayıt kaybolmasın
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && timer.current) { clearTimeout(timer.current); send() } })
    return () => {
      sub.remove()
      if (timer.current) { clearTimeout(timer.current); send() } // beklenmedik kapanış
    }
  }, [send])

  return { items, itemsRef, setItems, view, viewRef, setView, commitView, bg, status, flush, publish }
}
