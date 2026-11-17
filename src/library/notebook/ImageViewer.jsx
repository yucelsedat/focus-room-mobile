import { BlurView } from 'expo-blur'
import * as ScreenOrientation from 'expo-screen-orientation'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Alert, BackHandler, Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler'
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { HandIcon } from './HandIcon'
import { ImageCropper } from './ImageCropper'

import { copyImageToClipboard, saveImageToGallery } from '../lib/attachments'
import { fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView)

const OPEN_MS = 340
const TURN_MS = 260
const MAX_ZOOM = 5
const DOUBLE_TAP_ZOOM = 2.5
const BLUR_INTENSITY = 45
// Ekranın bu kadarı kadar ya da hızlıca kaydırılınca sıradaki resme geçilir
const TURN_FRACTION = 0.22
const TURN_VELOCITY = 600
// İlk ya da son resimden öteye çekince şerit bu oranda direnerek gelir
const EDGE_RESISTANCE = 0.3
// Resimler arasındaki koyu boşluk
const GAP = 24

function clamp(value, min, max) {
  'worklet'
  return Math.min(max, Math.max(min, value))
}

function fitOf(image, W, H) {
  const ratio = image.width / image.height
  const w = Math.min(W, H * ratio)
  return { w, h: w / ratio }
}

// Resmin ekranın ortasından defterdeki yerine gidişi
function flightTo(rect, image, fit, W, H) {
  const visible =
    rect !== null &&
    rect.width > 0 &&
    rect.y + rect.height > 0 &&
    rect.y < H &&
    rect.x + rect.width > 0 &&
    rect.x < W
  if (!visible) return { dx: 0, dy: 0, scale: 0.9, rotation: 0, fly: false }
  return {
    dx: rect.x + rect.width / 2 - W / 2,
    dy: rect.y + rect.height / 2 - H / 2,
    scale: rect.width / fit.w,
    rotation: image.rotation,
    fly: true,
  }
}

