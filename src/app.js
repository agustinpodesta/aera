// Aera app: home → the phone's own camera (full-quality photo) → preview → share.
// The in-browser viewfinder was dropped: browsers only expose a video stream,
// never the phone's photo pipeline (HDR+, Night Sight…), so photos looked flat.
// Photos never leave the device; only rounded coordinates go to /api/air and /api/scene.

import { compose, coverCrop, ensureFonts, W, H, STRIP_HOME } from './compose.js';
import { SCENES } from './scenes.js';
import { photoGps, photoLocation, photoTakenAt, fetchScene, fetchAir, locateMe, searchPlaces } from './location.js';
import { savePhoto, listPhotos, getPhoto, getEditable, deletePhoto } from './gallery.js';
import { recordPlace, placeAt } from './trail.js';
import { citiesAtOffset, offsetIn, offsetLabel } from './cities.js';

const HERE_TTL = 15 * 60e3; // re-locate if the last fix is older than this
const MAX_SCALE = 2;        // export up to 2160×3840 (8 MP) when the photo has the detail for it
const MAX_ZOOM = 4;         // pinch-zoom limit for the photo
const RECENT_MS = 60 * 60e3; // older than this, a photo counts as "older" (place guessing, TIME)
// Photos older than this get the air from the hour they were taken (Open-Meteo's model,
// with the photo's own TIME), if the model's archive reaches back that far.
const HISTORY_AFTER_MS = 2 * 3600e3; // matches the server's PAST_AFTER_MS
const HISTORY_FROM = Date.UTC(2022, 7, 1); // global model archive starts August 2022

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
  if (screen !== 'gallery' && sel.on) setSelecting(false);
  if (screen !== 'preview') closeSheet();
  if (screen === 'preview') $('pickAgain').hidden = true;
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
  if (state.screen === 'preview' && to !== 'preview') {
    // Back with the place sheet open closes the sheet, not the photo.
    if (!$('sheet').hidden) { closeSheet(); history.pushState({ aera: 'preview' }, ''); return; }
    if (state.shot?.pending) discardPending();
  }
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

// The phone's gallery picker (images only). Note: Chrome on Android receives picked photos
// with GPS blanked (Android redacts location for apps without media-location access, via
// the gallery and the Files picker alike), so older photos usually need their place set.
function pickPhoto() {
  notify('');
  $('pickAgain').hidden = true;
  $('file').value = '';
  $('file').click();
}

