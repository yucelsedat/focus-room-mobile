// Oda ekranı (dikey). 3D sahne tam ekran; üstünde dokunmatik katman ve HUD.
import { useCallback, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { RoomScene } from '../scene/RoomScene'
import { TouchLayer } from '../controls/TouchLayer'
import { RoomHUD } from '../components/RoomHUD'
import { Crosshair } from '../components/Crosshair'
import { RoomSheet } from '../components/RoomSheet'
import { MediaSheet } from '../components/MediaSheet'
import { TileSheet } from '../components/TileSheet'
import { CanvasEditor } from '../canvas/editor/CanvasEditor'
import { VideoPlayer } from '../components/VideoPlayer'
import { loadRoom, refreshRooms } from '../api/loadRoom'
import { input, resetInput } from '../controls/input'
import { syncSpawnFor } from '../scene/syncSpawn'
import { useStore } from '../store/useStore'
import { colors } from '../theme'

const CENTER_SPAWN = { pos: [0, 5] } // web kamerası ile aynı başlangıç (0, 2.5, 5)

export default function RoomScreen() {
  const { id, name } = useLocalSearchParams()

  // sync: { syncGroupId, fromId } — senkron canvas'taki oda linkiyle gidiliyorsa hedef
  // odadaki grup üyesinin önüne doğulur (web Player + utils/syncSpawn ile aynı)
  const go = useCallback((roomId, roomName, sync = null) => {
    resetInput()
    loadRoom(roomId, roomName)
      .then(() => { input.spawn = syncSpawnFor(useStore.getState().worldMedia, sync) ?? CENTER_SPAWN })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshRooms().catch(() => {})
    if (id) go(String(id), String(name ?? ''))
    return resetInput
  }, [id, name, go])

  return (
    <View style={styles.root}>
      <RoomScene />
      <TouchLayer onGo={go} />
      <Crosshair />
      <RoomHUD onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <RoomSheet onGo={go} />
      <MediaSheet onGo={go} />
      <TileSheet />
      <CanvasEditor onGo={go} />
      <VideoPlayer />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
})