// Resmi defterden alıp göz önüne getiren tam ekran görünüm. Sayfada birden çok resim varsa
// yana kaydırarak sırayla gezilir.
export function ImageViewer({ images, startIndex, originOf, progress, blurTarget, onClosed, onCrop }) {
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [closing, setClosing] = useState(false)
  const [openedSize] = useState({ W, H })
  const [index, setIndex] = useState(startIndex)
  // Kırpma çerçevesi açık mı; açıkken resim yakınlaştırılmaz, başka resme geçilmez
  const [cropping, setCropping] = useState(false)
  // Sürmekte olan iş (kırpma, kopyalama, kaydetme); bitene kadar düğmelere yeniden basılmaz
  const [busy, setBusy] = useState(false)
  // Az önce yapılan işin üstte kısa süre görünen haberi
  const [notice, setNotice] = useState(null)
  const count = images.length
  const step = W + GAP

  const fits = images.map((image) => fitOf(image, W, H))
  const [openFlight] = useState(() =>
    flightTo(originOf(images[startIndex].name), images[startIndex], fits[startIndex], W, H),
  )
  const flight = useSharedValue(openFlight)

  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)
  // Resim şeridinin kayması; şerit dururken -sıra * adım
  const stripX = useSharedValue(-startIndex * step)
  const current = useSharedValue(startIndex)
  const turning = useSharedValue(false)
  const bounds = useSharedValue({ W, H, step, fits })

  useEffect(() => {
    bounds.set({ W, H, step, fits })
  })

  // Telefon döndürülünce şerit yeni genişliğe göre yerine oturur
  useEffect(() => {
    stripX.set(-current.get() * step)
  }, [stripX, current, step])

  // Açılırken yön kilidi kalkar, kapanınca defter yine dikeye kilitlenir
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {})
    progress.set(withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) }))
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
    }
  }, [progress])

  function close() {
    // Resim değişirken kapatılmaz; geçiş çeyrek saniye sürer
    if (closing || turning.get()) return
    setClosing(true)
    scale.set(withTiming(1, { duration: 200 }))
    tx.set(withTiming(0, { duration: 200 }))
    ty.set(withTiming(0, { duration: 200 }))
    stripX.set(withTiming(-index * step, { duration: 200 }))
    // Telefon döndürüldüyse defterdeki yerler artık geçersiz: resim yerinde kaybolur
    const sameSize = W === openedSize.W && H === openedSize.H
    const image = images[index]
    flight.set(flightTo(sameSize ? originOf(image.name) : null, image, fits[index], W, H))
    progress.set(
      withTiming(0, { duration: OPEN_MS - 60, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(onClosed)
      }),
    )
  }

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Geri tuşu önce kırpmayı kapatır
      if (cropping) {
        if (!busy) endCrop()
      } else {
        close()
      }
      return true
    })
    return () => sub.remove()
  })

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])

  // İş bitene kadar yeni iş başlamaz; hata olursa kısa bir uyarı çıkar
  async function run(work, failure) {
    if (busy) return
    setBusy(true)
    const done = await work().catch(() => {
      Alert.alert('Resim', failure)
      return null
    })
    setBusy(false)
    if (done) setNotice(done)
  }

  // Kırpma çerçevesi açılırken resim ekrana sığdırılmış hâline döner
  function startCrop() {
    if (turning.get() || busy) return
    scale.set(withTiming(1, { duration: 180 }))
    tx.set(withTiming(0, { duration: 180 }))
    ty.set(withTiming(0, { duration: 180 }))
    setCropping(true)
  }

  // Kırpma kapanınca resim yeniden ekrana sığdırılmış hâline döner (kırparken küçültülmüş ya da
  // büyütülmüş olabilir)
  function endCrop() {
    scale.set(withTiming(1, { duration: 200 }))
    tx.set(withTiming(0, { duration: 200 }))
    ty.set(withTiming(0, { duration: 200 }))
    setCropping(false)
  }

  function applyCrop(rect) {
    const crop = onCrop
    if (!crop) return
    run(async () => {
      const ok = await crop(images[index].name, rect)
      if (!ok) throw new Error('crop failed')
      endCrop()
      return 'kırpıldı'
    }, 'Resim kırpılamadı.')
  }

  function copyImage() {
    run(async () => {
      await copyImageToClipboard(images[index].name)
      return 'kopyalandı'
    }, 'Resim panoya kopyalanamadı.')
  }

  function downloadImage() {
    run(
      async () => ((await saveImageToGallery(images[index].name)) ? 'galeriye kaydedildi' : null),
      'Resim galeriye kaydedilemedi.',
    )
  }

  function maxOffset(s) {
    'worklet'
    const { W: w, H: h, fits: f } = bounds.get()
    const fit = f[current.get()]
    return {
      x: Math.max(0, (fit.w * s - w) / 2),
      y: Math.max(0, (fit.h * s - h) / 2),
    }
  }

  // Yakınlaştırınca resim ekrandan taşabilir ama kenarı ekranın içine girmez
  function clampTranslation() {
    'worklet'
    const max = maxOffset(scale.get())
    tx.set(withTiming(clamp(tx.get(), -max.x, max.x), { duration: 180 }))
    ty.set(withTiming(clamp(ty.get(), -max.y, max.y), { duration: 180 }))
  }

  function turnTo(next) {
    'worklet'
    turning.set(true)
    stripX.set(
      withTiming(-next * bounds.get().step, { duration: TURN_MS, easing: Easing.out(Easing.cubic) }, () => {
        // Geride kalan resim ilk hâline döner, yeni resim ekrana sığmış olarak gelir
        scale.set(1)
        tx.set(0)
        ty.set(0)
        current.set(next)
        turning.set(false)
        scheduleOnRN(setIndex, next)
      }),
    )
  }

  const pinch = usePinchGesture({
    enabled: !cropping,
    onBegin: () => {
      savedScale.set(scale.get())
      savedTx.set(tx.get())
      savedTy.set(ty.get())
    },
    onUpdate: (e) => {
      if (turning.get()) return
      const next = clamp(savedScale.get() * e.scale, 0.8, MAX_ZOOM)
      const k = next / savedScale.get()
      // Parmakların ortasındaki nokta yerinde kalsın
      const fx = e.focalX - bounds.get().W / 2
      const fy = e.focalY - bounds.get().H / 2
      scale.set(next)
      tx.set(fx - (fx - savedTx.get()) * k)
      ty.set(fy - (fy - savedTy.get()) * k)
    },
    onDeactivate: () => {
      if (scale.get() < 1) {
        scale.set(withTiming(1, { duration: 200 }))
        tx.set(withTiming(0, { duration: 200 }))
        ty.set(withTiming(0, { duration: 200 }))
      } else {
        clampTranslation()
      }
    },
  })

  // Tek parmakla sürükleme: yakınlaştırılmış resim önce kendi içinde kayar, kenarına dayanınca
  // taşan kısım resim şeridini kaydırır. Sığdırılmış resimde yatay sürüklemenin hepsi şeride gider.
  const pan = usePanGesture({
    enabled: !cropping,
    maxPointers: 1,
    onBegin: () => {
      savedTx.set(tx.get())
      savedTy.set(ty.get())
    },
    onUpdate: (e) => {
      if (turning.get()) return
      const s = scale.get()
      const rawX = savedTx.get() + e.translationX
      if (count < 2) {
        if (s <= 1) return
        tx.set(rawX)
        ty.set(savedTy.get() + e.translationY)
        return
      }
      const max = maxOffset(Math.max(1, s))
      const x = clamp(rawX, -max.x, max.x)
      if (s > 1) {
        tx.set(x)
        ty.set(savedTy.get() + e.translationY)
      }
      const i = current.get()
      let over = rawX - x
      if ((i === 0 && over > 0) || (i === count - 1 && over < 0)) over *= EDGE_RESISTANCE
      stripX.set(-i * bounds.get().step + over)
    },
    onDeactivate: (e) => {
      if (turning.get()) return
      const i = current.get()
      const { W: w, step: st } = bounds.get()
      const over = stripX.get() + i * st
      const fast = Math.abs(e.velocityX) > TURN_VELOCITY && Math.abs(over) > 12
      let next = i
      if (over < 0 && (over < -w * TURN_FRACTION || (fast && e.velocityX < 0))) next = i + 1
      if (over > 0 && (over > w * TURN_FRACTION || (fast && e.velocityX > 0))) next = i - 1
      next = clamp(next, 0, count - 1)
      if (next !== i) {
        turnTo(next)
        return
      }
      if (over !== 0) stripX.set(withTiming(-i * st, { duration: 200 }))
      clampTranslation()
    },
  })

  const doubleTap = useTapGesture({
    enabled: !cropping,
    numberOfTaps: 2,
    onDeactivate: (e) => {
      if (turning.get()) return
      if (scale.get() > 1) {
        scale.set(withTiming(1, { duration: 220 }))
        tx.set(withTiming(0, { duration: 220 }))
        ty.set(withTiming(0, { duration: 220 }))
        return
      }
      const { W: w, H: h } = bounds.get()
      const max = maxOffset(DOUBLE_TAP_ZOOM)
      // Dokunulan nokta yakınlaşınca yerinde kalsın
      const targetX = clamp((w / 2 - e.x) * (DOUBLE_TAP_ZOOM - 1), -max.x, max.x)
      const targetY = clamp((h / 2 - e.y) * (DOUBLE_TAP_ZOOM - 1), -max.y, max.y)
      scale.set(withTiming(DOUBLE_TAP_ZOOM, { duration: 220 }))
      tx.set(withTiming(targetX, { duration: 220 }))
      ty.set(withTiming(targetY, { duration: 220 }))
    },
  })

  const gestures = useSimultaneousGestures(pinch, pan, doubleTap)

  const blurProps = useAnimatedProps(() => ({
    intensity: BLUR_INTENSITY * progress.get(),
  }))

  const dimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }))

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stripX.get() }] }))

  const chromeStyle = useAnimatedStyle(() => ({ opacity: closing ? 0 : progress.get() }))

  return (
    <View style={StyleSheet.absoluteFill}>
      <StatusBar hidden />
      <AnimatedBlurView
        style={StyleSheet.absoluteFill}
        animatedProps={blurProps}
        tint="dark"
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={blurTarget}
      />
      <Animated.View pointerEvents="none" style={[styles.dim, dimStyle]} />

      <GestureDetector gesture={gestures}>
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, stripStyle]}>
            {images.map((image, i) =>
              // Yalnızca ekrandaki resim ve iki komşusu çizilir
              Math.abs(i - index) > 1 ? null : (
                <Slide
                  key={i}
                  image={image}
                  fit={fits[i]}
                  left={i * step}
                  width={W}
                  current={i === index}
                  progress={progress}
                  flight={flight}
                  scale={scale}
                  tx={tx}
                  ty={ty}
                />
              ),
            )}
          </Animated.View>
        </View>
      </GestureDetector>

      {cropping ? (
        <ImageCropper
          fit={fits[index]}
          insets={insets}
          scale={scale}
          tx={tx}
          ty={ty}
          busy={busy}
          onCancel={endCrop}
          onApply={applyCrop}
        />
      ) : (
        <>
          <Animated.View
            style={[styles.close, { top: insets.top + 12, right: insets.right + 12 }, chromeStyle]}
          >
            <HandIcon shape="close" label="Kapat" onPress={close} size={24} />
          </Animated.View>

          {count > 1 && (
            <Animated.View
              pointerEvents="none"
              style={[styles.counterWrap, { bottom: insets.bottom + 84 }, chromeStyle]}
            >
              <View style={styles.counter} accessibilityLabel={`Resim ${index + 1} / ${count}`}>
                <Text style={styles.counterText}>{`${index + 1} / ${count}` + HAND_TAIL}</Text>
              </View>
            </Animated.View>
          )}

          {/* Resimle yapılacak işler: kırp, panoya kopyala, galeriye indir */}
          <Animated.View
            style={[styles.toolsWrap, { bottom: insets.bottom + 20 }, chromeStyle]}
            pointerEvents={closing ? 'none' : 'box-none'}
          >
            <View style={styles.tools}>
              {onCrop && <HandIcon shape="crop" label="Kırp" onPress={startCrop} size={30} disabled={busy} />}
              <HandIcon shape="copy" label="Panoya kopyala" onPress={copyImage} size={30} disabled={busy} />
              <HandIcon
                shape="download"
                label="Galeriye indir"
                onPress={downloadImage}
                size={30}
                disabled={busy}
              />
            </View>
          </Animated.View>
        </>
      )}

      {notice && (
        <View
          pointerEvents="none"
          style={[styles.noticeWrap, { top: insets.top + 18 }]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.counter}>
            <Text style={styles.counterText}>{notice + HAND_TAIL}</Text>
          </View>
        </View>
      )}
    </View>
  )
}