// Locate and prefetch air + scene, so the preview is ready when the photo arrives.
// Reuses a fresh fix; retries when the last attempt failed or went stale.
function locateHere(force = false) {
  const fresh = () => locateMe().then((gps) => (gps && recordPlace(gps, Date.now(), null, -new Date().getTimezoneOffset()), {
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
// Android hides the GPS of picked photos from every website, so without it: a photo
// taken just now → where you are; an older one → where Aera saw you around that time,
// or a place you picked for that trip (the on-device trail); else where you are — unless
// the photo's time zone shows it was taken somewhere else. Then "here" would be wrong,
// so the likely places for that time zone are offered as one tap instead.
function onFile(e) {
  const f = e.target.files?.[0];
  if (f) importFile(f);
}

// The photo's UTC offset when it differs from this phone's offset on that date (the
// photo was taken in another time zone), else null. Only for older photos.
function awayOffset(shot) {
  const off = shot?.utcOffsetMin;
  if (!shot?.older || !Number.isFinite(off)) return null;
  return off === -shot.takenAt.getTimezoneOffset() ? null : off;
}

// When was the air on the strip? A photo from the last hour: now. Older than 2 h (and
// since Aug 2022): the hour it was taken, at the photo's own TIME. In between, or older
// than the archive: the air now, and TIME becomes now so it never claims the past.
function datePhoto(shot) {
  const t = shot.takenAt.getTime(), age = Date.now() - t;
  shot.older = age > RECENT_MS;
  shot.live = true;
  shot.reportAt = undefined;
  if (age > HISTORY_AFTER_MS && t >= HISTORY_FROM) shot.live = false;
  else if (shot.older) shot.reportAt = new Date();
}

async function importFile(f) {
  const shot = await openFile(f, { live: true, pending: true });
  if (!shot) return;
  const [{ gps }, taken] = await Promise.all([photoLocation(f), photoTakenAt(f)]);
  if (taken) { shot.takenAt = taken.at; shot.utcOffsetMin = taken.utcOffsetMin; }
  datePhoto(shot);
  if (gps) {
    recordPlace(gps, shot.takenAt, null, shot.utcOffsetMin);
    return loadPlace(shot, gps, {}, 'photo');
  }
  const seen = shot.older ? placeAt(shot.takenAt, shot.utcOffsetMin) : null;
  if (seen) {
    shot.placeName = seen.name ?? undefined;
    return loadPlace(shot, seen.gps, {}, 'trail');
  }
  if (awayOffset(shot) != null) {
    loadPlace(shot, null);
    if (state.shot === shot && state.screen === 'preview') openSheet();
    return;
  }
  const here = await locateHere();
  loadPlace(shot, here.gps, here, here.gps ? 'here' : null);
}

// The load event, not img.decode(): decode() can wait for a painted frame, which never
// comes while the page is in the background (e.g. returning from the camera app).
function loadImage(blob) {
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// pending: a picked or shared photo stays out of the Aera gallery until you share or
// save it; back discards it. Camera shots are kept right away, like any camera.
async function openFile(f, { live, pending = false }) {
  let img;
  try {
    img = await loadImage(f);
  } catch {
    show('home');
    notify('That photo couldn’t be opened. Try a JPEG or PNG.');
    return null;
  }
  const scale = exportScale(img);
  const shot = {
    id: newId(), img, original: f, src: workingCopy(img, scale), scale, focus: { x: 0.5, y: 0.5 }, strip: { ...STRIP_HOME },
    takenAt: new Date(live ? Date.now() : f.lastModified || Date.now()),
    live, pending, gps: null, air: null, detected: null, loading: true,
  };
  markStarted();
  openPreview(shot);
  return shot;
}

// Everything needed to reopen a photo's edit later from the gallery (the reading is kept
// as it was: it records the air when the photo was made).
function editState(shot) {
  return {
    focus: shot.focus, zoom: shot.zoom ?? 1, ink: shot.ink ?? 'light', strip: shot.strip, sceneChoice: state.scene,
    takenAt: +shot.takenAt, utcOffsetMin: shot.utcOffsetMin ?? null, reportAt: shot.reportAt ? +shot.reportAt : null, older: !!shot.older,
    live: shot.live, gps: shot.gps, gpsSource: shot.gpsSource ?? null, placeName: shot.placeName ?? null,
    air: shot.air, detected: shot.detected,
  };
}

// A gallery photo with its original kept → back into the editor; older ones open view-only.
async function openEditor(id) {
  const data = await getEditable(id).catch(() => null);
  if (!data) return openViewer(id);
  const { meta, original } = data, e = meta.edit;
  let img;
  try { img = await loadImage(original); } catch { return openViewer(id); }
  const scale = exportScale(img);
  openPreview({
    id, img, original, originalSaved: true, src: workingCopy(img, scale), scale, fromGallery: true,
    focus: e.focus, zoom: e.zoom ?? 1, ink: e.ink ?? 'light', strip: e.strip, sceneChoice: e.sceneChoice,
    takenAt: new Date(e.takenAt), utcOffsetMin: e.utcOffsetMin, reportAt: e.reportAt ? new Date(e.reportAt) : undefined,
    older: e.older ?? Boolean(e.reportAt),
    live: e.live, gps: e.gps, gpsSource: e.gpsSource, placeName: e.placeName ?? undefined,
    air: e.air, detected: e.detected, loading: false, savedAt: new Date(meta.createdAt),
  });
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
  shot.gpsSource = gps ? source : null; // 'photo' | 'here' | 'trail' | 'search' | 'chosen-here'
  shot.air = null;
  shot.detected = null;
  shot.loading = !!gps;
  refresh(shot);
  if (!gps) return; // no location: the preview asks for one
  const at = shot.live ? null : shot.takenAt;
  let [air, scene] = await Promise.all([
    (shot.live && pre.air) || fetchAir(gps, at), // a prefetched reading is the air now: live shots only
    pre.scene ?? fetchScene(gps).then((b) => b.scene ?? null),
  ]);
  // One retry before showing "no reading": the air services occasionally rate-limit or time out.
  if (!air && shot.gps === gps) air = await new Promise((r) => setTimeout(r, 800)).then(() => fetchAir(gps, at));
  if (shot.gps !== gps) return; // a different place was picked meanwhile
  // No model data for that hour (a gap): the air now instead, and TIME says now.
  if (!shot.live && !Number.isFinite(air?.aqi)) {
    const now = await fetchAir(gps);
    if (shot.gps !== gps) return;
    if (Number.isFinite(now?.aqi)) { air = now; shot.live = true; shot.reportAt = new Date(); }
  }
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
  state.scene = shot.sceneChoice ?? 'auto';
  setScenePicker(false);
  // Reopened from the gallery: back returns to the gallery, and Retake becomes Delete.
  // A picked photo: back returns to where you picked it (and discards it); Retake
  // becomes Another. A camera shot from the gallery screen replaces that entry.
  if (shot.fromGallery) history.pushState({ aera: 'preview' }, '');
  else if (history.state?.aera === 'preview') { /* already there: a new pick replaces the old one */ }
  else if (history.state?.aera === 'gallery' && !shot.pending) history.replaceState({ aera: 'preview' }, '');
  else history.pushState({ aera: 'preview' }, '');
  $('retake').textContent = shot.fromGallery ? 'Delete' : shot.pending ? 'Another' : 'Retake';
  renderInk();
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
  const zoom = shot.zoom ?? 1;
  shot.stripBox = compose(canvas, {
    // Zoomed in, the final frame draws from the full-resolution original so it stays sharp.
    photo: !dragging && zoom > 1.01 ? shot.img : shot.src,
    focus: shot.focus, zoom, ink: shot.ink ?? 'light', strip: shot.strip, scale: dragging ? 1 : shot.scale,
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
    if (!shot.pending) keepShot(shot, blob);
    const share = canShareFile(state.file);
    $('save').textContent = share ? 'Share' : 'Download';
    $('download').hidden = !share; // with a share sheet, keep a one-tap "save to my photos" too
    showPreviewImage(blob);
  }, 'image/jpeg', 0.92);
}

// Into the on-device gallery; later edits update the same entry. The original goes in
// once; the edit state rides along every time, so the photo can be reopened and edited.
function keepShot(shot, blob) {
  const original = shot.originalSaved ? null : shot.original;
  return savePhoto({
    id: shot.id, createdAt: (shot.savedAt ??= new Date()), aqi: shot.air?.aqi ?? null, scene: effectiveScene(),
    canvas, blob, name: state.file?.name ?? 'aera.jpg', edit: editState(shot), original,
  }).then(() => { if (original) shot.originalSaved = true; updateGalleryButton(); }).catch(() => {});
}

// Sharing or saving a picked photo is the sign you want it: keep it from then on.
function keepPending() {
  const shot = state.shot;
  if (!shot?.pending || !state.file) return;
  shot.pending = false;
  $('retake').textContent = 'Retake';
  keepShot(shot, state.file);
}

// Back from a picked photo you didn't share or save: it's gone, and choosing another
// is one tap away (browsers only open the picker from a tap, not from a back gesture).
function discardPending() {
  state.shot = null;
  state.file = null;
  hidePreviewImage();
  $('pickAgain').hidden = false;
  if (navigator.userActivation?.isActive) pickPhoto();
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
  stack.classList.add('draggable'); // the strip can always move; the photo can always zoom
  const hint = $('dragHint');
  hint.textContent = 'Drag or pinch the strip and the photo';
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

  // Second finger: on the strip, pinch resizes it like an Instagram sticker;
  // anywhere else, pinch zooms the photo.
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (drag?.mode === 'strip' || (drag?.mode !== 'photo' && onStripAt(toLayout({ clientX: mid.x, clientY: mid.y })))) {
      const box = shot.stripBox;
      drag = {
        mode: 'pinch', dist, mid, layoutPerCss: W / stack.clientWidth,
        scale: box.scale, cx: box.cx, cy: (box.top + box.bottom) / 2, unitH: (box.bottom - box.top) / box.scale,
      };
    } else {
      // Remember which point of the photo sits under the fingers, so it stays there.
      const z0 = shot.zoom ?? 1, r = stack.getBoundingClientRect();
      const { iw, ih, sw, sh } = coverCrop(shot.src, W, H, z0);
      const u = (mid.x - r.left) / r.width, v = (mid.y - r.top) / r.height;
      drag = {
        mode: 'zoom', dist, z0, rect: r,
        anchor: { x: (iw - sw) * shot.focus.x + u * sw, y: (ih - sh) * shot.focus.y + v * sh },
      };
    }
    if (!dragging) beginDragging(e);
    return;
  }
  if (pointers.size > 2) return;

  const p = toLayout(e), box = shot.stripBox;
  const { iw, ih, sw, sh } = coverCrop(shot.src, W, H, shot.zoom ?? 1);
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

  if (drag.mode === 'zoom') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const zoom = Math.min(MAX_ZOOM, Math.max(1, drag.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / drag.dist)));
    const { iw, ih, sw, sh } = coverCrop(shot.src, W, H, zoom);
    const u = ((a.x + b.x) / 2 - drag.rect.left) / drag.rect.width, v = ((a.y + b.y) / 2 - drag.rect.top) / drag.rect.height;
    shot.zoom = zoom;
    shot.focus = {
      x: iw - sw >= 1 ? clamp01((drag.anchor.x - u * sw) / (iw - sw)) : 0.5,
      y: ih - sh >= 1 ? clamp01((drag.anchor.y - v * sh) / (ih - sh)) : 0.5,
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
  const pinchOver = (drag.mode === 'pinch' || drag.mode === 'zoom') && pointers.size < 2;
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
  // An older photo placed by a guess (where you are now, or the trail): keep it quiet,
  // but make the change one tap. A real boolean: toggle(x, undefined) flips the class.
  const guessed = Boolean(shot.older) && (shot.gpsSource === 'here' || shot.gpsSource === 'trail');
  el.classList.toggle('ask', !shot.gps && !shot.loading);
  if (shot.loading) { el.textContent = 'Reading the air…'; return; }
  if (!shot.gps) {
    const off = awayOffset(shot);
    el.textContent = off != null ? `Taken in ${offsetLabel(off)} · pick the place` : 'Add where this was taken';
    return;
  }
  const air = shot.air;
  const where = shot.placeName ?? air?.place ?? (shot.gpsSource === 'photo' ? 'Photo location' : 'Here');
  const what = !air ? 'air data unavailable'
    : air.aqi == null ? (air.historical ? 'no reading for that time' : 'no reading here right now')
    : (air.scope === 'modeled' ? `${air.source}, modeled` : air.source) + (air.historical ? ', when taken' : '');
  el.textContent = guessed ? `${where} · ${what} · change` : `${where} · ${what}`;
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

// White or black strip; black is for very bright photos (snow, sky, sand).
function renderInk() {
  const dark = state.shot?.ink === 'dark';
  $('inkToggle').classList.toggle('dark', dark);
  $('inkToggle').setAttribute('aria-label', dark ? 'Switch to white text' : 'Switch to black text');
  $('inkToggle').setAttribute('aria-pressed', String(dark));
}

function toggleInk() {
  const shot = state.shot;
  if (!shot) return;
  shot.ink = shot.ink === 'dark' ? 'light' : 'dark';
  renderInk();
  render();
}

function setScenePicker(open) {
  $('scenes').hidden = !open;
  $('sceneToggle').setAttribute('aria-expanded', String(open));
}

/* ── Place sheet (manual location) ────────────────────────────────────── */

let searchTimer = 0;
let refine = null; // the suggested city just picked, while asking "where in it?"

function openSheet() {
  const off = awayOffset(state.shot);
  refine = null;
  $('sheet').hidden = false;
  $('sheetTitle').textContent = 'Where was this taken?';
  $('placeQuery').placeholder = 'Search a city';
  $('placeQuery').value = '';
  $('sheetNote').hidden = off == null;
  $('sheetNote').textContent = off == null ? '' : `Taken in ${offsetLabel(off)}, not where you are now.`;
  renderResults([], { showRecent: true });
  // With suggestions on screen, one tap is enough: don't pop the keyboard.
  if (off == null) setTimeout(() => $('placeQuery').focus(), 50);
}

// The last few places picked by search, kept on this device for one-tap reuse.
const RECENT_PLACES_KEY = 'aera.places';

function recentPlaces() {
  try { return JSON.parse(localStorage.getItem(RECENT_PLACES_KEY)) ?? []; } catch { return []; }
}

function rememberPlace({ name, detail, lat, lon, tz }) {
  const clean = (d) => String(d ?? '').replace(/^Recent( · )?/, '');
  const list = [{ name, detail: clean(detail), lat, lon, ...(tz ? { tz } : {}) }, ...recentPlaces().filter((p) => p.name !== name || p.lat !== lat)];
  try { localStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(list.slice(0, 5))); } catch { /* storage blocked */ }
}

function closeSheet() {
  $('sheet').hidden = true;
  // Closed while asking "where in <city>?": the city it is.
  if (refine) {
    const city = refine;
    refine = null;
    if (state.shot) finishPlace(state.shot, city);
  }
}

// After a suggested city, ask where exactly (optional): a neighbourhood or nearby town
// gives a closer reading. The city's reading loads meanwhile.

function openRefine(city) {
  refine = city;
  $('sheet').hidden = false;
  $('sheetTitle').textContent = `Where in ${city.name}?`;
  $('sheetNote').hidden = false;
  $('sheetNote').textContent = 'A neighbourhood or nearby town gives a closer reading. Optional.';
  $('placeQuery').value = '';
  $('placeQuery').placeholder = `Search near ${city.name}`;
  renderResults([], { showRecent: true });
  setTimeout(() => $('placeQuery').focus(), 50);
}

const KM_PER_DEG = 111.2;
function kmBetween(a, b) {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(x, b.lat - a.lat) * KM_PER_DEG;
}

// Search results nearest the city first; far-away namesakes only when nothing is close.
function nearby(places, city) {
  const ranked = places.map((p) => ({ ...p, km: kmBetween(city, p) })).sort((a, b) => a.km - b.km);
  const close = ranked.filter((p) => p.km <= 200);
  return (close.length ? close : ranked).map((p) => ({ ...p, detail: [p.detail, `${Math.round(p.km)} km`].filter(Boolean).join(' · ') }));
}

// Remember the final place: recents, and the trail so the trip's other photos follow.
function finishPlace(shot, p) {
  rememberPlace(p);
  recordPlace(p, shot.takenAt, p.name, shot.utcOffsetMin ?? (p.tz ? offsetIn(p.tz, shot.takenAt) : null));
}

// Before typing: your recent places (and "here"). For a photo from another time zone:
// recent places in that zone first, then the best-known cities there, "here" last.
function defaultPlaces() {
  if (refine) return [{ name: `Just ${refine.name}`, detail: refine.detail ?? '', keep: true }];
  const here = navigator.geolocation ? [{ name: 'Use my current location', detail: '', here: true }] : [];
  const recent = recentPlaces().map((p) => ({ ...p, detail: p.detail ? `Recent · ${p.detail}` : 'Recent' }));
  const off = awayOffset(state.shot);
  if (off == null) return [...here, ...recent];
  const at = state.shot.takenAt;
  const fits = recent.filter((p) => p.tz && offsetIn(p.tz, at) === off);
  const taken = new Set(fits.map((p) => p.name));
  const cities = citiesAtOffset(off, at).filter((c) => !taken.has(c.name)).map((c) => ({ ...c, city: true }));
  return [...fits, ...cities, ...here];
}

function renderResults(places, { showRecent = false } = {}) {
  const items = showRecent ? defaultPlaces()
    : refine ? [...nearby(places, refine), ...defaultPlaces()]
    : [...(navigator.geolocation ? [{ name: 'Use my current location', detail: '', here: true }] : []), ...places];
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
  const shot = state.shot;
  const city = refine;
  refine = null; // this choice settles it
  closeSheet();
  if (p.keep) return finishPlace(shot, city);
  if (!p.here) {
    shot.placeName = p.name;
    loadPlace(shot, { lat: p.lat, lon: p.lon }, {}, 'search');
    if (p.city && !city) return openRefine(p); // a suggested city: ask where exactly
    // Other photos from that trip (same time zone, within a few days) land here too.
    return finishPlace(shot, p);
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
  recordPlace(here.gps, shot.takenAt, null, shot.utcOffsetMin); // you were here when it was taken
  loadPlace(shot, here.gps, here, 'chosen-here');
}

$('placeQuery').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(async () => {
    const places = await searchPlaces(q, refine ? 30 : 6);
    if ($('placeQuery').value === q) renderResults(places, { showRecent: !q.trim() });
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
    b.dataset.id = r.id;
    b.onclick = () => {
      if (b.dataset.longpressed) { delete b.dataset.longpressed; return; }
      if (sel.on) toggleSelected(r.id);
      else if (r.edit) openEditor(r.id);
      else openViewer(r.id);
    };
    onLongPress(b, () => { if (!sel.on) setSelecting(true); toggleSelected(r.id); });
    li.append(b);
    return li;
  }));
  $('galleryEmpty').hidden = rows.length > 0;
  $('grid').hidden = rows.length === 0;
  $('selectBtn').hidden = rows.length === 0;
  renderSelection();
}

/* ── Gallery multi-select: share or delete several photos at once ─────── */

const sel = { on: false, ids: new Set(), files: new Map() }; // files: id → File, loaded on select

function setSelecting(on) {
  sel.on = on;
  if (!on) { sel.ids.clear(); sel.files.clear(); }
  renderSelection();
}

function toggleSelected(id) {
  if (sel.ids.has(id)) {
    sel.ids.delete(id);
    sel.files.delete(id);
  } else {
    sel.ids.add(id);
    // Load the finished JPEG now, so Share can run straight inside the tap.
    getPhoto(id).then((row) => {
      if (row && sel.ids.has(id)) sel.files.set(id, new File([row.blob], row.name || 'aera.jpg', { type: 'image/jpeg' }));
    }).catch(() => {});
  }
  renderSelection();
}

function renderSelection() {
  const n = sel.ids.size;
  $('gallery').classList.toggle('selecting', sel.on);
  $('selectBtn').textContent = sel.on ? 'Cancel' : 'Select';
  $('galleryTitle').textContent = !sel.on ? 'Your photos' : n ? `${n} selected` : 'Select photos';
  $('selectBar').hidden = !sel.on;
  $('selShare').disabled = $('selDelete').disabled = n === 0;
  for (const b of $('grid').querySelectorAll('button[data-id]')) {
    const picked = sel.ids.has(b.dataset.id);
    b.classList.toggle('picked', picked);
    if (sel.on) b.setAttribute('aria-pressed', String(picked));
    else b.removeAttribute('aria-pressed');
  }
}

async function shareSelected() {
  const files = [...sel.ids].map((id) => sel.files.get(id)).filter(Boolean);
  if (!files.length) return;
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files }); } catch { /* closed the sheet */ }
    return;
  }
  files.forEach(downloadFile);
}

