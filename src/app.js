// Aera app: home → the phone's own camera (full-quality photo) → preview → share.
// The in-browser viewfinder was dropped: browsers only expose a video stream,
// never the phone's photo pipeline (HDR+, Night Sight…), so photos looked flat.
// Photos never leave the device; only rounded coordinates go to /api/air and /api/scene.

import { compose, coverCrop, ensureFonts, W, H } from './compose.js';
import { SCENES } from './scenes.js';
import { photoGps, photoTakenAt, fetchScene, fetchAir, locateMe, searchPlaces } from './location.js';
import { savePhoto, listPhotos, getPhoto, deletePhoto } from './gallery.js';

const HERE_TTL = 15 * 60e3; // re-locate if the last fix is older than this

// Websites can't write to the Photos library directly. On iOS the only route is the
// share sheet's "Save Image"; on Android a download lands in the phone's gallery.
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as a Mac
const IS_ANDROID = /Android/i.test(navigator.userAgent);

const $ = (id) => document.getElementById(id);
const fontsReady = ensureFonts(); // the first render waits for it
const canvas = $('canvas');

const state = {
  screen: 'home',
  here: null,          // Promise<{ gps, at, air: Promise, scene: Promise }>: prefetched before the shot
  shot: null,          // { id, img, src, focus, takenAt, utcOffsetMin, live, gps, placeName, air, detected, loading }
  scene: 'auto',       // 'auto' | SCENES key | null
  file: null,          // the exported JPEG, prepared ahead so Share stays inside the tap
  viewer: null,        // { id, file, url } for the gallery photo being viewed
};

const newId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ── Screens ──────────────────────────────────────────────────────────── */

function show(screen) {
  for (const id of ['home', 'preview', 'gallery', 'viewer']) $(id).hidden = id !== screen;
  if (screen !== 'preview') closeSheet();
  state.screen = screen;
}

function notify(text) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

// Home is the root. Preview, gallery and viewer push history entries, so the
// phone's back gesture walks back through them.
window.addEventListener('popstate', () => {
  const to = history.state?.aera;
  if (to === 'gallery') return openGallery({ push: false });
  if (to === 'viewer') return openViewer(history.state.id, { push: false });
  if (to === 'preview' && state.shot) return show('preview');
  show('home');
});

/* ── Camera (the phone's own) + location ──────────────────────────────── */

// Must run inside the tap: browsers only open the camera from a user gesture.
function openCamera() {
  notify('');
  locateHere(); // refresh if stale; usually already done on load
  $('capture').value = '';
  $('capture').click();
}

function pickPhoto() {
  notify('');
  $('file').value = '';
  $('file').click();
}

// Locate and prefetch air + scene, so the preview is ready when the photo arrives.
// Reuses a fresh fix; retries when the last attempt failed or went stale.
function locateHere(force = false) {
  const fresh = () => locateMe().then((gps) => ({
    gps,
    at: Date.now(),
    air: gps ? fetchAir(gps) : null,
    scene: gps ? fetchScene(gps).then((b) => b.scene ?? null) : null,
  }));
  const prev = state.here;
  state.here = !force && prev
    ? prev.then((h) => (h.gps && Date.now() - h.at <= HERE_TTL ? h : fresh()))
    : fresh();
  return state.here;
}

// A photo just taken with the camera: use where you are now, and the air now.
async function onCapture(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const shot = await openFile(f, { live: true });
  if (!shot) return;
  const [here, taken] = await Promise.all([locateHere(), photoTakenAt(f)]);
  if (taken) { shot.takenAt = taken.at; shot.utcOffsetMin = taken.utcOffsetMin; }
  if (here.gps) return loadPlace(shot, here.gps, here);
  loadPlace(shot, await photoGps(f)); // location off: fall back to the photo's own GPS, if any
}

// A photo from the camera roll: its own GPS, and the air at the hour it was taken.
async function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const shot = await openFile(f, { live: false });
  if (!shot) return;
  const [gps, taken] = await Promise.all([photoGps(f), photoTakenAt(f)]);
  if (taken) { shot.takenAt = taken.at; shot.utcOffsetMin = taken.utcOffsetMin; }
  loadPlace(shot, gps);
}

async function openFile(f, { live }) {
  const img = new Image();
  img.src = URL.createObjectURL(f);
  try {
    await img.decode();
  } catch {
    show('home');
    notify('That photo couldn’t be opened. Try a JPEG or PNG.');
    return null;
  }
  const shot = {
    id: newId(), img, src: workingCopy(img), focus: { x: 0.5, y: 0.5 },
    takenAt: new Date(live ? Date.now() : f.lastModified || Date.now()),
    live, gps: null, air: null, detected: null, loading: true,
  };
  openPreview(shot);
  return shot;
}

