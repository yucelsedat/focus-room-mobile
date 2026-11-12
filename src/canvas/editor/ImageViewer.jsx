// Tam ekran resim görüntüleyici — web canvas/ImageViewer karşılığı. Canvas'taki
// resimler okuma sırasıyla (yukarıdan aşağı, soldan sağa) gezilir: sağa / sola
// kaydır ya da oklara dokun. GIF'ler oynar (platform görüntüleyicisi).
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { assetUrl } from '../../api/client'
import { Icon } from '../../components/Icon'
import { colors, fonts, type, space, radius } from '../../theme'
import { copyImageToPhone, saveImageToPhone } from './canvasMedia'

const SWIPE = 60

export const imageOrder = (a, b) => (a.y - b.y) || (a.x - b.x)

export function ImageViewer({ images, index, onIndex, onClose }) {
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(true)
  const touch = useRef(null)
  const n = images.length
  const it = images[index]

  const step = (d) => { if (n > 1) { setLoading(true); onIndex((index + d + n) % n) } }

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true })
    return () => sub.remove()
  }, [onClose])

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2200)
    return () => clearTimeout(t)
  }, [msg])

  const act = async (kind) => {
    if (busy || !it) return
    setBusy(kind)
    try {
      if (kind === 'save') { await saveImageToPhone(it.url); setMsg({ ok: true, text: '✓ Galeriye kaydedildi' }) }
      else { await copyImageToPhone(it.url); setMsg({ ok: true, text: '✓ Resim telefonun panosuna kopyalandı' }) }
    } catch (e) {
      setMsg({ ok: false, text: e?.message ?? String(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!it) return null
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root]}
      onTouchStart={(e) => { const t = e.nativeEvent.touches[0]; touch.current = t ? { x: t.pageX, y: t.pageY, n: e.nativeEvent.touches.length } : null }}
      onTouchEnd={(e) => {
        const s = touch.current
        touch.current = null
        const t = e.nativeEvent.changedTouches[0]
        if (!s || !t || s.n > 1) return
        const dx = t.pageX - s.x
        if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(t.pageY - s.y) * 1.5) step(dx < 0 ? 1 : -1)
      }}
    >
      <Image
        key={it.id}
        source={{ uri: assetUrl(it.url) }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        onLoadEnd={() => setLoading(false)}
        accessibilityLabel="Resim"
      />
      {loading && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.accent} size="large" />}

      <View style={[styles.top, { left: insets.left + space.md, right: insets.right + space.md }]} pointerEvents="box-none">
        <Text style={styles.count}>{n > 1 ? `${index + 1} / ${n}` : ' '}</Text>
        <View style={styles.actions}>
          <ViewerButton icon="download" label="Kaydet" busy={busy === 'save'} onPress={() => act('save')} />
          <ViewerButton icon="copy" label="Panoya" busy={busy === 'copy'} onPress={() => act('copy')} />
          <ViewerButton icon="close" label="Kapat" onPress={onClose} />
        </View>
      </View>

      {n > 1 && (
        <>
          <Pressable onPress={() => step(-1)} hitSlop={12} style={[styles.nav, { left: insets.left + space.md }]} accessibilityRole="button" accessibilityLabel="Önceki resim">
            <Icon name="chevronLeft" size={26} />
          </Pressable>
          <Pressable onPress={() => step(1)} hitSlop={12} style={[styles.nav, { right: insets.right + space.md }]} accessibilityRole="button" accessibilityLabel="Sonraki resim">
            <Icon name="chevronRight" size={26} />
          </Pressable>
        </>
      )}

      {msg && (
        <View style={[styles.toast, { bottom: insets.bottom + space.lg }]} pointerEvents="none">
          <Text style={[styles.toastText, { color: msg.ok ? '#4ade80' : colors.danger }]}>{msg.text}</Text>
        </View>
      )}
    </View>
  )
}

function ViewerButton({ icon, label, onPress, busy }) {
  return (
    <Pressable onPress={onPress} disabled={!!busy} hitSlop={6} style={({ pressed }) => [styles.btn, pressed && { backgroundColor: 'rgba(96,165,250,0.3)' }]} accessibilityRole="button" accessibilityLabel={label}>
      {busy ? <ActivityIndicator color={colors.text} size="small" /> : <Icon name={icon} size={18} />}
      {label !== 'Kapat' && <Text style={styles.btnText}>{label}</Text>}
    </Pressable>
  )
}

const glass = { backgroundColor: 'rgba(10,10,18,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }

const styles = StyleSheet.create({
  root: { backgroundColor: 'rgba(3,3,6,0.97)', zIndex: 50, elevation: 50 },
  top: { position: 'absolute', top: space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { ...glass, fontFamily: fonts.mono, fontSize: type.caption, color: colors.text, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: space.sm },
  btn: { ...glass, height: 44, minWidth: 44, paddingHorizontal: space.md, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  btnText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.text },
  nav: { ...glass, position: 'absolute', top: '50%', marginTop: -26, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  toast: { ...glass, position: 'absolute', alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  toastText: { fontFamily: fonts.strong, fontSize: type.caption },
})
