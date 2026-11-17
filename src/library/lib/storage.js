// Seyir defterindeki expo-sqlite/kv-store'un karşılığı: AsyncStorage üstünde, senkron okunabilen
// küçük bir anahtar-değer deposu. Kitaplığın anahtarları ("library." önekli) açılışta bir kez
// belleğe alınır (loadLibraryStorage, kök layout'ta); getItemSync bellekten okur, yazmalar hem
// belleğe hem AsyncStorage'a gider.
import AsyncStorage from '@react-native-async-storage/async-storage'

const PREFIX = 'library.'
const cache = new Map()

export async function loadLibraryStorage() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX))
    const pairs = await AsyncStorage.multiGet(keys)
    for (const [k, v] of pairs) if (v !== null) cache.set(k.slice(PREFIX.length), v)
  } catch {
    // depo okunamazsa varsayılanlarla açılır
  }
}

const Storage = {
  getItemSync(key) {
    return cache.get(key) ?? null
  },
  async getItemAsync(key) {
    return cache.get(key) ?? null
  },
  async setItemAsync(key, value) {
    cache.set(key, value)
    await AsyncStorage.setItem(PREFIX + key, value)
  },
  async removeItemAsync(key) {
    cache.delete(key)
    await AsyncStorage.removeItem(PREFIX + key)
  },
}

export default Storage