function Slide({ image, fit, left, width, current, progress, flight, scale, tx, ty }) {
  // Defterdeki yerinden ekranın ortasına: konum, boyut ve açı birlikte değişir. Komşu resimler
  // uçmaz, yalnızca belirip kaybolur.
  const liftStyle = useAnimatedStyle(() => {
    const p = progress.get()
    if (!current) return { opacity: p, transform: [] }
    const f = flight.get()
    return {
      opacity: f.fly ? 1 : p,
      transform: [
        { translateX: interpolate(p, [0, 1], [f.dx, 0]) },
        { translateY: interpolate(p, [0, 1], [f.dy, 0]) },
        { scale: interpolate(p, [0, 1], [f.scale, 1]) },
        { rotate: `${interpolate(p, [0, 1], [f.rotation, 0])}deg` },
      ],
    }
  })

  const zoomStyle = useAnimatedStyle(() =>
    current
      ? { transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }] }
      : { transform: [] },
  )

  return (
    <View style={[styles.slide, { left, width }]}>
      <Animated.View style={liftStyle}>
        <Animated.View style={[styles.photo, zoomStyle]}>
          <Image source={{ uri: image.uri }} style={{ width: fit.w, height: fit.h }} />
        </Animated.View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 16, 10, 0.3)',
  },
  slide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  close: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: notebook.paper,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  counterWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toolsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 28,
    backgroundColor: notebook.paper,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  noticeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  counter: {
    paddingHorizontal: 14,
    paddingVertical: 2,
    borderRadius: 16,
    backgroundColor: notebook.paper,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  counterText: {
    fontFamily: fonts.handBold,
    fontSize: 20,
    lineHeight: 28,
    color: notebook.graphite,
    marginRight: -handTailWidth(20),
  },
})
