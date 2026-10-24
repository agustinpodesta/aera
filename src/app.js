// Aera app: home → the phone's own camera (full-quality photo) → preview → share.
// The in-browser viewfinder was dropped: browsers only expose a video stream,
// never the phone's photo pipeline (HDR+, Night Sight…), so photos looked flat.
// Photos never leave the device; only rounded coordinates go to /api/air and /api/scene.

import { compose, coverCrop, ensureFonts, W, H, STRIP_HOME } from './compose.js';
import { SCENES } from './scenes.js';
import { photoGps, photoTakenAt, fetchScene, fetchAir, locateMe, searchPlaces } from './location.js';
import { savePhoto, listPhotos, getPhoto, deletePhoto } from './gallery.js';

const HERE_TTL = 15 * 60e3; // re-locate if the last fix is older than this
const MAX_SCALE = 2;        // export up to 2160×3840 (8 MP) when the photo has the detail for it
const RECENT_MS = 60 * 60e3; // older photos get TIME = now, since their reading is the air now

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
  shot: null,          // { id, img, src, scale, focus, takenAt, utcOffsetMin, live, gps, placeName, air, detected, loading }
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
  if (here.gps) return loadPlace(shot, here.gps, here, 'here');
  const gps = await photoGps(f); // location off: fall back to the photo's own GPS, if any
  loadPlace(shot, gps, {}, gps ? 'photo' : null);
}

// A photo from the camera roll: the place comes from its own GPS, the air is the air
// there *now* (no reliable historical source). For an old photo the strip's TIME
// becomes now too, so the report never claims to be from the day the photo was taken.
// No GPS in the file (location was off, or the picker stripped it) → your current
// place, flagged in the preview so you can change it.
async function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const shot = await openFile(f, { live: true });
  if (!shot) return;
  const [gps, taken] = await Promise.all([photoGps(f), photoTakenAt(f)]);
  if (taken) { shot.takenAt = taken.at; shot.utcOffsetMin = taken.utcOffsetMin; }
  if (Date.now() - shot.takenAt.getTime() > RECENT_MS) shot.reportAt = new Date();
  if (gps) return loadPlace(shot, gps, {}, 'photo');
  const here = await locateHere();
  loadPlace(shot, here.gps, here, here.gps ? 'here' : null);
}

async function openFile(f, { live }) {
  const img = new Image();
  try {
    // The load event, not img.decode(): decode() can wait for a painted frame, which never
    // comes while the page is in the background (e.g. returning from the camera app).
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = URL.createObjectURL(f);
    });
  } catch {
    show('home');
    notify('That photo couldn’t be opened. Try a JPEG or PNG.');
    return null;
  }
  const scale = exportScale(img);
  const shot = {
    id: newId(), img, src: workingCopy(img, scale), scale, focus: { x: 0.5, y: 0.5 }, strip: { ...STRIP_HOME },
    takenAt: new Date(live ? Date.now() : f.lastModified || Date.now()),
    live, gps: null, air: null, detected: null, loading: true,
  };
  openPreview(shot);
  return shot;
}

// Export as sharp as the photo allows: a 12 MP phone photo's 9:16 crop is ~2300 px wide,
// so it exports at 2160×3840; small images stay at 1080×1920 (Instagram's Story size).
function exportScale(img) {
  const { sw } = coverCrop(img);
  return Math.max(1, Math.min(MAX_SCALE, Math.floor((sw / W) * 4) / 4));
}

