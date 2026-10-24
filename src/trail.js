// Where Aera has seen you, kept only on this device (localStorage, never uploaded).
// Android hides the GPS of every photo a website picks, so an imported photo borrows
// the place you were at around the time it was taken. Points are rounded to ~1 km and
// merged into stays: { from, to, lat, lon, name? }, one per place you spent time at.

import { validCoords } from './location.js';

const KEY = 'aera.trail';
const MAX_STAYS = 300;
const KEEP_MS = 365 * 86400e3;
const SAME_PLACE_KM = 3;      // closer than this is the same stay
const MERGE_GAP_MS = 6 * 3600e3;
const MATCH_MS = 3 * 3600e3;  // how far from a stay a photo may be and still borrow it

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}

function save(stays) {
  try { localStorage.setItem(KEY, JSON.stringify(stays)); } catch { /* storage blocked */ }
}

function km(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371;
}

// 0 inside the stay, else the time to its nearest end.
const gap = (s, t) => (t < s.from ? s.from - t : t > s.to ? t - s.to : 0);

/** Note that you were at `gps` at time `at`. `name` comes from a place you picked. */
export function recordPlace(gps, at = Date.now(), name = null) {
  const c = validCoords(gps?.lat, gps?.lon);
  const t = +at;
  if (!c || !Number.isFinite(t)) return;
  const p = { lat: +c.lat.toFixed(2), lon: +c.lon.toFixed(2) };
  const now = Date.now();
  const stays = load().filter((s) => now - s.to < KEEP_MS);
  const near = stays.find((s) => gap(s, t) <= MERGE_GAP_MS && km(s, p) < SAME_PLACE_KM);
  if (near) {
    near.from = Math.min(near.from, t);
    near.to = Math.max(near.to, t);
    if (name) near.name = name;
  } else {
    stays.push({ from: t, to: t, ...p, ...(name ? { name } : {}) });
  }
  stays.sort((a, b) => a.from - b.from);
  save(stays.slice(-MAX_STAYS));
}

/** @returns {{gps: {lat, lon}, name: string|null}|null} where you were around `at` */
export function placeAt(at) {
  const t = +at;
  if (!Number.isFinite(t)) return null;
  let best = null;
  for (const s of load()) {
    const d = gap(s, t);
    if (d <= MATCH_MS && (!best || d < best.d)) best = { d, s };
  }
  return best ? { gps: { lat: best.s.lat, lon: best.s.lon }, name: best.s.name ?? null } : null;
}
