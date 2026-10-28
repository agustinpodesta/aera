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
/**
 * The sticker for a place. `area.town`: a place picked by name, so the server judges the
 * town around the point (a beach town's centre can sit 1 km from its beach); `area.pop`:
 * its population, when known. GPS spots (photo, "where you are") are judged as a point.
 */
export async function fetchScene({ lat, lon }, area = null) {
  if (!validCoords(lat, lon)) return { scene: null };
  const town = area?.town ? `&town=1${area.pop > 0 ? `&pop=${Math.round(area.pop)}` : ''}` : '';
  try {
    const res = await fetch(`api/scene?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}${town}`);
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

/**
 * Place search for photos without a location. Two keyless, CORS-enabled sources together:
 *  - Open-Meteo geocoding (GeoNames): cities and towns, with population and time zone;
 *  - Photon (komoot, OpenStreetMap): what GeoNames misses, e.g. Nachikatsuura, neighbourhoods
 *    like Jingwan-dong, beaches, lakes, glaciers, temples.
 * Open-Meteo's results come first; Photon adds the rest (no streets or bus stops), and the
 * same place found twice shows once. `near` biases Photon towards a city ("Where in…?").
 */
export async function searchPlaces(query, count = 6, near = null) {
  const q = query.trim();
  if (q.length < 2) return [];
  const [cities, osm] = await Promise.all([openMeteoSearch(q, count), photonSearch(q, near)]);
  const out = [];
  for (const p of [...cities, ...osm]) {
    // Same place twice: close by under a similar name, or the very same name and region
    // (OpenStreetMap stores big features such as a glacier in several pieces).
    if (out.some((o) => (sameName(o.name, p.name) && kmApart(o, p) < 15) || (plain(o.name) === plain(p.name) && o.detail === p.detail))) continue;
    out.push(p);
  }
  return out.slice(0, Math.max(count, 8));
}

async function openMeteoSearch(q, count) {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=en`);
    const { results = [] } = await res.json();
    return results.map((r) => ({
      name: r.name,
      detail: [r.admin1, r.country].filter((x) => x && x !== r.name).join(', '),
      lat: r.latitude,
      lon: r.longitude,
      tz: r.timezone, // IANA zone: lets a recent place be suggested for photos from that zone
      pop: r.population ?? null, // tells a beach town from a seaside metropolis for the sticker
    }));
  } catch {
    return [];
  }
}

// OpenStreetMap kinds worth offering as "where this photo was taken".
const PHOTON_KEYS = new Set(['place', 'natural', 'tourism', 'historic', 'leisure', 'water', 'waterway', 'mountain_pass']);
const PHOTON_SKIP = new Set(['house', 'houses', 'plot', 'farm', 'isolated_dwelling', 'yes', 'information', 'hotel', 'hostel', 'motel', 'guest_house', 'apartment', 'camp_pitch', 'picnic_site', 'viewpoint_disused']);

async function photonSearch(q, near) {
  const bias = near ? `&lat=${near.lat.toFixed(3)}&lon=${near.lon.toFixed(3)}&zoom=10&location_bias_scale=0.3` : '';
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12&lang=en${bias}`);
    const { features = [] } = await res.json();
    return features
      .map(({ geometry, properties: p }) => ({ p, lat: geometry?.coordinates?.[1], lon: geometry?.coordinates?.[0] }))
      .filter(({ p, lat, lon }) => p.name && validCoords(lat, lon) && p.type !== 'street' && !PHOTON_SKIP.has(p.osm_value)
        && (PHOTON_KEYS.has(p.osm_key) || (p.osm_key === 'amenity' && p.osm_value === 'place_of_worship')
          || (p.osm_key === 'boundary' && p.osm_value === 'administrative')))
      .map(({ p, lat, lon }) => ({
        name: p.name,
        detail: [p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(', '),
        lat,
        lon,
        tz: null,
        pop: null,
      }));
  } catch {
    return [];
  }
}

const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameName = (a, b) => plain(a) === plain(b) || plain(a).startsWith(plain(b)) || plain(b).startsWith(plain(a));
function kmApart(a, b) {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(x, b.lat - a.lat) * 111.2;
}
