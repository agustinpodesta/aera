// Aera app: the link opens straight into the camera → shoot → preview → share.
// The start screen is only a fallback when the camera can't start.
// Photos never leave the device; only rounded coordinates go to /api/air and /api/scene.

import { compose, ensureFonts } from './compose.js';
import { SCENES } from './scenes.js';
import { startCamera, stopCamera, captureFrame } from './camera.js';
import { photoGps, photoTakenAt, fetchScene, fetchAir, locateMe, searchPlaces } from './location.js';

const HERE_TTL = 15 * 60e3; // re-locate if the camera has been open longer than this

const $ = (id) => document.getElementById(id);
const fontsReady = ensureFonts(); // loads alongside the camera; the first render waits for it
const video = $('video');
const canvas = $('canvas');

const state = {
  screen: 'camera',
  mirrored: false,
  here: null,          // Promise<{ gps, at, air: Promise, scene: Promise }>: prefetched while framing
  shot: null,          // { img, takenAt, utcOffsetMin, live, gps, placeName, air, detected, loading }
  scene: 'auto',       // 'auto' | SCENES key | null
  file: null,          // the exported JPEG, prepared ahead so Share stays inside the tap
};

/* ── Screens ──────────────────────────────────────────────────────────── */

function show(screen) {
  for (const id of ['start', 'camera', 'preview']) $(id).hidden = id !== screen;
  if (screen !== 'camera') stopCamera(video);
  if (screen !== 'preview') closeSheet();
  state.screen = screen;
}

function notify(text) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

// The preview pushes a history entry, so Android back / browser back means "retake".
window.addEventListener('popstate', () => { if (state.screen === 'preview') openCamera(); });

/* ── Camera ───────────────────────────────────────────────────────────── */

async function openCamera() {
  notify('');
  show('camera');
  $('camera').classList.remove('live');
  try {
    const { mirrored } = await startCamera(video);
    state.mirrored = mirrored;
    video.classList.toggle('mirrored', mirrored);
    $('camera').classList.add('live');
    locateHere(); // ask for location while the user frames the shot
  } catch (err) {
    show('start');
    notify(cameraError(err));
  }
}

function cameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError': return 'Camera access is blocked. Allow it in your browser settings, or choose a photo instead.';
    case 'NotFoundError':
    case 'OverconstrainedError': return 'No camera found on this device. You can choose a photo instead.';
    case 'NotReadableError': return 'Another app is using the camera. Close it and try again, or choose a photo.';
    case 'NotSupportedError': return 'This browser can’t open the camera here. Choose a photo instead.';
    default: return 'The camera couldn’t start. Choose a photo instead.';
  }
}

// Locate once and prefetch air + scene, so the preview is usually instant.
function locateHere(force = false) {
  if (!force && state.here) return state.here;
  state.here = locateMe().then((gps) => ({
    gps,
    at: Date.now(),
    air: gps ? fetchAir(gps) : null,
    scene: gps ? fetchScene(gps).then((b) => b.scene ?? null) : null,
  }));
  return state.here;
}

async function takePhoto() {
  if (!video.videoWidth) return;
  const img = captureFrame(video, state.mirrored);
  stopCamera(video);
  const shot = { img, takenAt: new Date(), live: true, gps: null, air: null, detected: null, loading: true };
  openPreview(shot);
  let here = await locateHere();
  if (Date.now() - here.at > HERE_TTL) here = await locateHere(true);
  loadPlace(shot, here.gps, here);
}

// Release the camera when the tab is hidden; reopen it when the user comes back.
document.addEventListener('visibilitychange', () => {
  if (state.screen !== 'camera') return;
  if (document.hidden) stopCamera(video);
  else openCamera();
});

/* ── Photo upload fallback ────────────────────────────────────────────── */

function pickPhoto() {
  $('file').value = '';
  $('file').click();
}

async function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const img = new Image();
  img.onload = async () => {
    const shot = { img, takenAt: new Date(f.lastModified || Date.now()), live: false, gps: null, air: null, detected: null, loading: true };
    openPreview(shot);
    const [gps, taken] = await Promise.all([photoGps(f), photoTakenAt(f)]);
    if (taken) { shot.takenAt = taken.at; shot.utcOffsetMin = taken.utcOffsetMin; }
    loadPlace(shot, gps);
  };
  img.onerror = () => { show('start'); notify('That photo couldn’t be opened. Try a JPEG or PNG.'); };
  img.src = URL.createObjectURL(f);
}

/* ── Place → air + scene ──────────────────────────────────────────────── */

// Live shots use the air now; uploaded photos use the hour they were taken.
async function loadPlace(shot, gps, pre = {}) {
  shot.gps = gps;
  shot.air = null;
  shot.detected = null;
  shot.loading = !!gps;
  refresh(shot);
  if (!gps) return; // no location: the preview asks for one
  const at = shot.live ? null : shot.takenAt;
  const [air, scene] = await Promise.all([
    pre.air ?? fetchAir(gps, at),
    pre.scene ?? fetchScene(gps).then((b) => b.scene ?? null),
  ]);
  if (shot.gps !== gps) return; // a different place was picked meanwhile
  Object.assign(shot, { air, detected: scene, loading: false });
  refresh(shot);
}

const refresh = (shot) => { if (state.shot === shot) { renderPlace(); renderScenes(); render(); } };