// Scale the photo once to just cover the export size, so redraws (dragging the crop)
// are fast and the export is pixel-identical.
function workingCopy(img, k) {
  let { iw, ih } = coverCrop(img);
  let scale = Math.max((W * k) / iw, (H * k) / ih);
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
async function loadPlace(shot, gps, pre = {}, source = null) {
  shot.gps = gps;
  shot.gpsSource = gps ? source : null; // 'photo' | 'here' | 'search'
  shot.air = null;
  shot.detected = null;
  shot.loading = !!gps;
  refresh(shot);
  if (!gps) return; // no location: the preview asks for one
  const at = shot.live ? null : shot.takenAt;
  let [air, scene] = await Promise.all([
    pre.air ?? fetchAir(gps, at),
    pre.scene ?? fetchScene(gps).then((b) => b.scene ?? null),
  ]);
  // One retry before showing "no reading": the air services occasionally rate-limit or time out.
  if (!air && shot.gps === gps) air = await new Promise((r) => setTimeout(r, 800)).then(() => fetchAir(gps, at));
  if (shot.gps !== gps) return; // a different place was picked meanwhile
  Object.assign(shot, { air, detected: scene, loading: false });
  refresh(shot);
}

const refresh = (shot) => { if (state.shot === shot) { renderPlace(); renderScenes(); render(); } };

function readingFor(shot) {
  // Old photos report the air now, so TIME is now (device clock), not the photo's time.
  const at = shot.reportAt ?? shot.takenAt;
  const base = { takenAt: at, updatedAt: at, utcOffsetMin: shot.reportAt ? null : shot.utcOffsetMin ?? null };
  if (shot.loading) return { ...base, aqi: null, pending: true };
  if (!shot.air) return { ...base, aqi: null };
  return { ...base, ...shot.air };
}

/* ── Preview + export ─────────────────────────────────────────────────── */

function openPreview(shot) {
  state.shot = shot;
  state.scene = 'auto';
  setScenePicker(false);
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

// While dragging, draw at 1080×1920 to keep it smooth; everything else at full export size.
function draw() {
  const shot = state.shot;
  shot.stripBox = compose(canvas, {
    photo: shot.src, focus: shot.focus, strip: shot.strip, scale: dragging ? 1 : shot.scale,
    scene: effectiveScene(), reading: readingFor(shot),
  });
  shot.strip = { cx: shot.stripBox.cx, bottom: shot.stripBox.bottom, scale: shot.stripBox.scale }; // keep the clamped spot
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

/* ── Drag: the strip moves where you put it; anywhere else reframes the photo ── */

const stack = $('stack');
const GRAB = 36; // extra grab margin around the strip, in 1080-wide layout units
let drag = null, dragging = false, drawQueued = false, hintTimer = 0;

function setupDrag(shot) {
  const { iw, ih, sw, sh } = coverCrop(shot.src);
  const photoMovable = iw - sw >= 2 || ih - sh >= 2;
  stack.classList.add('draggable'); // the strip can always move
  const hint = $('dragHint');
  hint.textContent = photoMovable ? 'Drag or pinch the strip · drag the photo' : 'Drag or pinch the strip';
  clearTimeout(hintTimer);
  hint.hidden = false;
  hint.classList.remove('fade');
  hintTimer = setTimeout(() => hint.classList.add('fade'), 3000);
}

// Pointer position in the 1080×1920 layout space the template draws in.
function toLayout(e) {
  const r = stack.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

const pointers = new Map(); // live touches on the preview: id → {x, y}

function onStripAt(p) {
  const box = state.shot?.stripBox;
  return !!box && p.x >= box.left - GRAB && p.x <= box.right + GRAB && p.y >= box.top - GRAB && p.y <= box.bottom + GRAB;
}

function beginDragging(e) {
  dragging = true;
  stack.classList.add('dragging');
  $('dragHint').classList.add('fade');
  hidePreviewImage(); // show the live canvas while things move
  try { stack.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
}

function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

stack.addEventListener('pointerdown', (e) => {
  const shot = state.shot;
  if (!shot) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // Second finger on the strip: pinch to resize (and move), like an Instagram sticker.
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (drag?.mode === 'strip' || onStripAt(toLayout({ clientX: mid.x, clientY: mid.y }))) {
      const box = shot.stripBox;
      drag = {
        mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid, layoutPerCss: W / stack.clientWidth,
        scale: box.scale, cx: box.cx, cy: (box.top + box.bottom) / 2, unitH: (box.bottom - box.top) / box.scale,
      };
      if (!dragging) beginDragging(e);
    }
    return;
  }
  if (pointers.size > 2) return;

  const p = toLayout(e), box = shot.stripBox;
  const { iw, ih, sw, sh } = coverCrop(shot.src);
  drag = {
    id: e.pointerId, x: e.clientX, y: e.clientY, mode: onStripAt(p) ? 'strip' : 'photo',
    focus: { ...shot.focus }, strip: { cx: box?.cx, bottom: box?.bottom, scale: box?.scale ?? 1 },
    slackX: iw - sw, slackY: ih - sh, srcPerCss: sw / stack.clientWidth, layoutPerCss: W / stack.clientWidth,
  };
  if (drag.mode === 'photo' && drag.slackX < 2 && drag.slackY < 2) drag = null; // nothing to reframe
});

stack.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  const shot = state.shot;

  if (drag.mode === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const scale = drag.scale * (Math.hypot(a.x - b.x, a.y - b.y) / drag.dist);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Grow around the strip's centre and follow the fingers' midpoint.
    const cy = drag.cy + (mid.y - drag.mid.y) * drag.layoutPerCss;
    shot.strip = {
      cx: drag.cx + (mid.x - drag.mid.x) * drag.layoutPerCss,
      bottom: cy + (drag.unitH * scale) / 2,
      scale,
    };
    queueDraw();
    return;
  }

  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragging) {
    if (Math.hypot(dx, dy) < 6) return; // a tap or long-press (save), not a drag
    beginDragging(e);
  }
  if (drag.mode === 'strip') {
    // compose() clamps to the edges; the clamped box comes back from draw().
    shot.strip = { ...drag.strip, cx: drag.strip.cx + dx * drag.layoutPerCss, bottom: drag.strip.bottom + dy * drag.layoutPerCss };
  } else {
    // Dragging the photo right reveals more of its left side, so the focus moves left.
    shot.focus = {
      x: drag.slackX >= 2 ? clamp01(drag.focus.x - (dx * drag.srcPerCss) / drag.slackX) : 0.5,
      y: drag.slackY >= 2 ? clamp01(drag.focus.y - (dy * drag.srcPerCss) / drag.slackY) : 0.5,
    };
  }
  queueDraw();
});

function endDrag(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  const pinchOver = drag.mode === 'pinch' && pointers.size < 2;
  if (!pinchOver && e.pointerId !== drag.id) return;
  drag = null; // after a pinch, the finger left behind does nothing until lifted
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
  // An older photo with no GPS of its own falls back to where you are: say so, and invite a change.
  const guessed = Boolean(shot.reportAt) && shot.gpsSource === 'here'; // a real boolean: toggle(x, undefined) flips
  el.classList.toggle('ask', (!shot.gps && !shot.loading) || (guessed && !shot.loading));
  if (shot.loading) { el.textContent = 'Reading the air…'; return; }
  if (!shot.gps) { el.textContent = 'Add where this was taken'; return; }
  if (guessed && !shot.placeName) { el.textContent = 'No location in photo · set it'; return; }
  const air = shot.air;
  const where = shot.placeName ?? air?.place ?? (shot.gpsSource === 'photo' ? 'Photo location' : 'Here');
  const what = !air ? 'air data unavailable'
    : air.aqi == null ? 'no reading here right now'
    : air.scope === 'modeled' ? `${air.source}, modeled` : air.source;
  el.textContent = `${where} · ${what}`;
}

// The sticker is automatic; the chips stay tucked away behind "change".
function renderScenes() {
  const shot = state.shot;
  const current = effectiveScene();
  $('sceneToggle').textContent = shot?.loading && state.scene === 'auto' ? 'Sticker: …'
    : current ? `Sticker: ${SCENES[current].label}` : 'No sticker';
  const auto = shot?.loading ? 'Auto · …' : shot?.detected ? `Auto · ${SCENES[shot.detected].label}` : 'Auto · none';
  const options = [['auto', auto], ...Object.entries(SCENES).map(([id, s]) => [id, s.label]), [null, 'None']];
  $('scenes').replaceChildren(...options.map(([value, label]) => {
    const b = document.createElement('button');
    const on = state.scene === value;
    b.className = 'chip' + (on ? ' on' : '');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = label;
    b.onclick = () => { state.scene = value; setScenePicker(false); renderScenes(); render(); };
    return b;
  }));
}

function setScenePicker(open) {
  $('scenes').hidden = !open;
  $('sceneToggle').setAttribute('aria-expanded', String(open));
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
    loadPlace(shot, { lat: p.lat, lon: p.lon }, {}, 'search');
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
  loadPlace(shot, here.gps, here, 'chosen-here');
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
$('sceneToggle').addEventListener('click', () => setScenePicker($('scenes').hidden));
$('sheetClose').addEventListener('click', closeSheet);
$('capture').addEventListener('change', onCapture);
$('file').addEventListener('change', onFile);
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', pickPhoto));

// Ask for location as soon as Aera opens, so air + scene are ready when the photo comes back.
locateHere();
updateGalleryButton();
