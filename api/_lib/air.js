// Air quality for a place (and optionally a past moment), US AQI everywhere.
//
//  - Now: IQAir nearest-city reading (Community plan: 5 calls/min, 500/day), used
//    only when its city is close enough to honestly stand for the photo's place.
//  - Fallback, or when IQAir is unavailable/over its limit: Open-Meteo's CAMS model,
//    labelled "modeled".
//  - Past photos (EXIF time > 2 h ago): Open-Meteo's modeled value for that hour,
//    never today's reading.
//
// Results are cached in memory per warm instance; the endpoint also sets CDN headers.

const TIMEOUT = 6000;
const MAX_CITY_KM = 40;            // farther than this, a "city reading" would mislead
const MAX_READING_AGE_H = 6;       // stale IQAir readings fall back to the model
const PAST_AFTER_MS = 2 * 3600e3;  // older photos get the hour they were taken

const cache = new Map();

/**
 * @param {number} lat  rounded latitude
 * @param {number} lon  rounded longitude
 * @param {Date|null} at  when the photo was taken (null = now)
 * @returns {Promise<{aqi:number|null, pm25?:number|null, source:string, scope:string, updatedAt:string|null, historical?:boolean, place?:string}>}
 */
export async function getAir(lat, lon, at = null) {
  const past = at && Date.now() - at.getTime() > PAST_AFTER_MS;
  const hour = past ? at.toISOString().slice(0, 13) + ':00' : null;
  const key = `${lat},${lon},${hour ?? 'now'}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value;
  if (past) {
    value = await openMeteoHour(lat, lon, hour);
  } else {
    value = (await iqair(lat, lon).catch(() => null)) ?? (await openMeteoNow(lat, lon));
  }
  cache.set(key, { value, expires: Date.now() + (past ? 864e5 : 10 * 60e3) });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

export const isPast = (at) => !!at && Date.now() - at.getTime() > PAST_AFTER_MS;

async function iqair(lat, lon) {
  const k = process.env.IQAIR_API_KEY;
  if (!k) return null;
  const res = await fetch(
    `https://api.airvisual.com/v2/nearest_city?lat=${lat}&lon=${lon}&key=${encodeURIComponent(k)}`,
    { signal: AbortSignal.timeout(TIMEOUT) },
  );
  if (!res.ok) return null; // 429 over the minute/day limit, 4xx no coverage → model
  const { status, data } = await res.json();
  const p = data?.current?.pollution;
  if (status !== 'success' || !Number.isFinite(p?.aqius)) return null;

  const [cLon, cLat] = data.location?.coordinates ?? [];
  if (!(km(lat, lon, cLat, cLon) <= MAX_CITY_KM)) return null;
  if (!p.ts || Date.now() - Date.parse(p.ts) > MAX_READING_AGE_H * 3600e3) return null;

  return { aqi: p.aqius, pm25: null, source: 'IQAir', scope: 'city', updatedAt: p.ts, place: data.city };
}

async function openMeteoNow(lat, lon) {
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5&timezone=GMT`,
    { signal: AbortSignal.timeout(TIMEOUT) },
  );
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const { current } = await res.json();
  return {
    aqi: Number.isFinite(current?.us_aqi) ? current.us_aqi : null,
    pm25: Number.isFinite(current?.pm2_5) ? current.pm2_5 : null,
    source: 'Open-Meteo',
    scope: 'modeled',
    updatedAt: current?.time ? `${current.time}:00Z` : null,
  };
}

async function openMeteoHour(lat, lon, hour) {
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi&start_hour=${hour}&end_hour=${hour}&timezone=GMT`,
    { signal: AbortSignal.timeout(TIMEOUT) },
  );
  // Outside the model's archive (too old) the API errors: report "no reading", not today's air.
  const body = res.ok ? await res.json() : null;
  const aqi = body?.hourly?.us_aqi?.[0];
  return {
    aqi: Number.isFinite(aqi) ? aqi : null,
    pm25: null,
    source: 'Open-Meteo',
    scope: 'modeled',
    updatedAt: `${hour}:00Z`,
    historical: true,
  };
}

function km(lat1, lon1, lat2, lon2) {
  if (![lat2, lon2].every(Number.isFinite)) return Infinity;
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
