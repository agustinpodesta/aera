// Where a photo was taken, and what kind of place that is.
// GPS is read from EXIF on-device; only rounded coordinates go to /api/scene.

import * as exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs';

/**
 * The photo's own location, or null. Android's photo picker can hide location by zeroing
 * the GPS fields rather than removing them; that reads as NaN or 0,0, so only real
 * coordinates count.
 * @returns {Promise<{lat:number, lon:number}|null>}
 */
export async function photoGps(src) {
  try {
    const gps = await exifr.gps(src);
    return validCoords(gps?.latitude, gps?.longitude);
  } catch {
    return null;
  }
}

/**
 * Like photoGps, but also says when the location was there and got blanked
 * (Android's photo picker zeroes GPS for browsers), so the UI can explain it.
 * @returns {Promise<{gps: {lat:number, lon:number}|null, hidden: boolean}>}
 */
export async function photoLocation(src) {
  try {
    const raw = await exifr.gps(src);
    const gps = validCoords(raw?.latitude, raw?.longitude);
    return { gps, hidden: !gps && raw != null && ('latitude' in raw || 'longitude' in raw) };
  } catch {
    return { gps: null, hidden: false };
  }
}

export function validCoords(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  const ok = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180
    && !(Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6);
  return ok ? { lat, lon } : null;
}

/**
 * When the photo was taken (EXIF DateTimeOriginal) and the UTC offset of the place,
 * so TIME shows the local clock where it was taken. Returns null when absent.
 * @returns {Promise<{at: Date, utcOffsetMin: number|null}|null>}
 */
export async function photoTakenAt(src) {
  try {
    const tags = await exifr.parse(src);
    const at = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (!(at instanceof Date) || Number.isNaN(+at)) return null;
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(tags.OffsetTimeOriginal ?? tags.OffsetTime ?? '');
    return { at, utcOffsetMin: m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null };
  } catch {
    return null;
  }
}

/** @returns {Promise<{scene:string|null, signals?:object}>} */
export async function fetchScene({ lat, lon }) {
  if (!validCoords(lat, lon)) return { scene: null };
  try {
    const res = await fetch(`api/scene?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
    return await res.json();
  } catch {
    return { scene: null };
  }
}

/** Device location, coarse and quick (a city-level reading needs no GPS precision). */
export function locateMe() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null), // denied, unavailable or timed out → manual place search
      { enableHighAccuracy: false, maximumAge: 10 * 60e3, timeout: 12e3 },
    );
  });
}

/**
 * Air for a place; pass `at` for photos taken earlier (the server returns that hour's value).
 * @returns {Promise<{aqi:number|null, pm25?:number|null, source:string, scope:string, updatedAt:string|null, historical?:boolean}|null>}
 */
export async function fetchAir({ lat, lon }, at = null) {
  if (!validCoords(lat, lon)) return null;
  try {
    const q = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}${at ? `&at=${encodeURIComponent(at.toISOString())}` : ''}`;
    const res = await fetch(`api/air?${q}`);
    const body = await res.json();
    return res.ok ? body : null;
  } catch {
    return null;
  }
}

/** City search for photos without a location (Open-Meteo geocoding, keyless, CORS-enabled). */
export async function searchPlaces(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en`);
    const { results = [] } = await res.json();
    return results.map((r) => ({
      name: r.name,
      detail: [r.admin1, r.country].filter((x) => x && x !== r.name).join(', '),
      lat: r.latitude,
      lon: r.longitude,
      tz: r.timezone, // IANA zone: lets a recent place be suggested for photos from that zone
    }));
  } catch {
    return [];
  }
}