// Phone photos are 12+ MP; the story is 1080×1920. Scale once to just cover it, so
// redraws (dragging the crop) are fast and the export is pixel-identical.
function workingCopy(img) {
  let { iw, ih } = coverCrop(img);
  let scale = Math.max(W / iw, H / ih);
  if (scale >= 1) return img;
  let src = img;
  // Halve in steps for a clean downscale, then land on the exact cover size.
  while (scale < 0.5) {
    iw = Math.round(iw / 2); ih = Math.round(ih / 2); scale *= 2;
    src = drawTo(src, iw, ih);
  }
  return drawTo(src, Math.ceil(iw * scale), Math.ceil(ih * scale));
}

function drawTo(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/* ── Place → air + scene ──────────────────────────────────────────────── */

// Live shots use the air now; imported photos use the hour they were taken.
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
  // Imported from the gallery: replace that entry, so back from the preview goes home.
  if (history.state?.aera === 'gallery') history.replaceState({ aera: 'preview' }, '');
  else if (history.state?.aera !== 'preview') history.pushState({ aera: 'preview' }, '');
  show('preview');
  renderPlace();
  renderScenes();
  setupDrag(shot);
  fontsReady.finally(() => { if (state.shot === shot) render(); });
}

const effectiveScene = () => (state.scene === 'auto' ? state.shot?.detected ?? null : state.scene);

function draw() {
  const shot = state.shot;
  compose(canvas, { photo: shot.src, focus: shot.focus, scene: effectiveScene(), reading: readingFor(shot) });
}

function render() {
  draw();
  prepareFile();
}

function prepareFile() {
  state.file = null;
  $('save').disabled = true;
  hidePreviewImage();
  const shot = state.shot;
  if (shot.loading) return; // never share a half-loaded reading
  canvas.toBlob((blob) => {
    if (!blob || state.shot !== shot || shot.loading || dragging) return;
    const d = shot.takenAt, p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    state.file = new File([blob], `aera-${stamp}.jpg`, { type: 'image/jpeg' });
    $('save').disabled = false;
    // Every finished photo lands in the on-device gallery; later edits update the same entry.
    savePhoto({
      id: shot.id, createdAt: (shot.savedAt ??= new Date()), aqi: shot.air?.aqi ?? null, scene: effectiveScene(),
      canvas, blob, name: state.file.name,
    }).then(updateGalleryButton).catch(() => {});
    const share = canShareFile(state.file);
    $('save').textContent = share ? 'Share' : 'Download';
    $('download').hidden = !share; // with a share sheet, keep a one-tap "save to my photos" too
    showPreviewImage(blob);
  }, 'image/jpeg', 0.92);
}

// Show the finished JPEG as a real <img> over the canvas, so a long-press offers
// "Save to Photos" (iOS) / "Download image" (Android) like any photo on the web.
function showPreviewImage(blob) {
  const img = $('previewImg');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  img.hidden = false;
}

function hidePreviewImage() {
  $('previewImg').hidden = true;
}

/* ── Drag to frame: choose which part of the photo the 9:16 crop keeps ── */

const stack = $('stack');
let drag = null, dragging = false, drawQueued = false, hintTimer = 0;

function setupDrag(shot) {
  const { iw, ih, sw, sh } = coverCrop(shot.src);
  const movable = iw - sw >= 2 || ih - sh >= 2;
  stack.classList.toggle('draggable', movable);
  const hint = $('dragHint');
  clearTimeout(hintTimer);
  hint.hidden = !movable;
  hint.classList.remove('fade');
  if (movable) hintTimer = setTimeout(() => hint.classList.add('fade'), 2500);
}

stack.addEventListener('pointerdown', (e) => {
  const shot = state.shot;
  if (!shot || !stack.classList.contains('draggable')) return;
  const { iw, ih, sw, sh } = coverCrop(shot.src);
  drag = {
    id: e.pointerId, x: e.clientX, y: e.clientY, start: { ...shot.focus },
    slackX: iw - sw, slackY: ih - sh, srcPerCss: sw / stack.clientWidth,
  };
});

