// Babel yapılandırması
//
// React Compiler yalnızca kitaplık / defter kodunda açık (app.json experiments.reactCompiler):
// bu kod seyir defterinden taşındı ve orada derleyiciyle çalışıyordu (otomatik memo, uzun
// defter sayfalarında yazarken gereksiz yeniden çizimleri önler). 3B oda kodu (r3f, yerinde
// mutasyon) derleyiciden geçmez.
const LIBRARY_SOURCES = /[\\/]src[\\/](library[\\/]|app[\\/](index|notebook|new-notebook|edit-notebook))/

module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      [
        'babel-preset-expo',
        { 'react-compiler': { sources: (filename) => LIBRARY_SOURCES.test(filename) } },
      ],
    ],
  }
}
