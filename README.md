# Aera

A camera that stamps your photo with the air quality where it was taken. Static HTML/JS + Vercel `/api` functions. Photos never leave the device.

## Run locally
```bash
npm install
npm run dev        # http://localhost:8120 — static pages + /api functions
```

## Files
- `index.html`, `src/app.js`, `src/app.css` — the app: start → camera → preview → save/share
- `src/camera.js` — getUserMedia start/stop/capture
- `src/location.js` — EXIF GPS + capture time (on-device), `/api/scene` client
- `src/compose.js` — the template: draws the 1080×1920 air report on a canvas
- `src/aqi.js` — US AQI bands + colour dot scale
- `src/scenes.js` — scene glyphs (city, neighborhood, coast, countryside, mountains, forest)
- `api/scene.js` — `GET /api/scene?lat=&lon=` → detected scene from map data (photo never uploaded)
- `dev-server.mjs` — local server for static files + `/api/*`
- `studio.html` — design studio: try photos × sample readings, IG safe zones, PNG export
- `samples/` — drop your own test photos here and list their filenames in `samples/samples.json`, e.g. `["street.jpg", "park.jpg"]`
- `projectplan.md` — milestones and progress
