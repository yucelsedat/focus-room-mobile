// Ek dosyaları (resim ve dosya). Seyir defterinde cihazın belge klasöründe dururlar; focus-room'da
// web ile ortak olsun diye sunucuda (server/library.js /api/library/attachments, dosyalar
// public/uploads/shelf/ altında). Blokta yalnızca dosya adı tutulur; tam adres her seferinde
// sunucu adresinden çözülür. Telefonda seçilen / çekilen / yapıştırılan dosya önce sunucuya
// yüklenir, geçici kopyası silinir.
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { Alert, Image, Linking } from 'react-native'

import { api, getServerUrl } from '../../api/client'
import { DEFAULT_IMAGE_LINES, DEFAULT_IMAGE_ROTATION } from './noteContent'

const R = '/api/library/attachments'
const UPLOAD_TIMEOUT = 5 * 60 * 1000

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
}

function extensionOf(name, fallback) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name ?? '')
  return match ? match[1].toLowerCase() : fallback
}

function deleteLocal(uri) {
  if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
}

// Dosya adı saklanır, tam adres her seferinde çözülür (sunucu adresi değişebilir)
export function attachmentUri(name) {
  return `${getServerUrl()}/uploads/shelf/${encodeURIComponent(name)}`
}

// Yerel dosya sunucuya yüklenir; sunucunun verdiği ad döner. fileName yalnızca türü bulmak için;
// sunucu uzantıyı yerel dosyanın adından alır. Expo SDK 58'in fetch'i RN'nin { uri, name, type }
// FormData parçasını desteklemediği için native yükleyici kullanılır (bkz. api/media.js).
async function upload(uri, fileName, mimeType) {
  const ext = extensionOf(fileName, extensionOf(uri, 'bin'))
  const mime = mimeType || MIME[ext] || 'application/octet-stream'
  const task = FileSystem.createUploadTask(`${getServerUrl()}${R}`, uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType: mime,
  })
  const timer = setTimeout(() => task.cancelAsync().catch(() => {}), UPLOAD_TIMEOUT)
  try {
    const res = await task.uploadAsync()
    if (!res) throw new Error('Dosya yüklenemedi')
    let data = {}
    try {
      data = JSON.parse(res.body)
    } catch {}
    if (res.status >= 400 || !data.name) throw new Error(data.error || `Dosya yüklenemedi (${res.status})`)
    return data.name
  } finally {
    clearTimeout(timer)
  }
}

// Sunucudaki ek geçici bir yerel dosyaya indirilir (kırpma, paylaşma, galeriye kaydetme için)
async function downloadToCache(name) {
  const dest = `${FileSystem.cacheDirectory}shelf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${name}`
  const { status, uri } = await FileSystem.downloadAsync(attachmentUri(name), dest)
  if (status >= 400) {
    deleteLocal(uri)
    throw new Error(`Ek indirilemedi (HTTP ${status})`)
  }
  return uri
}

function imageSegment(name, width, height) {
  return {
    type: 'image',
    name,
    width,
    height,
    lines: DEFAULT_IMAGE_LINES,
    rotation: DEFAULT_IMAGE_ROTATION,
    x: 0,
  }
}

function sizeOf(uri) {
  return Image.getSize(uri).catch(() => ({ width: 4, height: 3 }))
}

export async function pasteImageFromClipboard() {
  const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.85 })
  if (!image) return null

  const temp = `${FileSystem.cacheDirectory}pano-${Date.now()}.jpg`
  await FileSystem.writeAsStringAsync(temp, image.data.replace(/^data:image\/\w+;base64,/, ''), {
    encoding: FileSystem.EncodingType.Base64,
  })
  try {
    const name = await upload(temp, 'pano.jpg', 'image/jpeg')
    return imageSegment(name, image.size.width, image.size.height)
  } finally {
    deleteLocal(temp)
  }
}

// Yazı alanındaki "Yapıştır" menüsünden gelen resim (geçici dosyadan sunucuya yüklenir)
export async function importPastedImage(image) {
  try {
    const size = image.width > 0 && image.height > 0 ? image : await sizeOf(image.uri)
    const name = await upload(image.uri, `pano.${extensionOf(image.uri, 'jpg')}`, image.mimeType)
    return imageSegment(name, size.width, size.height)
  } finally {
    deleteLocal(image.uri)
  }
}

export async function pickImageFromLibrary() {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 })
  const asset = result.canceled ? null : result.assets[0]
  if (!asset) return null

  const name = await upload(asset.uri, asset.fileName ?? asset.uri.split('/').pop(), asset.mimeType)
  return imageSegment(name, asset.width, asset.height)
}

// Kamera izni ister. Kullanıcı izni bir daha sorulmayacak şekilde reddettiyse telefonun
// ayarlarına gitmesi önerilir.
async function cameraAllowed() {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (permission.granted) return true
  if (!permission.canAskAgain) {
    Alert.alert(
      'Kamera izni',
      'Fotoğraf çekebilmek için telefonun ayarlarından Focus Room’a kamera izni ver.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Ayarlar', onPress: () => Linking.openSettings() },
      ],
    )
  }
  return false
}