async function deleteSelected() {
  const n = sel.ids.size;
  if (!n || !confirm(n === 1 ? 'Delete this photo from Aera?' : `Delete these ${n} photos from Aera?`)) return;
  await Promise.all([...sel.ids].map((id) => deletePhoto(id).catch(() => {})));
  setSelecting(false);
  updateGalleryButton();
  openGallery({ push: false });
}

// Press and hold a photo to start selecting, like a phone gallery.
function onLongPress(el, fn, ms = 450) {
  let timer = 0, start = null;
  const clear = () => { clearTimeout(timer); timer = 0; };
  el.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { timer = 0; el.dataset.longpressed = '1'; fn(); }, ms);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, clear);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
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

async function deleteEdited() {
  if (!state.shot || !confirm('Delete this photo from Aera?')) return;
  await deletePhoto(state.shot.id).catch(() => {});
  updateGalleryButton();
  history.back(); // back to the grid, which re-renders without it
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
$('retake').addEventListener('click', () => (state.shot?.fromGallery ? deleteEdited() : state.shot?.pending ? pickPhoto() : openCamera()));
$('save').addEventListener('click', () => { keepPending(); shareFile(state.file); });
$('download').addEventListener('click', () => { keepPending(); saveToDevice(state.file); });
$('pickAgain').addEventListener('click', pickPhoto);
$('galleryBtn').addEventListener('click', () => openGallery());
$('viewerShare').addEventListener('click', () => shareFile(state.viewer?.file));
$('viewerSave').addEventListener('click', () => saveToDevice(state.viewer?.file));
for (const id of ['download', 'viewerSave']) $(id).setAttribute('aria-label', IS_IOS ? 'Save to Photos' : 'Save to your gallery');
$('viewerDelete').addEventListener('click', removeViewed);
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));
$('place').addEventListener('click', openSheet);
$('inkToggle').addEventListener('click', toggleInk);
$('selectBtn').addEventListener('click', () => setSelecting(!sel.on));
$('selShare').addEventListener('click', shareSelected);
$('selDelete').addEventListener('click', deleteSelected);
$('sceneToggle').addEventListener('click', () => setScenePicker($('scenes').hidden));
$('sheetClose').addEventListener('click', closeSheet);
$('capture').addEventListener('change', onCapture);
$('file').addEventListener('change', onFile);
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', pickPhoto));

