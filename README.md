# Focus Room — Mobil (Expo)

Focus Room odalarını telefonda **dikey ekranda** gezmek için Expo / React Native istemcisi.
Veri ve iş mantığı değişmedi: uygulama, bilgisayarda çalışan aynı Express sunucusuna
(`server.js`, port 5001) yerel ağ üzerinden bağlanır. Sunucu ve web istemcisi ayrı repodadır
(`focus-room-main`, GitHub: `yucelsedat/3d-focus-room`); iki proje yalnız HTTP API ile konuşur.

## Çalıştırma

```bash
# 1) Bilgisayarda sunucu (focus-room-main klasöründe)
npm run dev:backend

# 2) Mobil geliştirme sunucusu
cd focus-room-mobile
npm install
npx expo start --dev-client   # geliştirme derlemesi (Android APK) ile aç
```

Android'de uygulama Expo Go yerine kendi **geliştirme derlemesiyle** (expo-dev-client) çalışır:
Expo Go'nun Skia'sı video desteği olmadan derlenmiştir. APK'yı EAS üretir:

```bash
npx eas-cli build -p android --profile development
```

- `eas.json` → `development`: dev client, APK, yalnız `arm64-v8a` (telefonlar)
- `app.json` → `minSdkVersion: 26` (Skia video), `plugins/withGradleLimits.js` (Gradle en fazla 2 iş)
- `@shopify/react-native-skia`, `react-native-skia@2.15.2`'ye yönlendirilir (`package.json` takma adı +
  `expo.install.exclude`): SDK 58'in 2.14.0'ı C++ derlemesinde 2.5–4.5 GB yiyor, ücretsiz EAS
  makinesinde Gradle düşüyordu. Expo daha yeni bir Skia sabitleyince takma ad kaldırılabilir.
- EAS, git'te izlenen dosyaları gönderir (`.gitignore`'dakiler hariç); commit'lenmemiş değişiklikler de dahil edilir.
- Yeni bir yerel paket (native modül) eklenince APK yeniden derlenmelidir; JS değişiklikleri Metro'dan gelir.
- `patches/@shopify+react-native-skia+2.15.2.patch` (`postinstall: patch-package`): Skia'nın Android video
  çözücüsü (`RNSkVideo.java`) kendi iş parçacığında, kare zaman damgalarına göre oynar (özgün sürüm her
  `nextImage()`'da JS iş parçacığında tek kare çözüyordu → ağır çekim, takılma; döngüde görüntü başa
  sarmıyordu). Yıkıcı (`RNSkAndroidVideo.cpp`) artık `release()` çağırır (çözücü / MediaPlayer sızmaz).

Adres girmen gerekmez — uygulama sunucuyu kendisi bulur (`src/api/discovery.js`):

1. `EXPO_PUBLIC_SERVER_URL` (isteğe bağlı, sabit adres)
2. Son başarılı bağlantı
3. Expo'nun çalıştığı bilgisayar (backend de oradadır) → aynı IP, port 5001
4. Emülatör adresleri (Android `10.0.2.2`, iOS simülatör `localhost`)
5. Telefonun yerel ağını (`x.x.x.1–254:5001`) tarama

Aday adres `GET /api/ping` → `{ app: 'focus-room' }` ile doğrulanır. Hiçbiri bulunamazsa
"Tekrar ara" ve son çare olarak elle giriş sunulur. Bağlantı koparsa (IP değişti vb.)
aşağı çekip yenilemek otomatik yeniden arar. Telefon ve bilgisayar aynı Wi-Fi'da olmalı.

## Kontroller (dikey)

