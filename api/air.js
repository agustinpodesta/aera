// GET /api/air?lat=..&lon=..[&at=ISO] → { aqi, pm25, source, scope, updatedAt, historical?, place? }
// The IQAir key stays server-side. Coordinates are rounded to ~1 km (a city-level
// reading needs no more), which also lets nearby requests share the CDN cache.

import { getAir, isPast } from './_lib/air.js';
import { checkBurst } from './_lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  if (!checkBurst(req)) return res.status(429).json({ error: 'too many requests' });

  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  const at = req.query.at ? new Date(req.query.at) : null;
  if (at && Number.isNaN(+at)) return res.status(400).json({ error: 'at must be an ISO date' });

  try {
    const air = await getAir(+lat.toFixed(2), +lon.toFixed(2), at);
    // Cached on Vercel's CDN only; browsers always ask again (readings change hourly).
    res.setHeader('Vercel-CDN-Cache-Control', isPast(at)
      ? 'max-age=2592000'
      : 'max-age=600, stale-while-revalidate=1200');
    res.setHeader('Cache-Control', 'max-age=0, must-revalidate');
    return res.status(200).json(air);
  } catch (err) {
    console.error('air', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ aqi: null, error: 'air data unavailable' });
  }
}
