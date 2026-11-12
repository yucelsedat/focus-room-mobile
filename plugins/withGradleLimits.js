// EAS'ın ücretsiz Android makinesinde (4 çekirdek, 16 GB) yerel C++ derlemeleri paralel
// koşunca Gradle süreci bellek yetmezliğinden düşüyordu ("daemon disappeared").
// Aynı anda en fazla 2 Gradle işi çalışsın.
const { withGradleProperties } = require('expo/config-plugins')

const PROPS = {
  'org.gradle.workers.max': '2',
  'org.gradle.parallel': 'false',
}

module.exports = function withGradleLimits(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === key))
      cfg.modResults.push({ type: 'property', key, value })
    }
    return cfg
  })
}
