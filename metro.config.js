// Metro yapılandırması
//
// Oda modeli (roomConfig, roomTree) web ile ortaktır; kopyası src/shared/ altındadır
// (kanonik: focus-room-main/src/utils). Klasör dışı bağımlılık yoktur.
//
// three.js tek örnek: paket `import` için three.module.js, `require` için
//    three.cjs sunar. @react-three/fiber/native CJS build'i require eder; bizim
//    ESM import'larımız başka dosyaya çözülürse sahnede iki ayrı THREE olur ve
//    instanceof kontrolleri sessizce bozulur. Hepsini three.cjs'e sabitliyoruz.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const THREE_CJS = path.resolve(__dirname, 'node_modules/three/build/three.cjs')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: THREE_CJS }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
