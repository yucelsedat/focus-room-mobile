// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'scripts/*'] },
  // react-three-fiber: three.js nesne özellikleri (position, args, map…) JSX prop'u olarak
  // geçer ve kamera/mesh'ler useFrame/efektlerde yerinde mutasyonla güncellenir (R3F deyimi).
  {
    files: ['src/scene/**'],
    rules: { 'react/no-unknown-property': 'off', 'react-hooks/immutability': 'off' },
  },
])
