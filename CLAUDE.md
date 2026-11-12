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

Bilgi grafı `graphify-out/` altında. Git'te yalnız `GRAPH_REPORT.md` izlenir; `graph.json`,
`graph.html`, `cache/` yereldir (`.gitignore`). Neyin grafa girmeyeceği `.graphifyignore`'da.

**Okuma (her oturum):**
- Mimari / kod tabanı sorularında önce `graphify-out/GRAPH_REPORT.md` (god node'lar, topluluklar).
- Modüller arası "X, Y ile nasıl ilişkili" sorularında grep'ten önce `graphify query "<soru>"`,
  `graphify path "<A>" "<B>"`, `graphify explain "<kavram>"`.
- Graf bir haritadır, kaynak değil: son güncellemeden sonra kod değişmiş olabilir. Düzenlemeden
  önce ilgili dosyayı mutlaka oku; INFERRED / AMBIGUOUS kenarları doğrulanmamış say.

**Güncelleme — yalnız `/graphify .` (skill, tam çalıştırma):**
- Anlamlı bir iş bittiğinde (özellik birleştirildikten sonra) ya da büyük bir analizden önce
  çalıştır; her küçük düzenlemeden sonra değil.
- Anlamsal çıkarım dosya bazında önbellekte (`graphify-out/cache/`): yalnız değişen dosyalar
  alt ajanlara gider, maliyet değişiklikle orantılıdır. Graf baştan, tutarlı kurulur
  (silinen / yeniden adlandırılan sembollerden hayalet düğüm kalmaz).
- Sonra güncel `GRAPH_REPORT.md`'yi ilgili işle birlikte commit et.

**Kullanma — graphify'ın AST-only yeniden kurulumu bu projede grafı bozar:**
- `graphify update .`, `graphify watch`, `graphify hook install` (post-commit / post-checkout)
  aynı fonksiyonu (`watch._rebuild_code`) çağırır. Bu, alt ajanların çıkardığı `file_type: code`
  anlamsal düğümleri atar (ilk kurulumda 453 → 310 düğüm). `graph.json`'ı küçülttüğü için
  yazmayı reddeder ama `GRAPH_REPORT.md` ve `graph.html`'i yine de yarım grafla yazar.
  Hook'lar bu yüzden kaldırıldı; yeniden kurma.
- Rapor yine de bozulursa (Summary'de düğüm sayısı düşmüşse): `git restore
  graphify-out/GRAPH_REPORT.md`, ardından `/graphify .` (önbellekten, ucuz) ile her şeyi yeniden üret.

**`.graphifyignore` bakımı:** Yeni üretilmiş dosya (glif / font JSON'u, derleme çıktısı) ya da
görsel varlık klasörü eklenirse buraya ekle; graphify `.gitignore`'u okumaz.
