// Scene detection from a photo's location — no photo leaves the device.
//
// Signals come from two free, keyless sources:
//  - OpenFreeMap vector tiles (OpenStreetMap data, OpenMapTiles schema): at z14,
//    ocean polygons, beaches, woods/ice/rock, building heights, POIs, land use; at z10,
//    whether a city-class place sits nearby.
//  - Open-Meteo elevation (90 m DEM) at the photo, against named peaks within 6 km.
// Building *counts* are not used: OSM footprint coverage varies too much by country.
// classifyScene() turns those signals into one of the scenes in src/scenes.js.

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';

const UA = 'aera/0.1 (+https://aeracam.com)';
const Z = 14;
const EARTH = 40075016.686; // metres around the equator
const NEAR = 250;           // radius for buildings / POIs
const CITY_Z = 10;          // zoom whose place layer carries city labels
const CITY_KM = 12;         // a city label this close means "in a city"
const CITY_CORE_KM = 5;     // …and this close, near its centre
const PEAK_Z = 12;          // zoom used to find named peaks
const PEAK_KM = 6;          // peaks this close count towards relief
const COAST = 600;          // radius we look for sea and beaches

let tileTemplate = null;

async function getTileTemplate() {
  if (tileTemplate) return tileTemplate;
  const res = await fetch('https://tiles.openfreemap.org/planet', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`tilejson ${res.status}`);
  tileTemplate = (await res.json()).tiles[0];
  return tileTemplate;
}

async function fetchTile(x, y, z = Z) {
  const url = (await getTileTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 204 || res.status === 404) return null; // open ocean / empty tile
  if (!res.ok) throw new Error(`tile ${res.status}`);
  return new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
}

// Global fractional tile coordinates at zoom z.
function toTile(lat, lon, z = Z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/* ── Geometry in local metres around the photo ────────────────────────── */

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Distance from the origin to a polygon (0 when inside). Even-odd over all rings,
// so holes and multipolygons work without classifying rings.
function polyDist(rings) {
  let inside = false, best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[j];
      if ((ay > 0) !== (by > 0) && 0 < ((bx - ax) * (0 - ay)) / (by - ay) + ax) inside = !inside;
      best = Math.min(best, segDist(0, 0, ax, ay, bx, by));
    }
  }
  return inside ? 0 : best;
}

/* ── Signals ──────────────────────────────────────────────────────────── */

export async function fetchSignals(lat, lon) {
  const [gx, gy] = toTile(lat, lon);
  const mPerUnit = (EARTH * Math.cos((lat * Math.PI) / 180)) / 2 ** Z; // metres per tile width
  const r = COAST / mPerUnit;
  const tiles = [];
  for (let x = Math.floor(gx - r); x <= Math.floor(gx + r); x++)
    for (let y = Math.floor(gy - r); y <= Math.floor(gy + r); y++) tiles.push([x, y]);

  const [loaded, relief, { cityKm, placeName }] = await Promise.all([
    Promise.all(tiles.map(([x, y]) => fetchTile(x, y).then((t) => [x, y, t]))),
    fetchRelief(lat, lon),
    nearestPlaces(lat, lon),
  ]);

  const s = {
    oceanM: Infinity, beachM: Infinity, inWood: false, inIceOrRock: false, inPark: false,
    tall: 0, pois: 0, landuse: null, cityKm, placeName, ...relief,
  };
  const seenPoi = new Set();

  for (const [tx, ty, tile] of loaded) {
    if (!tile) { if (tx === Math.floor(gx) && ty === Math.floor(gy)) s.oceanM = 0; continue; }
    const each = (layerName, fn) => {
      const layer = tile.layers[layerName];
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const rings = f.loadGeometry().map((ring) =>
          ring.map((p) => [(tx + p.x / f.extent - gx) * mPerUnit, (ty + p.y / f.extent - gy) * mPerUnit]));
        fn(f, rings);
      }
    };

    each('water', (f, rings) => {
      if (f.properties.class === 'ocean') s.oceanM = Math.min(s.oceanM, polyDist(rings));
    });
    each('landcover', (f, rings) => {
      const { class: c, subclass: sub } = f.properties;
      if (c === 'sand' && sub === 'beach') s.beachM = Math.min(s.beachM, polyDist(rings));
      else if (c === 'wood' && polyDist(rings) === 0) s.inWood = true;
      else if ((c === 'ice' || c === 'rock') && polyDist(rings) <= 100) s.inIceOrRock = true;
    });
    each('park', (f, rings) => { if (f.type === 3 && polyDist(rings) === 0) s.inPark = true; });
    each('landuse', (f, rings) => {
      if (!s.landuse && f.type === 3 && polyDist(rings) === 0) s.landuse = f.properties.class;
    });
    // Count only buildings whose tile owns their centroid, so edge buildings aren't double-counted.
    // Tall buildings (≥ 25 m) nearby; each counted only in the tile owning its centroid.
    each('building', (f, rings) => {
      if ((f.properties.render_height ?? 0) < 25) return;
      const ring = rings[0];
      const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      if (Math.floor(gx + c[0] / mPerUnit) !== tx || Math.floor(gy + c[1] / mPerUnit) !== ty) return;
      if (Math.hypot(c[0], c[1]) <= NEAR) s.tall++;
    });
    each('poi', (f, rings) => {
      const [x, y] = rings[0][0];
      if (Math.hypot(x, y) > NEAR) return;
      const key = f.id ?? `${Math.round(x)}:${Math.round(y)}:${f.properties.name}`;
      if (seenPoi.has(key)) return;
      seenPoi.add(key);
      s.pois++;
    });
  }
  return s;
}