// Kamera açılır, çekilen fotoğraf sunucuya yüklenir
export async function takePhoto() {
  if (!(await cameraAllowed())) return null
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85 })
  const asset = result.canceled ? null : result.assets[0]
  if (!asset) return null

  try {
    const name = await upload(asset.uri, asset.fileName ?? asset.uri.split('/').pop(), asset.mimeType)
    return imageSegment(name, asset.width, asset.height)
  } finally {
    // Kameranın önbellekte bıraktığı kopya silinir
    deleteLocal(asset.uri)
  }
}

// Resim seçilirse fotoğraf olarak, diğer dosyalar ataçlı etiket olarak eklenir
export async function pickFile() {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
  const asset = result.canceled ? null : result.assets[0]
  if (!asset) return null

  try {
    if (asset.mimeType?.startsWith('image/')) {
      const size = await sizeOf(asset.uri)
      const name = await upload(asset.uri, asset.name, asset.mimeType)
      return imageSegment(name, size.width, size.height)
    }
    const name = await upload(asset.uri, asset.name, asset.mimeType)
    return { type: 'file', name, label: asset.name }
  } finally {
    deleteLocal(asset.uri)
  }
}

// Kırpılacak yer, resmin boyuna oranla (0..1): sol üst köşesi ve genişliği / yüksekliği

// Resmin seçilen yeri yeni bir dosyaya kırpılır; eski dosya yerinde kalır (notu güncelleyen siler).
// Yeni dosyanın adı ve boyutları döner. Yer, resmin çözülmüş (telefonda göründüğü) hâline göre
// piksele çevrilir.
export async function cropAttachmentImage(name, rect) {
  const local = await downloadToCache(name)
  let saved = null
  try {
    const source = await ImageManipulator.manipulate(local).renderAsync()
    const W = source.width
    const H = source.height
    const originX = Math.min(W - 1, Math.max(0, Math.round(rect.x * W)))
    const originY = Math.min(H - 1, Math.max(0, Math.round(rect.y * H)))
    const width = Math.max(1, Math.min(W - originX, Math.round(rect.width * W)))
    const height = Math.max(1, Math.min(H - originY, Math.round(rect.height * H)))
    const cropped = await ImageManipulator.manipulate(source)
      .crop({ originX, originY, width, height })
      .renderAsync()
    const png = extensionOf(name, 'jpg') === 'png'
    const result = await cropped.saveAsync({
      format: png ? SaveFormat.PNG : SaveFormat.JPEG,
      compress: 0.9,
    })
    saved = result.uri
    const newName = await upload(
      result.uri,
      png ? 'kirpik.png' : 'kirpik.jpg',
      png ? 'image/png' : 'image/jpeg',
    )
    return { name: newName, width: result.width, height: result.height }
  } finally {
    deleteLocal(local)
    deleteLocal(saved)
  }
}

// Resim telefonun panosuna kopyalanır; başka uygulamalara yapıştırılabilir
export async function copyImageToClipboard(name) {
  const local = await downloadToCache(name)
  try {
    const base64 = await FileSystem.readAsStringAsync(local, { encoding: FileSystem.EncodingType.Base64 })
    await Clipboard.setImageAsync(base64)
  } finally {
    deleteLocal(local)
  }
}

// Resim telefonun galerisine kaydedilir. Android 13 ve sonrasında galeriye yazmak izin istemez;
// öncesinde depolamaya yazma izni sorulur. Kaydedildiyse true döner.
export async function saveImageToGallery(name) {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo'])
  if (!permission.granted) {
    if (!permission.canAskAgain) {
      Alert.alert(
        'Galeri izni',
        'Resmi galeriye kaydedebilmek için telefonun ayarlarından Focus Room’a izin ver.',
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Ayarlar', onPress: () => Linking.openSettings() },
        ],
      )
    }
    return false
  }
  const local = await downloadToCache(name)
  try {
    await MediaLibrary.Asset.create(local)
  } finally {
    deleteLocal(local)
  }
  return true
}

// Dosyayı telefonun "birlikte aç / paylaş" penceresiyle açar (önce telefona indirilir)
export async function openAttachment(name) {
  if (!(await Sharing.isAvailableAsync())) {
    await Linking.openURL(attachmentUri(name))
    return
  }
  const local = await downloadToCache(name)
  await Sharing.shareAsync(local)
}

// Ekin dosyası yeni bir adla çoğaltılır (ör. kopyalanan blokların ekleri); yeni ad döner. Her
// dosyayı tek bir ek kullanır, böylece biri silinince ötekinin resmi kaybolmaz.
export async function duplicateAttachmentFile(name) {
  const result = await api(`${R}/${encodeURIComponent(name)}/copy`, { method: 'POST' })
  return result.name
}

export function deleteAttachmentFile(name) {
  api(`${R}/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
}
