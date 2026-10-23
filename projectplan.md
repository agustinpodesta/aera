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

## Gallery (added 23 Oct, PXLCAM-style)
- [x] On-device gallery (`src/gallery.js`, IndexedDB): every finished photo auto-saved (captured or imported); scene changes update the same entry
- [x] Camera bar: last-photo thumbnail opens the gallery (left), import a photo (right)
- [x] Gallery grid (newest first) → viewer: Share again, save, delete; back gesture walks camera ← preview/gallery ← viewer
- [x] Survives reloads; asks `navigator.storage.persist()`; "Saved only on this device" note
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