// From the z10 place labels around the point: the distance (km) to the nearest city
// (for the scene) and the name of the nearest city or town (shown as the place, e.g.
// "Suwon", instead of a vague "here"). English or Latin-script names first.
const NAME_KM = 25;
const labelName = (p) => p['name:en'] || p.name_en || p['name:latin'] || p.name_int || p.name || null;

async function nearestPlaces(lat, lon) {
  try {
    const [gx, gy] = toTile(lat, lon, CITY_Z);
    const tile = await fetchTile(Math.floor(gx), Math.floor(gy), CITY_Z);
    const layer = tile?.layers.place;
    if (!layer) return { cityKm: null, placeName: null };
    const kmPerUnit = (EARTH * Math.cos((lat * Math.PI) / 180)) / 2 ** CITY_Z / 1000;
    let cityKm = Infinity, named = { km: Infinity, name: null };
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const cls = f.properties.class;
      if (cls !== 'city' && cls !== 'town') continue;
      const p = f.loadGeometry()[0][0];
      const dx = (Math.floor(gx) + p.x / f.extent - gx) * kmPerUnit;
      const dy = (Math.floor(gy) + p.y / f.extent - gy) * kmPerUnit;
      const km = Math.hypot(dx, dy);
      if (cls === 'city') cityKm = Math.min(cityKm, km);
      const name = labelName(f.properties);
      if (name && km < named.km && km <= NAME_KM) named = { km, name };
    }
    return { cityKm, placeName: named.name };
  } catch {
    return { cityKm: null, placeName: null };
  }
}

// Relief = highest named peak within PEAK_KM minus the photo's own elevation.
// One Open-Meteo point per photo (it bills per point); peaks come from z12 tiles.
async function fetchRelief(lat, lon) {
  const [elevation, peak] = await Promise.all([pointElevation(lat, lon), highestPeak(lat, lon)]);
  if (elevation == null) return { elevation: null, relief: null };
  return { elevation, relief: peak == null ? 0 : Math.max(0, peak - elevation) };
}

async function pointElevation(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { headers: { 'User-Agent': UA } });
    const { elevation } = await res.json();
    return Number.isFinite(elevation?.[0]) ? Math.max(0, Math.round(elevation[0])) : null;
  } catch {
    return null;
  }
}

async function highestPeak(lat, lon) {
  const [gx, gy] = toTile(lat, lon, PEAK_Z);
  const mPerUnit = (EARTH * Math.cos((lat * Math.PI) / 180)) / 2 ** PEAK_Z;
  const r = (PEAK_KM * 1000) / mPerUnit;
  const jobs = [];
  for (let x = Math.floor(gx - r); x <= Math.floor(gx + r); x++)
    for (let y = Math.floor(gy - r); y <= Math.floor(gy + r); y++)
      jobs.push(fetchTile(x, y, PEAK_Z).then((t) => [x, y, t]).catch(() => [x, y, null]));
  let best = null;
  for (const [x, y, tile] of await Promise.all(jobs)) {
    const layer = tile?.layers.mountain_peak;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const ele = Number(f.properties.ele);
      if (!Number.isFinite(ele)) continue;
      const p = f.loadGeometry()[0][0];
      const d = Math.hypot((x + p.x / f.extent - gx) * mPerUnit, (y + p.y / f.extent - gy) * mPerUnit);
      if (d <= PEAK_KM * 1000 && (best == null || ele > best)) best = ele;
    }
  }
  return best;
}

/* ── Classification ───────────────────────────────────────────────────── */

const SETTLED = ['residential', 'suburb', 'neighbourhood', 'quarter', 'commercial', 'retail'];

// Order matters: a beach beats everything; a city beats nearby hills and street
// trees; standing in real woods beats moderate hills. Busy tourist villages (many
// POIs, no city nearby) fall through to mountains/neighborhood rather than city.
export function classifyScene(s) {
  const inCity = s.cityKm != null && s.cityKm <= CITY_KM;
  const cityCore = s.cityKm != null && s.cityKm <= CITY_CORE_KM; // historic centres are low-rise, POI-light
  // A town up in the hills (≥ 300 m, ground rising ≥ 400 m more nearby, no tall buildings)
  // is a mountain place even with a small city nearby and lots of POIs: Fujikawaguchiko,
  // Nachi's Seiganto-ji. Hilly lowland cities (Seoul, Suwon) sit below 300 m.
  const highland = s.elevation >= 300 && s.relief >= 400 && s.tall < 5;
  const downtown = s.tall >= 5 || (!highland && ((inCity && s.pois >= 40) || (cityCore && s.pois >= 15)));
  const alpine = s.inIceOrRock || s.relief >= 900;

  if (s.beachM <= 400 || (s.oceanM <= 350 && !downtown)) return 'coast';
  if (downtown) return 'city';
  if (s.inWood && !alpine && s.pois < 10) return 'forest';
  // Many cities sit among hills (Seoul, Suwon): inside one, only big relief counts.
  if (alpine || highland || s.relief >= (inCity ? 600 : 400) || (s.elevation >= 1500 && s.relief >= 200)) return 'mountains';
  if (s.pois >= 10 || SETTLED.includes(s.landuse)) return 'neighborhood';
  return 'countryside';
}

export async function detectScene(lat, lon) {
  const signals = await fetchSignals(lat, lon);
  return { scene: classifyScene(signals), place: signals.placeName ?? null, signals };
}
