import { compose, ensureFonts } from './compose.js';
import { aqiDotColor } from './aqi.js';
import { SCENES } from './scenes.js';
import { photoGps, fetchScene } from './location.js';

// Illustrative readings that exercise the template: all three greens, every
// band, a two-line category, a modeled estimate and a no-data case.
const READINGS = [
  { id: 'reyk',   place: 'Reykjavík', region: 'Iceland', lat: 64.1466, lon: -21.9426, aqi: 9, pm25: 2.1, scope: 'city', timeZone: 'Atlantic/Reykjavik' },
  { id: 'sydney', place: 'Sydney', region: 'Australia', lat: -33.8688, lon: 151.2093, aqi: 24, pm25: 5.6, scope: 'city', timeZone: 'Australia/Sydney' },
  { id: 'seoul',  place: 'Seoul', region: 'South Korea', lat: 37.5665, lon: 126.978, aqi: 42, pm25: 9.8, scope: 'city', timeZone: 'Asia/Seoul' },
  { id: 'mexico', place: 'Mexico City', region: 'Mexico', lat: 19.4326, lon: -99.1332, aqi: 88, pm25: null, scope: 'city', timeZone: 'America/Mexico_City' },
  { id: 'la',     place: 'Los Angeles', region: 'California, United States', lat: 34.0522, lon: -118.2437, aqi: 128, pm25: 46.3, scope: 'modeled', timeZone: 'America/Los_Angeles' },
  { id: 'delhi',  place: 'Delhi', region: 'India', lat: 28.6139, lon: 77.209, aqi: 187, pm25: 118.4, scope: 'city', timeZone: 'Asia/Kolkata' },
  { id: 'hcmc',   place: 'Ho Chi Minh City', region: 'Vietnam', lat: 10.8231, lon: 106.6297, aqi: 312, pm25: null, scope: 'city', timeZone: 'Asia/Ho_Chi_Minh' },
  { id: 'none',   place: 'Longyearbyen', region: 'Svalbard, Norway', lat: 78.2232, lon: 15.6267, aqi: null, pm25: null, scope: 'city', timeZone: 'Arctic/Longyearbyen' },
].map((r) => ({ ...r, source: 'IQAir', sample: true }));

const state = {
  photos: [{ id: 'placeholder', label: 'Placeholder', img: null }],
  photoId: 'placeholder',
  readingId: 'reyk',
  scene: 'auto',      // 'auto' = detected from the photo's location, else a SCENES key or null
  takenAt: new Date(),
};

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');

const current = () => state.photos.find((p) => p.id === state.photoId);
const effectiveScene = () => (state.scene === 'auto' ? current()?.detected ?? null : state.scene);

function render() {
  const reading = READINGS.find((r) => r.id === state.readingId);
  compose(canvas, {
    photo: current()?.img ?? null,
    scene: effectiveScene(),
    reading: { ...reading, takenAt: state.takenAt, updatedAt: state.takenAt },
  });
}

function renderThumbs() {
  const el = $('thumbs');
  el.replaceChildren(...state.photos.map((p) => {
    const b = document.createElement('button');
    b.className = 'thumb' + (p.id === state.photoId ? ' on' : '');
    b.setAttribute('aria-label', p.label);
    b.setAttribute('aria-pressed', String(p.id === state.photoId));
    if (p.img) b.style.backgroundImage = `url("${p.img.src}")`;
    else b.classList.add('ph');
    b.onclick = () => { state.photoId = p.id; renderThumbs(); renderScenes(); render(); };
    return b;
  }));
}

function renderChips() {
  const el = $('readings');
  el.replaceChildren(...READINGS.map((r) => {
    const b = document.createElement('button');
    b.className = 'chip' + (r.id === state.readingId ? ' on' : '');
    b.setAttribute('aria-pressed', String(r.id === state.readingId));
    const dot = aqiDotColor(r.aqi);
    b.innerHTML = `${dot ? `<i class="dot" style="background:${dot}"></i>` : ''}<span>${r.place}</span><b>${r.aqi ?? '—'}</b>`;
    b.onclick = () => { state.readingId = r.id; renderChips(); render(); };
    return b;
  }));
}

