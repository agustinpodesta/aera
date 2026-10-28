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
- [x] Lab results on the Pixel (Oct 2026): gallery picker, JPEG-only picker, any-file picker and Google Photos → Share all strip GPS; **Files by Google → Share → Aera keeps it**
- [x] "Share → Aera" now opens the photo straight in the editor (first photo if several), with its own location
- [x] Lab round 2 on the Pixel (Chrome 155): camera folder via showDirectoryPicker works (1436 photos, 11 s to list, permission re-asked after reload) but GPS is blanked; any-file picker browsed to DCIM also blanked. Rule: whenever Chrome reads the file itself, Android zeroes the GPS
- [x] Lab round 3: picking via the any-file picker still blanked; "Open Files by Google" links only reach the Play Store (no browser entry). Conclusion: on Android only Files by Google → Share → Aera keeps GPS; the gallery button stays the normal images-only picker
- [x] Time-zone check (per Agustín, after a Buenos Aires photo got Suwon's air): photos keep their UTC offset even when Android hides GPS. An older photo from another time zone never gets "here" — the place sheet opens without the keyboard, listing recent places in that zone first, then the best-known cities there (`src/cities.js`, ~170 cities, DST-aware via Intl), "here" last
- [x] A picked place covers the trip: other photos from the same time zone within 4 days borrow it (trail stays now store the UTC offset; stays from other time zones never match)
- [x] Back from a picked/shared photo discards it (per Agustín): imports stay out of the Aera gallery until shared or saved; back returns to where you picked it with a one-tap "Choose another photo" (a back gesture can't open the picker); "Retake" becomes "Another" for picked photos; back with the place sheet open only closes the sheet. Camera shots still save right away
- [x] "Where in Buenos Aires?" step after picking a suggested city: optional search with nearby results first (distance shown, namesakes far away hidden), "Just <city>" to keep it; only the final place goes into recents and the trip trail
- [x] Checked IQAir for unmonitored places: the API already returns IQAir's own reading for places like San Isidro (AQI 13, "San Isidro" — likely their satellite-based estimate; the API has no "estimated" flag), so picking the precise place gets it
- [ ] Google Air Quality API — on hold: Agustín prefers APIs that need no billing details (see "Free air data")
- [ ] Remove `/lab.html` from the live site once testing is done
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

## Google air data (on hold — needs billing)
Why: a 500 m model everywhere (no "nearest city" gaps) and hourly history for the last 30 days, so a photo up to 30 days old shows the air *when it was taken*. Billing: one "Air Quality Usage" SKU, 10,000 free calls/month, then $5 per 1,000 (history = per page; one hour = one page).
- [ ] Agustín: Google Cloud project + billing + Air Quality API + restricted key + daily quota + budget alert; key in Vercel as `GOOGLE_AIR_QUALITY_KEY` (never in chat)
- [ ] Verify with the key: US AQI (`usa_epa`) for non-US places via `customLocalAqis` (Korea, Argentina); fallback = compute US AQI from `POLLUTANT_CONCENTRATION` with EPA breakpoints
- [ ] `api/_lib/air.js`: now → Google `currentConditions:lookup`, then IQAir, then Open-Meteo; photo ≤ 30 days old → Google `history:lookup` for that hour, else Open-Meteo hour; > 30 days → the air now (as today)
- [ ] App: photos ≤ 30 days keep their own TIME (no "now" swap); reportAt only beyond 30 days
- [ ] Attribution: strip footer "DATA GOOGLE MAPS" and info line "Google Maps" when Google supplied the reading (Google policy: visible, unmodified "Google Maps" text attribution)
- [ ] Caching: keep 10 min CDN for "now"; confirm the Maps Platform terms allow caching past hours before using 30-day CDN caching for history
- [ ] Sanity check Google vs IQAir on Seoul, Suwon, San Isidro, Jeju; then deploy

## Free air data (Oct 2026 check)
All queried by coordinates (never city names): place names only find coordinates.
- IQAir Community (in use): free key, no card; 5/min, 500/day, 10k/month; US AQI incl. IQAir's estimates for unmonitored places; no history; commercial terms unclear
- Open-Meteo (in use as fallback): no key, no card; CAMS model, US AQI with proper EPA averaging; Europe ~11 km hourly, global ~45 km 3-hourly; history back to Aug 2022 (global); free = non-commercial only
- OpenWeather Air Pollution: free key, no card; 60/min, 1M/month; hourly history from 27 Nov 2020; only a 1–5 index, so US AQI would be computed from concentrations; commercial terms unclear — not needed now
- API Ninjas: free key, but no commercial use on the free tier, no history, AQI scale undocumented — skip
- AccuWeather (checked Oct 27 2026): the $0 plan is a 14-day trial (500 calls/day, Core Weather only); air quality is only in the Enterprise plan (contact sales) — skip
- [x] ~~Older photos get the air from the hour they were taken (per Agustín): > 2 h old and since Aug 2022 → Open-Meteo modeled reading for that hour, TIME = the photo's own local time, strip says "DATA OPEN-METEO (MODELED), FOR hh:mm", place line says "when taken". 1–2 h old, before Aug 2022, or no model data for that hour → the air now with TIME = now. Photos taken now keep IQAir~~ — switched off after Agustín's test: Open-Meteo's model read 83 for yesterday in Suwon and 56 now vs IQAir's measured 31 (≈2× high). Older photos are back to IQAir's air now with TIME now (`PHOTO_TIME_AIR` flag)

## Home & credits
- [x] Home background: 12 of Agustín's trip clips (media/home, 540×960, ~4 s, silent, ~470 KB each, 5.6 MB total; GPS/location metadata stripped from every file) crossfade in random order behind a top/bottom gradient; first still shows instantly, only the next clip preloads; pauses off the home screen and in background tabs; reduced motion or data saver → a still; blocked autoplay (e.g. iOS low power) → rotating stills
- [x] Credits on home: "Air: IQAir · Open-Meteo (CAMS, CC BY 4.0) · Map © OpenStreetMap contributors" (Open-Meteo's free tier covers free, ad-free apps)
- [x] Clip 09 (cherry-blossom road, readable car plates) dropped per Agustín — 11 clips now

## Place & sticker clarity (Oct 2026, from Agustín's test)
- [x] An older photo with no known place (no GPS, no trip/trail match) asks "Where was this taken?" before showing any air; first option is "<your town> · Where you are now" (one tap, no keyboard); the strip waits ("…") until a place is chosen. Photos from the last hour still use where you are, silently
- [x] "Here" replaced by a real town name: /api/scene now returns `place` (nearest city/town label from the OpenFreeMap z10 tile, English/Latin names first): Suwon, San Isidro, Hallim, Seoul, Bariloche
- [x] Sticker is always automatic: the "Sticker: … · change" picker is gone
- [x] Strip labels AQI / AIR / TIME 30% bigger (25 → 33 px, spacing 4 → 5)
- [x] Home video bug (Agustín's test): after coming back from the photo picker, the clips only switched as stills. A single refused play() made the player give up on video for good. Now a refusal shows stills briefly and retries (0.4 s, 1.5 s, 4 s), again when the page is shown, and on the next tap

## Showcase templates (Oct 27 2026)
- [x] Overlays added to Agustín's 8 sample photos → `images templates/templates with overlay/*-aera.jpg` (2160×3840, the app's own compose.js): live IQAir readings (Open-Meteo modeled for the two Patagonia spots, no IQAir city within 40 km), automatic stickers, TIME = local time at each place now. Places: Perito Moreno walkways, Laguna de los Tres (El Chaltén), Byron Bay Main Beach, Fujikawaguchiko, Seiganto-ji (Nachikatsuura), Hyeopjae / Gyeongbokgung / Jingwan-dong (photo GPS). Strip moved off the subject on 4 photos (Gyeongbokgung with black text)
- [x] Sticker fix found on the way: hill towns read "city" (Fujikawaguchiko 853 m, Seiganto-ji 385 m: small city label nearby + many POIs). New "highland" rule: elevation ≥ 300 m, relief ≥ 400 m, no tall buildings → mountains. Checked on 20 places: only those two (and Cusco) change; Seoul, Bukchon, Suwon, Kyoto, coasts unchanged
- [x] IQAir free plan = 5 calls/min for all users: when IQAir is rate-limited or erroring, the Open-Meteo stand-in is now cached for 60 s (server + CDN), not 10 min, so IQAir comes back quickly
- [x] Instagram-style centring for the strip: while dragging or pinching, its centre snaps to the photo's vertical and/or horizontal middle within 12 screen px, with cyan guide lines (preview only, never in the JPEG) and an 8 ms buzz on Android; moving past the pull releases it
- [x] Sticker for places picked by name (per Agustín: Byron Bay showed "neighborhood"): the search point is the town centre, so the server now judges the town around it (`/api/scene?…&town=1&pop=N`): open sea + sandy beach within 2.5 km and < 1M people → coast; lake beaches don't count for towns; ≥ 300k people → city; ≥ 50k never countryside; a sizeable or hill town is never "forest". 31/33 known places right (old single-point check: 12 wrong — Byron Bay, Punta del Este, Mar del Plata, Nice, Noosa, Pinamar, Florianópolis, Queenstown, Fujikawaguchiko, Cancún…). Known misses: Tulum (centre 3.2 km inland; a wider radius makes San Isidro "coast" via the Río de la Plata), Gangneung reads neighborhood. GPS photos keep the exact-spot check, unchanged
- [x] Place search finds towns (per Agustín: Nachikatsuura was missing). Open-Meteo's geocoder (GeoNames, populated places) is now joined by Photon (komoot, OpenStreetMap; keyless, CORS, made for search-as-you-type): towns, neighbourhoods (Jingwan-dong), beaches (Hyeopjae Beach), lakes, glaciers (Perito Moreno Glacier), temples (Seiganto-ji); no streets/bus stops; duplicates merged; "Where in <city>?" biases Photon to that city. Open-Meteo results stay first (they carry population and time zone)
- [x] Never assume where a photo was taken (per Agustín): a picked or shared photo without GPS always asks "Where was this taken?" before any air is shown (the strip waits with "…"), whatever its age. Known without asking: Aera's own shutter (where you are) and photos that keep their GPS. One-tap answers on top: the place picked for this trip ("Your place on this trip"), "<town> · Where you are now", recent places (or that time zone's cities for a photo from elsewhere). The shutter with location off and no GPS asks too
- [x] Home clips froze again (Agustín). The player now has a watchdog: every 1.5 s it checks that frames are really being painted (requestVideoFrameCallback + currentTime), and climbs resume → reload clip → next clip until they are; stills only cover the gap, never final. Autoplay refusals are retried every 1.5 s (no tap needed), a broken clip is skipped, and playback restarts on visibilitychange, pageshow (back/forward cache), focus and online. Data Saver no longer switches to stills (one ~470 KB clip at a time); only the "Remove animations" accessibility setting (prefers-reduced-motion) shows a still. Tested: paused clip, broken clip, 5 refusals in a row, leave/return — all recover

