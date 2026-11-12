// three.js + expo-gl uyum ayarları. RoomScene'den Canvas kurulmadan önce yüklenir.
import * as THREE from 'three'

// 1) THREE.Clock uyarısı: three r183, Clock'u Timer lehine "deprecated" işaretledi;
//    Clock'u kullanan bizim kodumuz değil, @react-three/fiber'ın kendi store'u.
//    three'nin resmi konsol kancasıyla yalnız bu mesaj süzülür, gerisi aynen geçer.
// three, mesajın önüne bir kez daha 'THREE.' ekler ('THREE.THREE.Clock: …') → içerik eşleşmesi
// WEBGL_lose_context: R3F sahneyi kapatırken (odadan çıkış / yeniden yükleme) GL bağlamını
// bu eklentiyle bırakmak ister; expo-gl'de yok ama GLView kapanınca bağlamı kendisi
// yok eder — zararsız, tek seferlik uyarı.
const SILENCED = [
  'Clock: This module has been deprecated',
  'WEBGL_lose_context extension not supported',
]
const prev = THREE.getConsoleFunction()
THREE.setConsoleFunction((level, message, ...params) => {
  if (typeof message === 'string' && SILENCED.some((s) => message.includes(s))) return
  if (prev) prev(level, message, ...params)
  else console[level](message, ...params)
})

// 2) pixelStorei: expo-gl yalnız UNPACK_FLIP_Y_WEBGL ve UNPACK_ALIGNMENT'ı destekler;
//    three her doku yüklemesinde PREMULTIPLY_ALPHA / COLORSPACE_CONVERSION da gönderir
//    ve expo-gl her biri için "doesn't support this parameter yet!" loglar. Bunlar
//    expo-gl'de zaten etkisizdir (görüntü stb_image ile RGBA çözülür), bu yüzden
//    desteklenmeyenler sessizce atlanır — doku yüklemesi değişmez.
const UNPACK_FLIP_Y_WEBGL = 0x9240
const UNPACK_ALIGNMENT = 0x0cf5

export function patchExpoGL(renderer) {
  const gl = renderer.getContext()
  if (!gl || gl.__focusRoomPatched) return
  const pixelStorei = gl.pixelStorei.bind(gl)
  gl.pixelStorei = (pname, param) => {
    if (pname === UNPACK_FLIP_Y_WEBGL || pname === UNPACK_ALIGNMENT) pixelStorei(pname, param)
  }
  gl.__focusRoomPatched = true
}