| Hareket | İşlev |
|---|---|
| Sol altta başparmakla sürükle | Yürü (yüzen joystick) |
| Ekranın geri kalanını kaydır | Etrafa bak |
| ▲ / ▼ (basılı tut) | Yüksel / alçal · ▼'ye çift dokun: zemine in |
| Panele dokun | İçeriği aç (görsel, not, canvas, defter…) |
| Ortadaki + bir duvar tile'ını gösterirken dokun | Tile sayfası: **Resim** (galeri / kamera / pano / bağlantı, GIF dahil), **Video** (galeri / kamerayla çek / dosya bağlantısı; olduğu gibi yüklenir, yeniden kodlanmaz), **Metin** (markdown) ya da boş **Canvas** ekle; tile'daki medyayı boyutlandır / düzenle / sil |
| Canvas'ta oda çipine / karta dokun | O odaya git · link, YouTube, PDF, müzik tarayıcıda açılır (diğer yerler: canvas detayı). Senkron canvas'tan gidilirse hedef odadaki grup üyesinin önüne doğulur |
| Tile sayfasında / panel detayında **Kopyala** · **Kes** (resim, video, metin, canvas) | Panoya alır (üstte şerit görünür). Sonra + ile başka bir tile'a dokun → **Yapıştır** / **Taşı**. Pano odalar arası geçerli, uygulama kapansa da kalır; kesilen senkron canvas'ın bağı korunur |
| Video tile'a dokun → **Oynat** | Sesli tam ekran oynatıcı (`expo-video`, telefonun yerel oynatıcısı, videonun kendi çözünürlüğünde; yatay video için ekran yataya döner), yerel denetimler + resim içinde resim |
| Canvas'a basılı tut (ya da detayda "Tam ekran düzenle") | Yatay tam ekran canvas düzenleyici (aşağıda) |
| Zemine çift dokun | Oraya ışınlan |
| Üstteki oda adı / "Odalar" | Üst / alt / bağlantılı odalar, geçmiş. Her kartta **Gir**, alt odası varsa **Keşfet** (sayfadan çıkmadan alt odalara iner), ⚙ ayarlar: **Bağlantıyı sil** (oda kalır; aradaki kapılar + üst/alt bağı kopar) · **Sadece bu odayı sil** (alt odalar kök olur) · **Kökleriyle birlikte sil** (alt odalarıyla) |
| Renkli kapıdan yürü | Hedef odaya geç (web ile aynı kapı mantığı) |

### Canvas düzenleyici (yatay)

