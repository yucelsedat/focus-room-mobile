@AGENTS.md

git push, merge olaylarını bana sormadan sakın yapma bypass permission da bile bana sor

yeni branch oluşturken adını yapacağım şeye göre sen belirle

## Bu repo: Focus Room mobil (Expo)

Expo SDK 58 / React Native istemcisi. Sunucu ve web istemcisi **ayrı repodadır**:
`/home/sedat/projects/games/focus-room-main` (GitHub `yucelsedat/3d-focus-room`). Gerçek backend
(`node --watch server.js`, port 5001) ve canlı veri oradadır; telefon oraya bağlanır. İki proje
yalnız HTTP API ile konuşur.

- Mobil için sunucuda bir değişiklik gerekiyorsa **focus-room-main'de** yapılır (orada commit /
  branch yalnız kullanıcı isterse; push / merge her zaman sorularak). Kullanıcının orada commit
  edilmemiş kendi değişiklikleri olabilir: önce `git -C ../focus-room-main status`, çakışma varsa sor.
- Sunucu API'sini değiştirirken eski davranışı bozma: web istemcisi ve mobil aynı backend'i kullanır.
  Mobil için eklenmiş uçlar: `GET /api/ping`, `POST /api/rooms/:id/disconnect { otherId }`,
  `GET /api/gif-frames?src=/uploads/...`; mobil `roomId`'yi açıkça gönderir (sunucunun
  `activeRoomId`'si web'de oda değişince değişir).
- Sunucu değişikliğini canlı backend'de doğrula (ör. `curl http://localhost:5001/api/ping`).
- `src/shared/` (roomConfig, roomTree) web ile ortak oda modelinin kopyasıdır; kanonik kopya
  `focus-room-main/src/utils`. Biri değişirse diğeri de güncellenmeli.

## Derleme

- Android'de uygulama Expo Go ile değil, kendi geliştirme derlemesiyle (expo-dev-client) çalışır:
  `npx expo start --dev-client`. APK: `npx eas-cli build -p android --profile development`.
- Yerel kod değiştiyse (yeni native paket, `patches/`, `plugins/`, `app.json` eklentileri) APK
  yeniden derlenmeli; yalnız JS değişikliği Metro'dan gelir.
- `@shopify/react-native-skia` → `react-native-skia@2.15.2` takma adı ve
  `patches/@shopify+react-native-skia+2.15.2.patch` (Android video çözücüsü) bilinçlidir; README'de
  gerekçesi var.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