// "Tap to begin" floats over the shutter until the first photo is made.
const STARTED_KEY = 'aera.started';
const hasStarted = () => { try { return localStorage.getItem(STARTED_KEY) === '1'; } catch { return false; } };
function markStarted() {
  try { localStorage.setItem(STARTED_KEY, '1'); } catch { /* storage blocked: the hint just stays */ }
  $('tapHint').hidden = true;
}
$('tapHint').hidden = hasStarted();

// Ask for location as soon as Aera opens, so air + scene are ready when the photo comes back.
locateHere();
updateGalleryButton();

// Installable app + "Share → Aera" from other apps (see sw.js).
navigator.serviceWorker?.register('/sw.js').catch(() => {});

// A photo shared to Aera from another app ("Share → Aera"): sw.js parked it on this
// device; open it like a picked photo. Several shared at once → the first one.
async function openShared() {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return;
  history.replaceState(null, '', '/');
  const cache = await caches.open('aera-share');
  const keys = await cache.keys();
  const res = keys.length ? await cache.match(keys[0]) : null;
  await Promise.all(keys.map((k) => cache.delete(k)));
  if (!res) return;
  const blob = await res.blob();
  const name = decodeURIComponent(res.headers.get('x-name') || 'shared.jpg');
  importFile(new File([blob], name, { type: blob.type, lastModified: +res.headers.get('x-modified') || Date.now() }));
}
openShared();
