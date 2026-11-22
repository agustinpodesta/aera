# Aera

A camera that stamps your photo with the air quality where it was taken. Static HTML/JS + Vercel `/api` functions. Photos never leave the device.

## Run locally
```bash
npm install
npm run dev        # http://localhost:8120 — static pages + /api functions
```

## Files
- `index.html`, `src/app.js`, `src/app.css` — the app: home → phone camera → preview (drag to frame) → share/save
- The shutter uses `<input capture>`: the phone's own camera app takes the photo (full quality, HDR)
- `src/gallery.js` — on-device gallery (IndexedDB): save, list, get, delete
- `src/location.js` — EXIF GPS + capture time (on-device), `/api/scene` client
- `src/compose.js` — the template: draws the 1080×1920 air report on a canvas
- `src/aqi.js` — US AQI bands + colour dot scale
- `src/scenes.js` — scene glyphs (city, neighborhood, coast, countryside, mountains, forest)
- `api/air.js` — `GET /api/air?lat=&lon=[&at=]` → US AQI (IQAir city reading, else Open-Meteo modeled; past hours for old photos)
- `api/scene.js` — `GET /api/scene?lat=&lon=` → detected scene from map data (photo never uploaded)
- `dev-server.mjs` — local server for static files + `/api/*`
- `studio.html` — design studio: try photos × sample readings, IG safe zones, PNG export
- `samples/` — drop your own test photos here and list their filenames in `samples/samples.json`, e.g. `["street.jpg", "park.jpg"]`
- `projectplan.md` — milestones and progress

## License

MIT, see `LICENSE`. Reference images in `media/about/` belong to their owners.