| Hareket | İşlev |
|---|---|
| Boşlukta tek parmakla kaydır · iki parmak | Kaydır · yakınlaştır (görünüm web'deki gibi kaydedilir) · boşluğa çift dokun: %100 |
| Öğeye dokun / sürükle | Seç / taşı |
| Seçili öğenin köşe tutamacı | Orantılı boyutlandır (web köşe tutamacı) |
| Sol üstteki araçlar (🔧) yan menüsü → **Oda linki** | Oda ara; yoksa yeni oda oluştur. Yeni oda: child / ayrık. Var olan kök oda: child olarak bağla / parent ata / ayrık (web ile aynı kurallar) |
| Yan menü → **Resim** | Galeriden çoklu seçim (ızgara olarak dizilir) · kamera · telefon panosu (resim ya da bağlantı) · bağlantı (resim / GIF; Instagram gönderisi → dikey kart; görsel sunucuya indirilir) · canvas'taki tüm resimleri galeriye kaydet |
| Boş bir yere dokun | Orada yapıştır simgesi çıkar; dokununca pano o noktaya bırakılır. Kaynaklar: canvas panosu (Kopyala / Kes, canvas'lar arası), duvarda kopyalanan / kesilen resim ya da metin tile'ı (kesilen tile canvas'a taşınır), telefonun panosu (resim · YouTube · Instagram · resim bağlantısı · bağlantı kartı · düz metin). Birden çok kaynak varsa seçilir |
| Seçili öğe çubuğu | Kopyala · Kes · Çoğalt · Sil (5 sn geri al) · Odaya git (oda linki) · Renk (oda linki / metin arka planı) · resimde Tam ekran · Kaydet (galeri) · Telefona kopyala |
| Resme çift dokun (ya da Tam ekran) | Görüntüleyici: canvas'taki resimler okuma sırasıyla, kaydırarak gezilir; kaydet / panoya kopyala |
| Sağ üstteki ✕ / Android geri tuşu | Kaydeder, dikeye döner |

Tüm ekran canvas yüzeyidir, düğmeler üstünde yüzer; duvarda görünen çerçevenin dışı hafif karartılır.

GIF'ler (ve animasyonlu WebP) düzenleyicide Skia `AnimatedImage` ile kendi kare süreleriyle
oynar (`GifLayer`: adres başına tek oynatıcı, tek kare saati; Reanimated kullanılmaz —
Expo Go'daki yerel sürümle uyuşmazlık düzenleyiciyi açılışta düşürüyordu).

Bellek / akıcılık (kalite düşürülmeden, görseller tam çözünürlükte):
- Canvas görselleri bir kez indirilip diske yazılır (`canvas/images.js`); aynı anda en fazla 4
  indirme. Kodlanmış baytlar bellekte tutulmaz: duvar çizimi her görseli diskten okuyup çözer,
  çizer, bırakır.
- Düzenleyici yalnız görünen alanın ve çevresinin görsellerini çözer (merkeze yakın olan önce),
  uzaklaşanları bırakır. GIF'ler yalnız ekrandayken kare çözer; her GIF en fazla iki kare tutar.
- Her öğe kendi picture'ına bir kez kaydedilir; bir öğe değişince yalnız o yeniden kaydedilir.
- Duvarda GIF katmanları canvas yakında ve görüş alanındayken kurulur; tüm GIF'lerin kare
  indirmeleri toplamda 8 ile sınırlıdır. Öğe sırası korunur: aradaki
öğeler ayrı Picture katmanlarına bölünür. Duvarda canvas dokusu GIF'in ilk karesini çizer;
oyuncu yakındayken GIF'in canvas'ta görünen kısmının üstünde sunucu kareleriyle oynayan bir
katman durur (`/api/gif-frames`, yalnız `/uploads` GIF'leri). Üstünü başka bir öğe örten GIF
duvarda ilk karede kalır.

## Yapı

```
src/app/            Expo Router ekranları (index: sunucu + dünyalar, room: 3D oda)
src/scene/          expo-gl + @react-three/fiber/native sahnesi
  RoomShell.jsx     zemin, iç duvar, bahçe halkaları, kapılar
  MediaPanels.jsx   duvar medyası (doku + 3D yazı + canvas mini haritası)
  ImageMedia.jsx    resim + GIF (sunucunun ürettiği kareler tek dokuda oynar: /api/gif-frames)
  VideoMedia.jsx    video tile: duvarda önizleme karesi (expo-video-thumbnails, tam çözünürlük,
                    diske önbellekli). Skia video desteği olan yerde (iOS / minSdk 26 geliştirme
                    derlemesi) sessiz döngüde oynar: Skia.Video kareleri GPU'da dik çevrilip tek
                    DataTexture'a okunur; görüş alanındaki en yakın 2 video, doku çözünürlüğü
                    ekranda kapladığı piksele göre. Expo Go'nun Android sürümünde Skia video
                    desteği derlenmemiştir ("only supported on API 26") → poster kalır.
src/video/          video.js — poster / ölçü, Skia.Video yardımcıları (yön düzeltme, kare yakalama)
  MarkdownPlane     metin tile: Skia ile çizilen sütunlu markdown dokusu
  CanvasPlane       canvas tile: web'deki duvar görünümü (kayıtlı kaydırma/yakınlaştırma,
                    kartlar, oklar); uzakta 768 px, yaklaşınca 1920 px doku
  TextMesh.jsx      Türkçe destekli 3D yazı (DM Sans 800 typeface)
  PlayerController  hareket, çarpışma, kapı geçişi (web Player.jsx portu)
src/controls/       çoklu dokunuş katmanı (joystick + bakış + dokunarak seçim)
src/markdown/       metin tile: parse.js (markdown → blok), render.js (Skia ile web
                    .mdtile düzeni: 600 px sütun, 5 birim yükseklik), skia.js (font + sıra)
src/canvas/         render.js (canvas → Skia doku ya da Picture; öğe isabeti), images.js
  editor/           yatay tam ekran düzenleyici: CanvasEditor (çerçeve, dokunmatik, yan menü),
                    RoomLinkPanel + roomLink.js (oda arama, child/parent/ayrık), useCanvasDoc
                    (PUT /api/media/:id, 600 ms gecikmeli kayıt), usePictures (görseller +
                    Picture / GIF katmanları), GifLayer, ImagePanel, ImageViewer,
                    canvasMedia.js (yükleme, yapıştırma kaynakları, galeriye kaydet)
src/components/     HUD, alttan açılan sayfalar (TileSheet: resim / metin / canvas ekleme)
scripts/            gen-typeface.mjs — TTF → three.js typeface (Türkçe karakterli)
```

Uygulama dikey ve yatayda çalışır (`app.json` → `orientation: default`, açılışta
`ScreenOrientation.unlockAsync()`). Canvas düzenleyici yataya, video oynatıcı videonun yönüne
kilitlenir; kapanınca kilit kalkar. Yatayda alt sayfalar sağdan açılan yan panel olur
(`Sheet` → `useSheetLayout`), ana sayfa iki sütundur, HUD çentik boşluklarını hesaba katar.

Oda modeli (`roomConfig`, `roomTree`) web ile ortaktır; kopyası `src/shared/` altındadır
(kanonik: `focus-room-main/src/utils`). Web'de değişirse buradaki kopya da güncellenmeli.

## Henüz mobilde olmayanlar

Tile sayfası şimdilik resim, metin ve boş canvas ekler. Canvas düzenleyicide oda linki ve
resim eklenir; telefon panosundan bağlantı / metin de yapıştırılabilir. Metin, not, ok,
müzik / PDF eklemek ve metin içeriğini düzenlemek web'de. Düzenleyicide tek öğe seçilir
(web'deki çoklu seçim yok). Diğer medya türleri (video, YouTube, başlık, defter…), RoomModal, defter düzenleme, timeline ve Claude oturum
panelleri (session / roomchat / roomsession / multiagent) yalnızca görüntülenir;
bunlar web sürümünde düzenlenir.

Metin tile'ı web'deki ölçülerle çizilir; yazı tipi web'in sistem fontundan biraz farklı
olduğu için çok uzun metinlerde sütun kırılımları birebir aynı olmayabilir.
