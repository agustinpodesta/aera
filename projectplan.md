# Aera — project plan

*Ex-"Airframe" (renamed because an iOS "AirFrame" air-quality app already exists). PRD: `AIRFRAME_PRD.txt`.*

**Decisions (15 Oct 2026):** static HTML/JS + Vercel `/api` serverless (per webapp playbook, not Next.js) · domain aeracam.com · 9:16 (1080×1920) export only · IQAir Community (city-level US AQI) with Open-Meteo fallback labelled "modeled" · US AQI everywhere · Vercel Analytics · no accounts, photos processed on-device.

## Milestone 1 — Static visual prototype
- [x] Scaffold project (package.json, vercel.json, .env.example, .gitignore)
- [x] Design tokens: paper / forest / charcoal / signal orange; Instrument Serif + IBM Plex Mono
- [x] Canvas composition renderer (`src/compose.js`) — 1080×1920 "field report" template
- [x] AQI scale + categories (`src/aqi.js`), US EPA breakpoints
- [x] States: sample reading, no-data, long place names, 3-digit AQI
- [x] Studio page (`studio.html`): your photos, sample readings, IG safe-zone overlay, PNG download
- [x] All text kept inside IG Story safe area (≥250px from top/bottom); verified at 375px mobile width
- [x] Review v1 ("paper panel below photo") with Agustín's photos → feedback: make it a Strava-style overlay
- [x] v2 template: full-bleed photo + receipt-like strip (AERA/001 · AQI · AIR · PLACE · TIME · AQI scale tick · date/scope/source/URL), scrim + shadows for legibility on bright photos
- [x] v2.1: removed frame number, date, "US AQI" and scope label; footer is just source + update time + URL ("(MODELED)" added only for Open-Meteo fallback)
- [x] v2.2: removed PLACE row (Strava-style: no location on the image)
- [x] v3: AQI colour dot (dark green ≤15 · green ≤33 · light green ≤50 · yellow · orange · red · purple · dark purple); scale ruler removed; AERA wordmark centred at the bottom (Unbounded / Syne / Michroma candidates); scene glyph under it (city, neighborhood, coast, countryside, mountains, forest), picked by hand in the studio
- [x] Wordmark locked: Syne ExtraBold. **Template locked** (22 Oct 2026)
- [x] Tweak (23 Oct): wordmark 35% smaller (70 → 46 px), whole strip at 60% opacity (scrim unchanged)
- [x] Tweak (23 Oct): AQI dot is solid colour (no white ring); wordmark 5% smaller (46 → 44 px)
- [ ] Consider (P1): drag strip up/down so it doesn't cover the subject

## Milestone 2 — Working camera
- [x] Local dev server (`node dev-server.mjs`) running static + /api without vercel login
- [x] App (`index.html` + `src/app.js`): start → camera → preview screens, Android/browser back returns to start
- [x] Camera screen (`src/camera.js`): getUserMedia, rear camera preferred, 9:16 WYSIWYG viewfinder, shutter, front camera mirrored
- [x] Stream stopped after capture, on close/back, and when the tab is hidden (restarted on return)
- [x] Clear errors for blocked / missing / busy camera, each offering "choose a photo"
- [x] Photo upload fallback: EXIF GPS → Auto scene; EXIF capture time + UTC offset → TIME shows local time where taken
- [x] Preview screen: composed image, Auto scene + one-tap override chips, Retake
- [x] Export JPEG (0.92) prepared ahead of the tap; "Save or share" via Web Share when files are shareable, else Download
- [x] Verified in browser at 375px with a simulated camera stream (pane blocks real cameras)
- [x] Git + private GitHub repo (github.com/agustinpodesta/aera) + Vercel project `aera` (CLI-deployed with `vercel deploy --prod`, not git-connected)
- [x] Public, no sign-in: Vercel login protection turned off; live at https://aeracam.vercel.app (attached as a project domain, so it follows every production deploy)
- [x] Frictionless flow (PixelCam-style): link opens straight into the camera; start screen only as fallback; Share is the primary button, save icon beside it; back = retake
- [x] Deployed: app, studio and /api/scene verified live; PRD/plan/dev server/photos excluded (404)
- [ ] **Test on a real phone** — https://aeracam.vercel.app (iPhone Safari + Android Chrome: camera, shutter, Share → Instagram Story)
- [x] Live captures get scene + real air via geolocation; SAMPLE DATA removed from the app

