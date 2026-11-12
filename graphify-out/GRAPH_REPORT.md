# Graph Report - .  (2026-11-12)

## Corpus Check
- 65 files · ~54,609 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 453 nodes · 846 edges · 17 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 186 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Room Scene & Hover Picking|Room Scene & Hover Picking]]
- [[_COMMUNITY_Video Playback & Build Docs|Video Playback & Build Docs]]
- [[_COMMUNITY_Canvas Editor UI|Canvas Editor UI]]
- [[_COMMUNITY_Room Loading & Navigation|Room Loading & Navigation]]
- [[_COMMUNITY_Image Media & Texture Cache|Image Media & Texture Cache]]
- [[_COMMUNITY_Server Discovery & Backend Link|Server Discovery & Backend Link]]
- [[_COMMUNITY_Canvas Media Items|Canvas Media Items]]
- [[_COMMUNITY_Media Sheet & Type Meta|Media Sheet & Type Meta]]
- [[_COMMUNITY_HUD & Tile Sheet|HUD & Tile Sheet]]
- [[_COMMUNITY_Media API Uploads|Media API Uploads]]
- [[_COMMUNITY_Markdown Rendering Pipeline|Markdown Rendering Pipeline]]
- [[_COMMUNITY_Canvas Plane Rendering|Canvas Plane Rendering]]
- [[_COMMUNITY_Room Link Panel|Room Link Panel]]
- [[_COMMUNITY_Canvas Image Cache|Canvas Image Cache]]
- [[_COMMUNITY_Markdown Parser|Markdown Parser]]
- [[_COMMUNITY_Texture Format Check|Texture Format Check]]
- [[_COMMUNITY_Expo Docs Rule|Expo Docs Rule]]

