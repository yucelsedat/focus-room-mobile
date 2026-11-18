import { useEffect, useState } from 'react'
import { Stack, usePathname } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import * as ScreenOrientation from 'expo-screen-orientation'
import { loadServerUrl } from '../api/client'
import { loadLibraryStorage } from '../library/lib/storage'
import { useStore } from '../store/useStore'
import { colors } from '../theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

// Odalar (/worlds, /room) dikey ve yatayda çalışır (app.json orientation: default); canvas
// düzenleyici yataya, video oynatıcı videonun yönüne kilitlenir, kapanınca kilit kalkar.
// Kitaplık ve defter ekranları seyir defterindeki gibi dikeydir (tam ekran resim görünümü kilidi
// kendisi açar).
const FREE_ORIENTATION = /^\/(worlds|room)(\/|$)/
// Kitaplığın açık temasındaki ekranlar (ana sayfa, defter oluşturma ve düzenleme)
const LIGHT_SCREENS = /^\/($|new-notebook|edit-notebook\/)/

export default function RootLayout() {
  // Yalnızca kullanılan ağırlıklar: paket index'leri tüm varyantları (≈90 TTF) pakete sokar
  const [fontsLoaded, fontError] = useFonts({
    Caveat_400Regular: require('@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf'),
    Caveat_700Bold: require('@expo-google-fonts/caveat/700Bold/Caveat_700Bold.ttf'),
    Fraunces_200ExtraLight: require('@expo-google-fonts/fraunces/200ExtraLight/Fraunces_200ExtraLight.ttf'),
    Fraunces_600SemiBold: require('@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf'),
    Fraunces_700Bold: require('@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf'),
    Fraunces_800ExtraBold: require('@expo-google-fonts/fraunces/800ExtraBold/Fraunces_800ExtraBold.ttf'),
    DMSans_200ExtraLight: require('@expo-google-fonts/dm-sans/200ExtraLight/DMSans_200ExtraLight.ttf'),
    DMSans_300Light: require('@expo-google-fonts/dm-sans/300Light/DMSans_300Light.ttf'),
    DMSans_300Light_Italic: require('@expo-google-fonts/dm-sans/300Light_Italic/DMSans_300Light_Italic.ttf'),
    DMSans_800ExtraBold: require('@expo-google-fonts/dm-sans/800ExtraBold/DMSans_800ExtraBold.ttf'),
    DMSans_800ExtraBold_Italic: require('@expo-google-fonts/dm-sans/800ExtraBold_Italic/DMSans_800ExtraBold_Italic.ttf'),
    JetBrainsMono_300Light: require('@expo-google-fonts/jetbrains-mono/300Light/JetBrainsMono_300Light.ttf'),
  })
  const [urlLoaded, setUrlLoaded] = useState(false)
  const pathname = usePathname()
  const freeOrientation = FREE_ORIENTATION.test(pathname)

  useEffect(() => {
    Promise.all([loadServerUrl(), loadLibraryStorage()]).finally(() => setUrlLoaded(true))
    useStore.getState().loadTileClipboard()
    useStore.getState().loadCanvasClipboard()
  }, [])

  useEffect(() => {
    if (freeOrientation) ScreenOrientation.unlockAsync().catch(() => {})
    else ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
  }, [freeOrientation])

  const ready = (fontsLoaded || fontError) && urlLoaded
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}) }, [ready])
  if (!ready) return null

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/* Kitaplığın ve defter formunun açık zemininde durum çubuğu koyu, öbür ekranlarda açık */}
        <StatusBar style={LIGHT_SCREENS.test(pathname) ? 'dark' : 'light'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        >
          {/* Ana sayfa: Seyir Defteri kitaplığı (web'deki all-books gibi). Odalar /worlds'te. */}
          <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: '#F3F2EF' } }} />
          <Stack.Screen name="new-notebook" options={{ contentStyle: { backgroundColor: '#F3F2EF' } }} />
          <Stack.Screen name="edit-notebook/[id]" options={{ contentStyle: { backgroundColor: '#F3F2EF' } }} />
          <Stack.Screen name="notebook" options={{ contentStyle: { backgroundColor: '#14213D' }, animationDuration: 200 }} />
          <Stack.Screen name="worlds" />
          <Stack.Screen name="room" options={{ gestureEnabled: false }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
