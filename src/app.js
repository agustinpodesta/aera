// Aera app: start → camera → preview → save/share. Photos never leave the device;
// only rounded coordinates go to /api/scene.

import { compose, ensureFonts } from './compose.js';
import { SCENES } from './scenes.js';
import { startCamera, stopCamera, captureFrame } from './camera.js';
import { photoGps, photoTakenAt, fetchScene } from './location.js';

// Milestone 2 has no live air data yet: every image is marked as sample data (M3 replaces this).
const SAMPLE_READING = { aqi: 42, source: 'IQAir', scope: 'city', sample: true };

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');

const state = {
  screen: 'start',
  mirrored: false,
  shot: null,          // { img, takenAt, gps, detected, detecting }
  scene: 'auto',       // 'auto' | SCENES key | null
  file: null,          // the exported JPEG, prepared ahead so Share stays inside the tap
};

/* ── Screens ──────────────────────────────────────────────────────────── */

function show(screen, { push = true } = {}) {
  for (const id of ['start', 'camera', 'preview']) $(id).hidden = id !== screen;
  if (screen !== 'camera') stopCamera(video);
  if (push && screen !== 'start' && state.screen === 'start') history.pushState({ aera: screen }, '');
  state.screen = screen;
}

function notify(text) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

// Android back / browser back returns to the start screen.
window.addEventListener('popstate', () => { if (state.screen !== 'start') show('start', { push: false }); });

/* ── Camera ───────────────────────────────────────────────────────────── */

async function openCamera() {
  notify('');
  show('camera');
  try {
    const { mirrored } = await startCamera(video);
    state.mirrored = mirrored;
    video.classList.toggle('mirrored', mirrored);
  } catch (err) {
    if (history.state?.aera) history.back(); // drop the camera history entry
    show('start', { push: false });
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

function takePhoto() {
  if (!video.videoWidth) return;
  const img = captureFrame(video, state.mirrored);
  stopCamera(video);
  // Live captures get their location from geolocation in M3; until then Auto adds no glyph.
  openPreview({ img, takenAt: new Date(), gps: null, detected: null, detecting: false });
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
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = async () => {
    const shot = { img, takenAt: new Date(f.lastModified || Date.now()), gps: null, detected: null, detecting: true };
    openPreview(shot);
    const [gps, takenAt] = await Promise.all([photoGps(f), photoTakenAt(f)]);
    shot.gps = gps;
    if (takenAt) { shot.takenAt = takenAt.at; shot.utcOffsetMin = takenAt.utcOffsetMin; }
    if (shot.gps) shot.detected = (await fetchScene(shot.gps)).scene ?? null;
    shot.detecting = false;
    if (state.shot === shot) { renderScenes(); render(); }
  };
  img.onerror = () => { show('start', { push: false }); notify('That photo couldn’t be opened. Try a JPEG or PNG.'); };
  img.src = url;
}

/* ── Preview + export ─────────────────────────────────────────────────── */

function openPreview(shot) {
  state.shot = shot;
  state.scene = 'auto';
  show('preview');
  renderScenes();
  render();
}

const effectiveScene = () => (state.scene === 'auto' ? state.shot?.detected ?? null : state.scene);

function render() {
  const { img, takenAt, utcOffsetMin = null } = state.shot;
  compose(canvas, { photo: img, scene: effectiveScene(), reading: { ...SAMPLE_READING, takenAt, updatedAt: takenAt, utcOffsetMin } });
  prepareFile();
}

function prepareFile() {
  state.file = null;
  $('save').disabled = true;
  const shot = state.shot;
  canvas.toBlob((blob) => {
    if (!blob || state.shot !== shot) return;
    const d = shot.takenAt, p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    state.file = new File([blob], `aera-${stamp}.jpg`, { type: 'image/jpeg' });
    $('save').disabled = false;
    $('save').textContent = canShareFile(state.file) ? 'Save or share' : 'Download';
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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function renderScenes() {
  const shot = state.shot;
  const auto = shot?.detecting ? 'Auto · …' : shot?.detected ? `Auto · ${SCENES[shot.detected].label}` : 'Auto · none';
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

/* ── Wiring ───────────────────────────────────────────────────────────── */

$('openCamera').addEventListener('click', openCamera);
$('closeCamera').addEventListener('click', () => history.back());
$('shutter').addEventListener('click', takePhoto);
$('retake').addEventListener('click', openCamera);
$('save').addEventListener('click', save);
$('file').addEventListener('change', onFile);
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', pickPhoto));

await ensureFonts();
