import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import * as ScreenOrientation from 'expo-screen-orientation'
import { loadServerUrl } from '../api/client'
import { useStore } from '../store/useStore'
import { colors } from '../theme'

SplashScreen.preventAutoHideAsync().catch(() => {})
// Uygulama dikey ve yatayda çalışır (app.json orientation: default). Canvas düzenleyici
// yataya, video oynatıcı videonun yönüne kilitlenir; kapanınca kilit kalkar.
ScreenOrientation.unlockAsync().catch(() => {})

export default function RootLayout() {
  // Yalnızca kullanılan ağırlıklar: paket index'leri tüm varyantları (≈90 TTF) pakete sokar
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_200ExtraLight: require('@expo-google-fonts/fraunces/200ExtraLight/Fraunces_200ExtraLight.ttf'),
    Fraunces_800ExtraBold: require('@expo-google-fonts/fraunces/800ExtraBold/Fraunces_800ExtraBold.ttf'),
    DMSans_200ExtraLight: require('@expo-google-fonts/dm-sans/200ExtraLight/DMSans_200ExtraLight.ttf'),
    DMSans_300Light: require('@expo-google-fonts/dm-sans/300Light/DMSans_300Light.ttf'),
    DMSans_800ExtraBold: require('@expo-google-fonts/dm-sans/800ExtraBold/DMSans_800ExtraBold.ttf'),
    JetBrainsMono_300Light: require('@expo-google-fonts/jetbrains-mono/300Light/JetBrainsMono_300Light.ttf'),
  })
  const [urlLoaded, setUrlLoaded] = useState(false)

  useEffect(() => {
    loadServerUrl().finally(() => setUrlLoaded(true))
    useStore.getState().loadTileClipboard()
    useStore.getState().loadCanvasClipboard()
  }, [])

  const ready = (fontsLoaded || fontError) && urlLoaded
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}) }, [ready])
  if (!ready) return null

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="room" options={{ gestureEnabled: false }} />
      </Stack>
    </SafeAreaProvider>
  )
}