function readingFor(shot) {
  const base = { takenAt: shot.takenAt, updatedAt: shot.takenAt, utcOffsetMin: shot.utcOffsetMin ?? null };
  if (shot.loading) return { ...base, aqi: null, pending: true };
  if (!shot.air) return { ...base, aqi: null };
  return { ...base, ...shot.air };
}

/* ── Preview + export ─────────────────────────────────────────────────── */

function openPreview(shot) {
  state.shot = shot;
  state.scene = 'auto';
  if (history.state?.aera !== 'preview') history.pushState({ aera: 'preview' }, '');
  show('preview');
  renderPlace();
  renderScenes();
  fontsReady.finally(() => { if (state.shot === shot) render(); });
}

const effectiveScene = () => (state.scene === 'auto' ? state.shot?.detected ?? null : state.scene);

function render() {
  const shot = state.shot;
  compose(canvas, { photo: shot.img, scene: effectiveScene(), reading: readingFor(shot) });
  prepareFile();
}

function prepareFile() {
  state.file = null;
  $('save').disabled = true;
  const shot = state.shot;
  if (shot.loading) return; // never share a half-loaded reading
  canvas.toBlob((blob) => {
    if (!blob || state.shot !== shot || shot.loading) return;
    const d = shot.takenAt, p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    state.file = new File([blob], `aera-${stamp}.jpg`, { type: 'image/jpeg' });
    $('save').disabled = false;
    const share = canShareFile(state.file);
    $('save').textContent = share ? 'Share' : 'Download';
    $('download').hidden = !share; // with a share sheet, keep a quiet way to just save the file
  }, 'image/jpeg', 0.92);
}

const canShareFile = (file) => !!navigator.canShare?.({ files: [file] });

async function save() {
  const file = state.file;
  if (!file) return;
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the sheet
    }
  }
  download();
}

function download() {
  const file = state.file;
  if (!file) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// One line under the photo: what the reading is, and a way to change the place.
function renderPlace() {
  const shot = state.shot, el = $('place');
  el.classList.toggle('ask', !shot.gps && !shot.loading);
  if (shot.loading) { el.textContent = 'Reading the air…'; return; }
  if (!shot.gps) { el.textContent = 'Add where this was taken'; return; }
  const air = shot.air;
  const where = shot.placeName ?? air?.place ?? (shot.live ? 'Here' : 'Photo location');
  const what = !air ? 'air data unavailable'
    : air.aqi == null ? 'no reading for that time'
    : air.scope === 'modeled' ? `${air.source}, modeled` : air.source;
  el.textContent = `${where} · ${what}`;
}

function renderScenes() {
  const shot = state.shot;
  const auto = shot?.loading ? 'Auto · …' : shot?.detected ? `Auto · ${SCENES[shot.detected].label}` : 'Auto · none';
  const options = [['auto', auto], ...Object.entries(SCENES).map(([id, s]) => [id, s.label]), [null, 'None']];
  $('scenes').replaceChildren(...options.map(([value, label]) => {
    const b = document.createElement('button');
    const on = state.scene === value;
    b.className = 'chip' + (on ? ' on' : '');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = label;
    b.onclick = () => { state.scene = value; renderScenes(); render(); };
    return b;
  }));
}

/* ── Place sheet (manual location) ────────────────────────────────────── */

let searchTimer = 0;

function openSheet() {
  $('sheet').hidden = false;
  $('placeQuery').value = '';
  renderResults([]);
  setTimeout(() => $('placeQuery').focus(), 50);
}

function closeSheet() {
  $('sheet').hidden = true;
}

function renderResults(places) {
  const items = [];
  if (navigator.geolocation) items.push({ name: 'Use my current location', detail: '', here: true });
  items.push(...places);
  $('placeResults').replaceChildren(...items.map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'result' + (p.here ? ' here' : '');
    b.innerHTML = '<span></span><small></small>';
    b.querySelector('span').textContent = p.name;
    b.querySelector('small').textContent = p.detail;
    b.onclick = () => choosePlace(p);
    li.append(b);
    return li;
  }));
}

async function choosePlace(p) {
  closeSheet();
  const shot = state.shot;
  if (!p.here) {
    shot.placeName = p.name;
    loadPlace(shot, { lat: p.lat, lon: p.lon });
    return;
  }
  shot.placeName = null;
  shot.loading = true;
  refresh(shot);
  const here = await locateHere(true);
  if (!here.gps) {
    shot.loading = false;
    refresh(shot);
    $('place').textContent = 'Location is off. Search a city instead.';
    return;
  }
  loadPlace(shot, here.gps, shot.live ? here : {});
}

$('placeQuery').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(async () => {
    const places = await searchPlaces(q);
    if ($('placeQuery').value === q) renderResults(places);
  }, 250);
});
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ── Wiring ───────────────────────────────────────────────────────────── */

$('openCamera').addEventListener('click', openCamera);
$('shutter').addEventListener('click', takePhoto);
$('retake').addEventListener('click', () => (history.state?.aera === 'preview' ? history.back() : openCamera()));
$('save').addEventListener('click', save);
$('download').addEventListener('click', download);
$('place').addEventListener('click', openSheet);
$('sheetClose').addEventListener('click', closeSheet);
$('file').addEventListener('change', onFile);
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', pickPhoto));

// Straight into the camera: the browser's permission prompt is the only step.
openCamera();