stack.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragging) {
    if (Math.hypot(dx, dy) < 6) return; // a tap or long-press (save), not a drag
    dragging = true;
    stack.classList.add('dragging');
    $('dragHint').classList.add('fade');
    hidePreviewImage(); // show the live canvas while the crop moves
    try { stack.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  }
  // Dragging the photo right reveals more of its left side, so the focus moves left.
  state.shot.focus = {
    x: drag.slackX >= 2 ? clamp01(drag.start.x - (dx * drag.srcPerCss) / drag.slackX) : 0.5,
    y: drag.slackY >= 2 ? clamp01(drag.start.y - (dy * drag.srcPerCss) / drag.slackY) : 0.5,
  };
  if (!drawQueued) {
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  if (!dragging) return;
  dragging = false;
  stack.classList.remove('dragging');
  render(); // final frame → JPEG → gallery
}
stack.addEventListener('pointerup', endDrag);
stack.addEventListener('pointercancel', endDrag);

/* ── Share / save ─────────────────────────────────────────────────────── */

const canShareFile = (file) => !!navigator.canShare?.({ files: [file] });

async function shareFile(file) {
  if (!file) return;
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the sheet
    }
  }
  downloadFile(file);
}

// The "save" icon: get the photo into the phone's own gallery with as few taps as the platform allows.
async function saveToDevice(file) {
  if (!file) return;
  if (IS_IOS && canShareFile(file)) {
    try { await navigator.share({ files: [file] }); } catch { /* closed the sheet */ }
    return;
  }
  downloadFile(file);
}

function downloadFile(file) {
  if (!file) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(IS_ANDROID ? 'Saved to your phone — it’s in your gallery under Downloads.' : 'Downloaded.');
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
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

/* ── Gallery + viewer ─────────────────────────────────────────────────── */

let gridUrls = [];

async function openGallery({ push = true } = {}) {
  if (push) history.pushState({ aera: 'gallery' }, '');
  show('gallery');
  let rows = [];
  try {
    rows = await listPhotos();
  } catch {
    $('galleryNote').textContent = 'This browser can’t keep photos here (private browsing?).';
  }
  gridUrls.forEach((u) => URL.revokeObjectURL(u));
  gridUrls = [];
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('grid').replaceChildren(...rows.map((r) => {
    const url = URL.createObjectURL(r.thumb);
    gridUrls.push(url);
    const li = document.createElement('li');
    const b = document.createElement('button');
    const img = document.createElement('img');
    img.src = url;
    img.alt = `${fmt.format(r.createdAt)}${r.aqi != null ? `, AQI ${r.aqi}` : ''}`;
    b.append(img);
    b.onclick = () => openViewer(r.id);
    li.append(b);
    return li;
  }));
  $('galleryEmpty').hidden = rows.length > 0;
  $('grid').hidden = rows.length === 0;
}

async function openViewer(id, { push = true } = {}) {
  if (push) history.pushState({ aera: 'viewer', id }, '');
  show('viewer');
  const row = await getPhoto(id).catch(() => null);
  if (!row) { history.back(); return; }
  if (state.viewer?.url) URL.revokeObjectURL(state.viewer.url);
  const file = new File([row.blob], row.name || 'aera.jpg', { type: 'image/jpeg' });
  state.viewer = { id, file, url: URL.createObjectURL(row.blob) };
  $('viewerImg').src = state.viewer.url;
  const share = canShareFile(file);
  $('viewerShare').textContent = share ? 'Share' : 'Download';
  $('viewerSave').hidden = !share;
}

async function removeViewed() {
  if (!state.viewer || !confirm('Delete this photo from Aera?')) return;
  await deletePhoto(state.viewer.id).catch(() => {});
  updateGalleryButton();
  history.back(); // back to the grid, which re-renders without it
}

// The home screen's gallery button shows your latest photo, like a phone camera.
async function updateGalleryButton() {
  const thumb = $('galleryThumb');
  try {
    const [latest] = await listPhotos();
    if (thumb.src) URL.revokeObjectURL(thumb.src);
    thumb.hidden = !latest;
    if (latest) thumb.src = URL.createObjectURL(latest.thumb);
    else thumb.removeAttribute('src');
  } catch {
    thumb.hidden = true;
  }
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

$('shutter').addEventListener('click', openCamera);
$('retake').addEventListener('click', openCamera); // the new photo replaces this one when it arrives
$('save').addEventListener('click', () => shareFile(state.file));
$('download').addEventListener('click', () => saveToDevice(state.file));
$('galleryBtn').addEventListener('click', () => openGallery());
$('viewerShare').addEventListener('click', () => shareFile(state.viewer?.file));
$('viewerSave').addEventListener('click', () => saveToDevice(state.viewer?.file));
for (const id of ['download', 'viewerSave']) $(id).setAttribute('aria-label', IS_IOS ? 'Save to Photos' : 'Save to your gallery');
$('viewerDelete').addEventListener('click', removeViewed);
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));
$('place').addEventListener('click', openSheet);
$('sheetClose').addEventListener('click', closeSheet);
$('capture').addEventListener('change', onCapture);
$('file').addEventListener('change', onFile);
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', pickPhoto));

// Ask for location as soon as Aera opens, so air + scene are ready when the photo comes back.
locateHere();
updateGalleryButton();
