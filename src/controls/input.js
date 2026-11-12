// Dokunmatik girdi ile sahne arasındaki ortak, mutable durum. React state'i
// değil: her karede okunur, yeniden render tetiklememelidir.
export const input = {
  move: { x: 0, y: 0 },   // joystick: x sağ(+), y ileri(+), büyüklük 0..1
  lookDX: 0,              // biriken bakış sürüklemesi (px) — kare başında tüketilir
  lookDY: 0,
  flyUp: false,
  flyDown: false,
  fastFall: false,        // tek seferlik: zemine hızlı in
  teleport: null,         // [x, z] — zemine çift dokunuş
  spawn: null,            // { pos: [x, z], look?: [x,y,z] } — oda yüklenince
}

export function resetInput() {
  input.move.x = 0
  input.move.y = 0
  input.lookDX = 0
  input.lookDY = 0
  input.flyUp = false
  input.flyDown = false
}