## Milestone 3 — Real air-quality data
- [x] `api/air.js`: lat/lon → IQAir `nearest_city` (only if its city is ≤ 40 km away and the reading ≤ 6 h old); key stays server-side
- [x] Open-Meteo fallback (modeled, labelled "(MODELED)" on the image and "modeled" in the UI)
- [x] Coordinates rounded (~1 km air, ~100 m scene); in-memory + CDN cache (10 min now, 30 days past hours); per-IP burst limit on /api/air and /api/scene
- [x] Geolocation asked right after the camera opens; air + scene prefetched so the preview is instant; city search sheet (Open-Meteo geocoding) + "use my current location"
- [x] Uploaded old photos: the modeled AQI for the hour they were taken ("FOR hh:mm"), never today's reading; NO AIR DATA FOR THAT DAY when outside the archive
- [x] No-data flow: "Add where this was taken" prompt; NO READING on the image when nothing is available; Share disabled while the reading loads
- [x] Attribution + data timestamp on image (DATA IQAIR, UPDATED hh:mm) and source line in the UI
- [x] Scene detection from location (`api/scene.js` + `api/_lib/scene.js`): OpenFreeMap OSM tiles (sea, beach, woods/ice, tall buildings, POIs, nearby city) + 1 Open-Meteo elevation point vs named peaks. Calibrated on 16 places: 15/16 (Bukchon hanok village reads as city — ambiguous). Coords rounded to ~100 m, CDN-cached 30 days. Photo never uploaded.
- [x] Studio: reads photo EXIF GPS on-device → Auto scene, with one-tap override
- [x] App preview screen: Auto scene + one-tap override
- [ ] Before launch: Open-Meteo free tier is non-commercial (10k calls/day) — buy API plan or switch elevation source; add OSM attribution ("© OpenStreetMap contributors") on the about/credits page

- [x] IQAir key added in Vercel (Production); live readings verified as IQAir city readings (Seoul AQI 39 vs model 89 — model is only the fallback)