## God Nodes (most connected - your core abstractions)
1. `Editor()` - 25 edges
2. `api()` - 22 edges
3. `pasteFrom()` - 19 edges
4. `assetUrl()` - 15 edges
5. `Walls()` - 12 edges
6. `Panel (per-type media dispatcher)` - 12 edges
7. `itemFromText()` - 11 edges
8. `FrameCache` - 11 edges
9. `TileSheetBody()` - 11 edges
10. `Detail()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `getPoster()` --semantically_similar_to--> `Canvas memory / smoothness strategy (disk cache, max 4 downloads, visible-only decode, GIF frame limit 8)`  [INFERRED] [semantically similar]
  /home/sedat/projects/games/focus-room-mobile/src/video/video.js → README.md
- `Rationale: Gradle OOM on free EAS Android machine (daemon disappeared)` --semantically_similar_to--> `Rationale: SDK 58 Skia 2.14.0 C++ build used 2.5-4.5 GB, Gradle crashed on free EAS machine`  [INFERRED] [semantically similar]
  plugins/withGradleLimits.js → README.md
- `Rationale: Expo Go Android lacks Skia video (API 26), detect once and fall back to poster` --semantically_similar_to--> `Rationale: Expo Go Skia built without video support, hence dev client`  [INFERRED] [semantically similar]
  src/video/video.js → README.md
- `formatTime()` --conceptually_related_to--> `Video tile wall playback (poster + Skia.Video to DataTexture, nearest 2)`  [AMBIGUOUS]
  /home/sedat/projects/games/focus-room-mobile/src/video/video.js → README.md
- `api()` --references--> `focus-room-main Express backend (server.js, port 5001)`  [INFERRED]
  /home/sedat/projects/games/focus-room-mobile/src/api/client.js → CLAUDE.md

## Hyperedges (group relationships)
- **Server auto-discovery and persistence flow** — discovery_discoverserver, discovery_probe, discovery_firstalive, discovery_subnetcandidates, discovery_devhost, client_saveserverurl, readme_server_discovery_order [EXTRACTED 0.95]
- **Tile cut/copy/paste via clone + delete + store** — tileclipboard_toggleclip, tileclipboard_pasteclipboard, media_clonemediatotile, media_deletemedia, usestore_tileclipboard [EXTRACTED 0.90]
- **EAS free-machine build memory mitigations** — withgradlelimits_withgradlelimits, withgradlelimits_oom_rationale, readme_skia_alias, readme_skia_alias_rationale, readme_eas_dev_profile [INFERRED 0.80]
- **Canvas editor paste pipeline (canvas / tile / phone clipboard)** — canvaseditor_editor, canvasmedia_pastesources, canvasmedia_pastefrom, canvasmedia_copyitemassets, canvasmedia_placeclipitems, canvasmedia_itemfromtext, canvasmedia_tilesource, canvasmedia_post_api_canvas_copy_images [EXTRACTED 0.90]
- **Viewport-driven image decode and Skia picture layering** — usepictures_useeditorimages, usepictures_wantedurls, images_loadimagedata, images_localimage, usepictures_useitemlayers, usepictures_useitempicturecache, render_recorditems, giflayer_usegifclock, giflayer_gifitem [INFERRED 0.85]
- **Tile copy/cut clipboard shared across sheets, HUD and canvas editor** — mediasheet_clipactions, tilesheet_clipbuttons, tilesheet_pastebanner, roomhud_roomhud, canvasmedia_pastefrom [INFERRED 0.75]
- **Markdown to Skia to GL texture pipeline** — parse_parsemarkdown, render_createmarkdownrenderer, skia_getmarkdownrenderer, skia_enqueuerender, markdownplane_markdownplane, markdownplane_maketexture [EXTRACTED 0.95]
- **Touch input to shared input state to first-person camera** — touchlayer_touchlayer, input_input, playercontroller_playercontroller, roomscene_pick, syncspawn_spawninfrontof [INFERRED 0.85]
- **Distance + frustum gated media LOD / playback** — canvasplane_canvasplane, imagemedia_frameplayer, videomedia_videoplane, videomedia_chooseplaying [INFERRED 0.85]

## Communities

### Community 0 - "Room Scene & Hover Picking"
Cohesion: 0.06
Nodes (46): doorWorldPos(), GROUND_Y eye height, innerWallTransform(), RINGS garden wall rings (+-30, +-40), ringWallTransform(), faces(), pickTile(), tileMeshes instanced mesh registry (+38 more)

### Community 1 - "Video Playback & Build Docs"
Cohesion: 0.06
Nodes (37): Continuous Native Generation (configure native via app.json + config plugins), EAS build / submit / update, expo-dev-client development build (not Expo Go), Rule: native changes need APK rebuild, JS comes from Metro, Icon(), ICON_PATHS, VideoDetail(), Landscape fullscreen canvas editor (+29 more)

### Community 2 - "Canvas Editor UI"
Cohesion: 0.07
Nodes (30): CanvasEditor(), Editor(), EditorHost(), useThrottled(), copyImageToPhone(), saveImageToPhone(), createClock(), GifItem() (+22 more)

### Community 3 - "Room Loading & Navigation"
Cohesion: 0.08
Nodes (33): RootLayout (fonts, splash, portrait lock, Stack), Expo Router navigation (routes in src/app), Shared room model copy (src/shared <-> focus-room-main/src/utils), loadServerUrl(), ESLint flat config (expo + R3F overrides), Rationale: R3F passes three.js props as JSX and mutates in useFrame, byLayer(), loadRoom() (+25 more)

### Community 4 - "Image Media & Texture Cache"
Cohesion: 0.1
Nodes (18): assetUrl(), patchExpoGL(), THREE console filter (Clock / WEBGL_lose_context), acquire(), FirstFramePlane(), FrameCache, frameName(), FramePlayer() (+10 more)

### Community 5 - "Server Discovery & Backend Link"
Cohesion: 0.1
Nodes (27): Rule: do not break existing API behavior (web + mobile share backend), focus-room-main Express backend (server.js, port 5001), Mobile and server talk only over HTTP API, Mobile-added endpoints (/api/ping, /api/rooms/:id/disconnect, /api/gif-frames), normalizeServerUrl(), saveServerUrl(), devHost(), discoverServer() (+19 more)

### Community 6 - "Canvas Media Items"
Cohesion: 0.15
Nodes (27): buildInstaItem(), buildLinkItem(), buildYoutubeItem(), centered(), copyItemAssets(), fitImage(), GET /api/link-meta, GET /api/youtube-meta (+19 more)

### Community 7 - "Media Sheet & Type Meta"
Cohesion: 0.11
Nodes (19): metaFor(), panelImage(), panelText(), parseJson(), stripMarkdown(), TYPE_META / metaFor() media type styling, youtubeId(), youtubeThumb() (+11 more)

### Community 8 - "HUD & Tile Sheet"
Cohesion: 0.12
Nodes (16): Crosshair(), HoldButton(), RoomHUD(), clipLabel(), isHttp(), PasteBanner(), TileSheet(), TileSheetBody() (+8 more)

### Community 9 - "Media API Uploads"
Cohesion: 0.16
Nodes (21): Rationale: mobile sends roomId explicitly (server activeRoomId changes when web switches room), api(), getServerUrl(), addCanvasToTile(), addImageToTile(), addTextToTile(), addVideoToTile(), clipboardImageToFile() (+13 more)

### Community 10 - "Markdown Rendering Pipeline"
Cohesion: 0.14
Nodes (18): global GIF download semaphore (acquire/release), makeTexture(), MarkdownPlane(), columnGeometry(), createMarkdownRenderer(), FAMILY font families (DM Sans / JetBrains Mono), MD tile metrics (200 px/unit, 600 px columns), THEME light/dark markdown palette (+10 more)

### Community 11 - "Canvas Plane Rendering"
Cohesion: 0.16
Nodes (16): canvasGifs(), CanvasPlane(), makeTexture(), a4MaxH(), boxOf(), CANVAS_PX_W, canvasHitTest(), canvasImageUrls() (+8 more)

### Community 12 - "Room Link Panel"
Cohesion: 0.21
Nodes (12): web CanvasMesh (focus-room-main), applyRoomPlan(), existingRoomPlan(), makeRoomItem(), newRoomPlan(), POST /api/rooms, PUT /api/rooms/:id/settings, roomChipSize() (+4 more)

### Community 13 - "Canvas Image Cache"
Cohesion: 0.35
Nodes (10): downloadToCache(), extOf(), enqueue(), extOf(), hash(), loadImageData(), localImage(), prepareImages() (+2 more)

### Community 14 - "Markdown Parser"
Cohesion: 0.42
Nodes (7): findClose(), isWord(), joinLines(), parseInline(), parseMarkdown(), splitRow(), startsBlock()

### Community 15 - "Texture Format Check"
Cohesion: 0.67
Nodes (2): kind(), Rationale: expo-gl stb_image decodes only baseline/progressive JPEG and PNG; content not extension matters

### Community 22 - "Expo Docs Rule"
Cohesion: 1.0
Nodes (1): Rule: use versioned Expo docs, do not trust training data

## Ambiguous Edges - Review These
- `formatTime()` → `Video tile wall playback (poster + Skia.Video to DataTexture, nearest 2)`  [AMBIGUOUS]
  src/video/video.js · relation: conceptually_related_to

## Knowledge Gaps
- **29 isolated node(s):** `Rule: use versioned Expo docs, do not trust training data`, `Mobile and server talk only over HTTP API`, `Rule: do not break existing API behavior (web + mobile share backend)`, `Rationale: original decoded one frame per nextImage on JS thread (slow motion, stutter, no loop rewind) and leaked decoder`, `Rationale: Reanimated avoided, native version mismatch in Expo Go crashed editor` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Texture Format Check`** (3 nodes): `kind()`, `Rationale: expo-gl stb_image decodes only baseline/progressive JPEG and PNG; content not extension matters`, `check-textures.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Expo Docs Rule`** (1 nodes): `Rule: use versioned Expo docs, do not trust training data`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `formatTime()` and `Video tile wall playback (poster + Skia.Video to DataTexture, nearest 2)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `assetUrl()` connect `Image Media & Texture Cache` to `Video Playback & Build Docs`, `Canvas Editor UI`, `Server Discovery & Backend Link`, `Canvas Media Items`, `Media Sheet & Type Meta`, `Media API Uploads`, `Canvas Image Cache`?**
  _High betweenness centrality (0.320) - this node is a cross-community bridge._
- **Why does `Editor()` connect `Canvas Editor UI` to `Video Playback & Build Docs`, `Canvas Media Items`, `HUD & Tile Sheet`, `Canvas Plane Rendering`, `Room Link Panel`?**
  _High betweenness centrality (0.202) - this node is a cross-community bridge._
- **Why does `pasteFrom()` connect `Canvas Media Items` to `Canvas Editor UI`, `Room Loading & Navigation`, `Image Media & Texture Cache`, `Media Sheet & Type Meta`, `HUD & Tile Sheet`, `Media API Uploads`?**
  _High betweenness centrality (0.188) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `api()` (e.g. with `.fetch()` and `applyRoomPlan()`) actually correct?**
  _`api()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `pasteFrom()` (e.g. with `api()` and `imageSize()`) actually correct?**
  _`pasteFrom()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `assetUrl()` (e.g. with `ImageViewer()` and `pasteFrom()`) actually correct?**
  _`assetUrl()` has 10 INFERRED edges - model-reasoned connections that need verification._