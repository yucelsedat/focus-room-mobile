// Video tile'ın sesli, tam ekran oynatıcısı — expo-video (telefonun yerel oynatıcısı:
// Android ExoPlayer, iOS AVPlayer). Video kendi çözünürlüğünde, donanımla çözülür;
// oynat / duraklat, sarma, ses gibi denetimler yerel. Yatay video için ekran yataya
// döner, kapanınca dikeye kilitlenir. Açılamazsa telefonun kendi oynatıcısında açılabilir.
import { useEffect, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as ScreenOrientation from 'expo-screen-orientation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useEvent } from 'expo'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useStore } from '../store/useStore'
import { assetUrl } from '../api/client'
import { Icon } from './Icon'
import { colors, fonts, type, space, radius } from '../theme'

export function VideoPlayer() {
  const video = useStore((s) => s.videoPlayer)
  if (!video) return null
  return <PlayerHost key={video.mediaId} video={video} />
}

// Yön kilidi: yatay video → yatay ekran. Kilit oturunca oynatıcı açılır.
function PlayerHost({ video }) {
  const landscape = (video.ratio ?? 16 / 9) > 1.05
  const { width, height } = useWindowDimensions()
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    ScreenOrientation.lockAsync(landscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
    const t = setTimeout(() => setWaited(true), 1200)
    return () => {
      clearTimeout(t)
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
    }
  }, [landscape])
  const ready = waited || (landscape ? width > height : height >= width)
  return (
    <View style={[StyleSheet.absoluteFill, styles.host]}>
      <StatusBar hidden />
      {ready ? <Player video={video} /> : <ActivityIndicator color={colors.accent} size="large" />}
    </View>
  )
}

function Player({ video }) {
  const insets = useSafeAreaInsets()
  const close = useStore((s) => s.closeVideoPlayer)
  const player = useVideoPlayer({ uri: assetUrl(video.url) }, (p) => {
    p.loop = false
    p.muted = false
    p.play()
  })
  const { status, error } = useEvent(player, 'statusChange', { status: player.status, error: null })
  const [firstFrame, setFirstFrame] = useState(false)

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true })
    return () => sub.remove()
  }, [close])

  const failed = status === 'error'
  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        onFirstFrameRender={() => setFirstFrame(true)}
      />

      {!firstFrame && !failed && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.accent} size="large" pointerEvents="none" />}

      {failed && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Video oynatılamadı</Text>
          <Text style={styles.errorText}>{error?.message ?? 'Biçim desteklenmiyor olabilir.'}</Text>
          <Pressable onPress={() => Linking.openURL(assetUrl(video.url)).catch(() => {})} style={styles.errorBtn} accessibilityRole="link">
            <Text style={styles.errorBtnText}>Sistem oynatıcısında aç ↗</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.top, { top: insets.top + space.md, left: insets.left + space.lg, right: insets.right + space.lg }]} pointerEvents="box-none">
        <Text style={styles.title} numberOfLines={1}>{video.title || 'Video'}</Text>
        <Pressable onPress={close} hitSlop={8} style={({ pressed }) => [styles.round, pressed && { backgroundColor: 'rgba(96,165,250,0.3)' }]} accessibilityRole="button" accessibilityLabel="Kapat">
          <Icon name="close" size={20} />
        </Pressable>
      </View>
    </View>
  )
}

const glass = { backgroundColor: 'rgba(10,10,18,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }

const styles = StyleSheet.create({
  host: { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', zIndex: 120, elevation: 120 },
  top: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1, fontFamily: fonts.strong, fontSize: type.body, color: colors.text, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 6 },
  round: { ...glass, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  errorBox: { ...glass, position: 'absolute', alignSelf: 'center', top: '35%', padding: space.lg, borderRadius: radius.md, maxWidth: 420, alignItems: 'center', gap: space.sm },
  errorTitle: { fontFamily: fonts.display, fontSize: type.heading, color: colors.text },
  errorText: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, textAlign: 'center' },
  errorBtn: { marginTop: space.sm, height: 42, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  errorBtnText: { fontFamily: fonts.strong, fontSize: type.caption, color: colors.accentInk },
})