## Camera quality (24 Oct)
- [x] Diagnosis: in-browser camera = 1080p video frame, no HDR+, cropped FOV; Pixel camera = 12.5 MP processed photo
- [x] Shutter now opens the phone's own camera (`<input capture="environment">`): full quality, no camera-permission prompt; in-browser viewfinder removed (`src/camera.js` deleted)
- [x] Home screen: wordmark, shutter, latest-photo gallery button, import; location asked on open and prefetched (retries if it failed or went stale)
- [x] Preview: drag to reposition the 9:16 crop (photo scaled once to just cover 1080×1920, so redraws are fast and export is identical); "Drag to frame" hint
- [x] Sharper export: up to 2160×3840 (8 MP) when the photo has the detail (12 MP phone photos do); drag redraws at 1080 for smoothness; ~2.2 MB JPEG
- [x] Lighter gradient behind the strip (max 40% instead of 60%), so the photo isn't muddied
- [ ] Ultra HDR: Pixel/Android photos carry an HDR gain map that canvas drops (export is SDR, looks flatter in Google Photos on HDR screens). Option: re-attach a cropped gain map via libultrahdr (WASM) — bigger project
- [x] Diagnosis 2: camera hand-off on Pixel returns a weaker photo (−25% edge detail, −13% contrast, motion blur, no Ultra HDR) — Aera's own pipeline on the Pixel's saved photo stays sharp
- [x] Home keeps the quick camera shutter + a visible "Use a photo you just took · Best quality" option; photos taken < 1 h ago count as "now" (current air; current location when the picker strips GPS)
- [x] Robustness: image loading uses the load event (img.decode() could hang while the page is in the background)
- [x] Scene detector recalibrated: near a city centre (≤ 5 km) 15 POIs = city; forest needs < 10 POIs; inside a city, mountains need ≥ 600 m relief. 18/19 test places (Suwon ×3 now city; Bukchon still ambiguous)
- [x] Sticker is automatic: chips hidden behind "Sticker: City · change"
- [x] API caching: long on Vercel's CDN (cleared each deploy), browsers always revalidate (no stale scenes after fixes)
- [x] Strip opacity 75%
- [x] Old photos (per Agustín): place from the photo's GPS → the air there *now* + automatic sticker; the strip's TIME becomes now so the report never claims the photo's date. No GPS in the file → your current location, flagged "No location in photo · set it"
- [x] "No reading" on gallery photos fixed: Android's picker zeroes GPS fields (reads as NaN), which Aera sent as lat=NaN → 400 (seen in Vercel logs). Now only real coordinates count; otherwise current location + "No location in photo · set it". Air lookup retries once before "no reading"
- [x] Root cause of "no location" on picked photos: Android blanks GPS for Chrome (no media-location permission; Chromium WontFix 428397711). Tried the Files picker — verified on the Pixel that it is blanked there too, and it showed non-image files, so reverted to the images-only gallery picker
- [x] Older photos without a readable location open "Where was this taken?" straight away; last 5 picked places offered as "Recent" (one tap); just-taken photos keep the current location
- [x] No more "where was this taken?" pop-up (per Agustín: too much friction). Older photos without GPS now borrow the place from an on-device trail (`src/trail.js`: ~1 km stays from each location fix + places you picked, kept 1 year, never uploaded), matched within 3 h of when the photo was taken; else your current location. The place line shows "· change" when guessed. Setting a place once covers the rest of that trip's photos
- [x] Checked the pasted workarounds (Oct 2026): since April 2026 Android also strips GPS via the file manager and Google Photos' share sheet, so neither `accept=".jpg"` nor a PWA Share Target gets it back
- [x] Deep research (Oct 2026) on getting photo GPS from Google Photos into a website: Google Photos Picker API strips location by design (documented; 0/161 photos in a dev's test); Library API has no location; Data Portability API has no Photos; only Takeout has it (manual). Chrome bug 428397711 WontFix, Firefox bug 2029620 open, WHATWG "keep location" proposal has no implementer. Android's Aug 2026 photo picker adds "Include location" — apps must opt in (Snapseed has; Chrome hasn't). iOS picker keeps library-photo location via Options → Location
- [x] Location lab (`/lab.html`) + installable Aera (manifest, icons, `sw.js` share target): tests gallery picker, JPEG-only picker, any-file picker, and "Share → Aera" from Google Photos / Files on the real phone
- [ ] Run the lab on the Pixel → decide: share target (if GPS survives) or a thin Android shell that reads GPS natively and hands the original to the site
- [ ] Real auto-location fallback if sharing also strips: thin Android shell (TWA + small native picker using the new photo-picker location option) — Play Store closed test needs 12 testers × 14 days for new personal accounts
- [x] Pinch to resize the strip (0.5×–1.77×, grows around its centre, follows the fingers), like an Instagram sticker; edge limits loosened 80% per Agustín (50 px top/bottom, 8 px sides)
- [x] Movable strip: drag it anywhere in the preview (photo reframes when dragging elsewhere); clamped to IG's safe area (y 250–1670, 40 px sides); the darkening band follows the strip. (Strava's IG sticker is movable via the native Share-to-Stories sticker layer, which web apps can't use.)

## Gallery (added 23 Oct, PXLCAM-style)
- [x] On-device gallery (`src/gallery.js`, IndexedDB): every finished photo auto-saved (captured or imported); scene changes update the same entry
- [x] Camera bar: last-photo thumbnail opens the gallery (left), import a photo (right)
- [x] Gallery grid (newest first) → viewer: Share again, save, delete; back gesture walks camera ← preview/gallery ← viewer
- [x] Survives reloads; asks `navigator.storage.persist()`; "Saved only on this device" note
- [x] Save to the phone's gallery: iOS → share sheet ("Save Image" → Photos, the only route Apple allows websites); Android → one-tap download into the gallery (Downloads) + confirmation toast; preview is a real JPEG so long-press "Save to Photos" / "Download image" works
- [x] Gallery photos are editable: the original photo + edit state (crop, strip position/size, sticker, place, reading) are stored (IndexedDB v2 `original` store), so tapping a photo reopens it in the editor; saving updates the same entry; Retake becomes Delete there. Photos saved before this stay view-only
- [x] No darkening band following the strip: an even 18% tint over the whole photo instead
- [x] White / black strip text: half-white/half-black disc toggle in the editor; both inks keep the same faint dark tint (black has a light halo)
- [x] Pinch-zoom the photo (1–4×, around the fingers, pan while pinching); zoomed exports draw from the full-res original
- [x] Gallery multi-select: "Select" or long-press, then Share (several files in one share sheet) or Delete
- [x] Home: "Tap to begin" bubble floating over the shutter until the first photo (localStorage), still under reduced motion
- [ ] iPhone Safari may clear site storage after ~7 days unused → add PWA manifest + "Add to Home Screen" hint (M4)

## Milestone 4 — Sharing & testing
- [x] Web Share API with File (capability-detected) — basic version shipped in M2; test on devices
- [ ] Download fallback + "Open Instagram → Story → pick from gallery" instructions
- [ ] Vercel Analytics + events (capture, export, share attempt, share success) — note: custom events need Vercel Pro; otherwise use a tiny /api/event or Plausible
- [ ] Self-host fonts; OG image; robots/sitemap; favicon
- [ ] Test on real iPhone (Safari) + Android (Chrome)
- [ ] Deploy to Vercel, attach aeracam.com (Porkbun DNS)

## Later (P1, after validation)
Multiple templates · front/rear switch · film effects · ambient AQI colour · local history · gallery · EXIF import (needs historical data)
