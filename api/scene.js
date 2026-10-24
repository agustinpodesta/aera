// GET /api/scene?lat=..&lon=.. → { scene, signals }
// Classifies where a photo was taken (city, neighborhood, coast, countryside,
// mountains, forest) from map data. Only coordinates are sent — never the photo.
// Coordinates are rounded to ~100 m, which also makes responses CDN-cacheable.

import { detectScene } from './_lib/scene.js';
import { checkBurst } from './_lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  if (!checkBurst(req)) return res.status(429).json({ scene: null, error: 'too many requests' });

  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const { scene, signals } = await detectScene(+lat.toFixed(3), +lon.toFixed(3));
    // Long-lived on Vercel's CDN (cleared on every deploy); browsers always revalidate,
    // so detector fixes reach people immediately.
    res.setHeader('Vercel-CDN-Cache-Control', 'max-age=2592000, stale-while-revalidate=86400');
    res.setHeader('Cache-Control', 'max-age=0, must-revalidate');
    return res.status(200).json({ scene, signals });
  } catch (err) {
    console.error('scene', err);
    // The app falls back to "no glyph" + manual pick; don't cache failures.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ scene: null, error: 'map data unavailable' });
  }
}