// Single-choice chip row bound to a state key.
function renderPicker(elId, key, options, onPick = () => {}) {
  $(elId).replaceChildren(...options.map(([value, label]) => {
    const b = document.createElement('button');
    const on = state[key] === value;
    b.className = 'chip' + (on ? ' on' : '');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = label;
    b.onclick = async () => {
      state[key] = value;
      await onPick(value);
      if (elId === 'scenes') renderScenes(); else renderPicker(elId, key, options, onPick);
      render();
    };
    return b;
  }));
}

function loadImage(src, label) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ id: `${label}-${Math.random().toString(36).slice(2, 7)}`, label, img });
    img.onerror = reject;
    img.src = src;
  });
}

async function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  const loaded = await Promise.allSettled(images.map((f) => loadImage(URL.createObjectURL(f), f.name)));
  const ok = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (loaded.length > ok.length) alert('Some images could not be read by this browser (HEIC on desktop, for example).');
  if (!ok.length) return;
  state.photos.push(...ok);
  state.photoId = ok[0].id;
  renderThumbs();
  renderScenes();
  render();
  ok.forEach(detect);
}

// EXIF GPS → /api/scene. Results live on the photo so switching photos is instant.
async function detect(p) {
  if (!p.img) return;
  p.detecting = true;
  try {
    p.gps = await photoGps(p.img.src);
    if (!p.gps) return;
    const body = await fetchScene(p.gps);
    p.detected = body.scene ?? null;
    p.signals = body.signals ?? null;
  } catch {
    p.detected = null;
  } finally {
    p.detecting = false;
    if (p.id === state.photoId) { renderScenes(); render(); }
  }
}

function autoLabel(p) {
  if (!p?.img) return 'Auto';
  if (p.detecting) return 'Auto · detecting…';
  if (!p.gps) return 'Auto · no location';
  return `Auto · ${SCENES[p.detected]?.label ?? 'unknown'}`;
}

function renderScenes() {
  const p = current();
  renderPicker('scenes', 'scene', [['auto', autoLabel(p)], ...Object.entries(SCENES).map(([id, s]) => [id, s.label]), [null, 'None']]);
  const hint = $('sceneHint');
  if (!p?.img) hint.textContent = 'Pick a photo to detect its scene.';
  else if (p.detecting) hint.textContent = 'Reading the photo’s location…';
  else if (!p.gps) hint.textContent = 'This photo has no GPS location, so Auto adds no glyph. Pick a scene by hand.';
  else if (!p.detected) hint.textContent = 'Map data was unavailable for this location. Pick a scene by hand.';
  else {
    const s = p.signals ?? {};
    const km = (m) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
    hint.textContent = `From ${p.gps.lat.toFixed(3)}, ${p.gps.lon.toFixed(3)}: sea ${km(s.oceanM)}, beach ${km(s.beachM)}, `
      + `city ${s.cityKm == null ? '—' : `${Math.round(s.cityKm)} km`}, ${s.pois} places, ${s.tall} tall bldgs, `
      + `relief ${s.relief ?? '—'} m${s.inWood ? ', in woods' : ''}.`;
  }
}

async function loadSamples() {
  try {
    const res = await fetch('samples/samples.json', { cache: 'no-store' });
    if (!res.ok) return;
    const names = await res.json();
    const loaded = await Promise.allSettled(names.map((n) => loadImage(`samples/${n}`, n)));
    const ok = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) return;
    state.photos.push(...ok);
    state.photoId = ok[0].id;
    ok.forEach(detect);
  } catch { /* no samples yet: placeholder only */ }
}

function download() {
  const reading = READINGS.find((r) => r.id === state.readingId);
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aera-${reading.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

$('file').addEventListener('change', (e) => addFiles(e.target.files));
$('download').addEventListener('click', download);
$('safeToggle').addEventListener('change', (e) => { $('safe').hidden = !e.target.checked; });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });

await ensureFonts();
await loadSamples();
renderThumbs();
renderChips();
renderScenes();
render();
