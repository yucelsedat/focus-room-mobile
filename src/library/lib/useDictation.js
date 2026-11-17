import { requireOptionalNativeModule } from 'expo'

import { useEffect, useEffectEvent, useRef, useState } from 'react'

// Paketin kendisi modülü yüklenir yüklenmez ister ve Expo Go'da uygulamayı çökertir.
// Modül burada isteğe bağlı alınır; Expo Go'da mikrofon yalnızca uyarı gösterir.
const Speech = requireOptionalNativeModule('ExpoSpeechRecognition')

// Kullanıcıya gösterilmeyen, dinlemenin kendiliğinden bitmesi sayılan durumlar
const SILENT_ERRORS = ['aborted', 'no-speech', 'speech-timeout']

const ERROR_MESSAGES = {
  'not-allowed': 'Mikrofon izni verilmedi. Telefonun ayarlarından izin verebilirsin.',
  'language-not-supported': 'Bu telefonda Türkçe konuşma tanıma desteklenmiyor.',
  network: 'Konuşma tanıma için internet bağlantısı gerekiyor.',
  'audio-capture': 'Mikrofon şu an kullanılamıyor.',
  busy: 'Mikrofon başka bir uygulama tarafından kullanılıyor.',
  interrupted: 'Dinleme bir arama ya da alarm yüzünden yarıda kaldı.',
}

function join(a, b) {
  return a && b ? `${a} ${b}` : a || b
}

// Mikrofonla dinleyip söylenenleri yazıya çevirir
export function useDictation({ onTranscript, onEnd, onError }) {
  const [listening, setListening] = useState(false)
  // Kesinleşen cümleler ve o an söylenmekte olan cümle
  const session = useRef({ committed: '', pending: '' })
  // Konuşma tanıma tek ve ortak: defterde birkaç sayfa aynı anda açıkken olayları
  // yalnızca dinlemeyi başlatan sayfa alır
  const owner = useRef(false)

  const handleResult = useEffectEvent((isFinal, transcript) => {
    if (!owner.current) return
    const text = transcript.trim()
    const s = session.current
    if (isFinal) {
      s.committed = join(s.committed, text)
      s.pending = ''
    } else {
      s.pending = text
    }
    onTranscript(join(s.committed, s.pending))
  })

  const handleError = useEffectEvent((error) => {
    if (!owner.current || SILENT_ERRORS.includes(error)) return
    onError(ERROR_MESSAGES[error] ?? 'Konuşma tanıma şu an kullanılamıyor.')
  })

  const handleEnd = useEffectEvent(() => {
    if (!owner.current) return
    owner.current = false
    setListening(false)
    onEnd()
  })

  useEffect(() => {
    if (!Speech) return
    const subscriptions = [
      Speech.addListener('result', (e) => handleResult(e.isFinal, e.results[0]?.transcript ?? '')),
      Speech.addListener('error', (e) => handleError(e.error)),
      Speech.addListener('end', () => handleEnd()),
    ]
    return () => {
      subscriptions.forEach((s) => s.remove())
      // Sayfadan çıkınca mikrofon açık kalmasın (başka sayfanın dinlemesine dokunulmaz)
      if (owner.current) Speech.abort()
    }
  }, [])

  // Dinleme başladıysa true döner
  async function start() {
    if (!Speech) {
      onError('Sesle yazma için uygulamanın geliştirme sürümü gerekiyor (Expo Go desteklemiyor).')
      return false
    }
    const permission = await Speech.requestPermissionsAsync()
    if (!permission.granted) {
      onError(ERROR_MESSAGES['not-allowed'])
      return false
    }
    session.current = { committed: '', pending: '' }
    owner.current = true
    Speech.start({ lang: 'tr-TR', interimResults: true, continuous: true, addsPunctuation: true })
    setListening(true)
    return true
  }

  // Son cümle de yazıya geçirilip dinleme biter
  function stop() {
    Speech?.stop()
  }

  // Dinleme hemen kesilir, bekleyen sonuç atılır
  function cancel() {
    Speech?.abort()
  }

  return { listening, start, stop, cancel }
}
