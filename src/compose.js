// Aera — the one template. A full-bleed 1080×1920 photo with a compact,
// receipt-like data strip laid over it (in the spirit of Strava story overlays):
//
//   - - - - - - - - - - - - - - -
//   AQI                     ● 42     ← dot colour: dark green (best) … dark purple
//   AIR                     GOOD
//   TIME                   16:42
//   - - - - - - - - - - - - - - -
//   DATA IQAIR, UPDATED 16:00 · AERACAM.COM
//
//               A E R A              ← wordmark, centred
//                 /\/\               ← scene glyph (city, coast, mountains…)
//
// Fallback (Open-Meteo) readings say "(MODELED)" after the source so a model
// estimate never passes for a measurement.
//
// The strip can be dragged and pinch-resized anywhere, kept within a small margin of
// the edges (Agustín's call: 80% looser than Instagram's ~250px Story safe zones).

import { aqiCategory, aqiDotColor } from './aqi.js';
import { drawScene } from './scenes.js';

export const W = 1080;
export const H = 1920;

export const COLORS = {
  paper:  '#F2EDE4',
  soft:   'rgba(242,237,228,0.9)',
  faint:  'rgba(242,237,228,0.78)',
  signal: '#E4572E',
};

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

// The AERA wordmark: Syne ExtraBold, tracked out.
const WORDMARK = { font: `800 44px "Syne", sans-serif`, spacing: 3.8 };
const WORDMARK_GAP = 78;   // footer baseline → wordmark baseline
const ICON_GAP = 22;       // wordmark baseline → scene glyph top
const OVERLAY_ALPHA = 0.75; // the whole strip sits into the photo

const STRIP_W = 600;
export const SAFE = { top: 50, bottom: H - 50, side: 8 };
export const STRIP_SCALE = { min: 0.5, max: (W - 2 * 8) / 600 }; // up to edge-to-edge
export const STRIP_HOME = { cx: W / 2, bottom: 1660 }; // default spot: bottom-centre, above the reply bar
// Strip edges for the current compose() call (set there, read by the drawing helpers).
let X0 = (W - STRIP_W) / 2, X1 = X0 + STRIP_W, CX = W / 2;

const ROW_H = 92;          // single-line row
const ROW_H_2 = 124;       // two-line row (long AQI category)
const LABEL = `500 25px ${MONO}`;
const VALUE_SIZE = 60;
const DOT_R = 15;
const ICON = 66;

export async function ensureFonts() {
  await Promise.all([
    document.fonts.load(`400 22px ${MONO}`),
    document.fonts.load(`500 25px ${MONO}`),
    document.fonts.load(`500 60px ${MONO}`),
    document.fonts.load(WORDMARK.font, 'AERA'),
  ]);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {CanvasImageSource|null} opts.photo
 * @param {object} opts.reading  { aqi, scope, source, updatedAt, takenAt, timeZone, utcOffsetMin, sample }
 *   Time zone: utcOffsetMin (from photo EXIF) wins, then the IANA timeZone, else the device's.
 * @param {string|null} [opts.scene]  key of SCENES in scenes.js, or null for none
 * @param {{x:number, y:number}} [opts.focus]  which part of the photo the 9:16 crop keeps (0..1, 0.5 = centre)
 * @param {number} [opts.scale]  pixel density: 1 = 1080×1920, 2 = 2160×3840. Layout stays in 1080×1920 units.
 * @param {{cx:number, bottom:number, scale?:number}} [opts.strip]  where the strip sits and how big
 *   (layout units; scale 1 = 600 wide); clamped to SAFE
 * @returns {{cx:number, bottom:number, scale:number, left:number, right:number, top:number}} the strip's actual box
 */
export function compose(canvas, { photo, reading, scene = null, focus = { x: 0.5, y: 0.5 }, scale = 1, strip = STRIP_HOME }) {
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';

  if (photo) drawCover(ctx, photo, 0, 0, W, H, focus);
  else drawPlaceholder(ctx, 0, 0, W, H);

  const rows = buildRows(reading);
  const rowsH = rows.reduce((h, r) => h + (r.lines.length > 1 ? ROW_H_2 : ROW_H), 0);
  //           rule  rows   rule+source  wordmark  scene
  const total = 34 + rowsH + 40 + WORDMARK_GAP + (scene ? ICON_GAP + ICON : 0);
  const k = clamp(strip.scale ?? 1, STRIP_SCALE.min, Math.min(STRIP_SCALE.max, (SAFE.bottom - SAFE.top) / total));
  const w = STRIP_W * k, h = total * k;
  const cx = clamp(strip.cx, SAFE.side + w / 2, W - SAFE.side - w / 2);
  const bottom = clamp(strip.bottom, SAFE.top + h, SAFE.bottom);

  drawScrim(ctx, bottom - h, bottom);
  // Lay the strip out at size 1 around its bottom-centre anchor, then scale it there.
  CX = cx;
  X0 = cx - STRIP_W / 2;
  X1 = cx + STRIP_W / 2;
  ctx.save();
  ctx.translate(cx, bottom);
  ctx.scale(k, k);
  ctx.translate(-cx, -bottom);
  drawStrip(ctx, reading, rows, bottom - total, scene);
  ctx.restore();
  return { cx, bottom, scale: k, left: cx - w / 2, right: cx + w / 2, top: bottom - h };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── Photo ────────────────────────────────────────────────────────────── */

function drawCover(ctx, img, x, y, w, h, focus = { x: 0.5, y: 0.5 }) {
  const { iw, ih, sw, sh } = coverCrop(img, w, h);
  ctx.drawImage(img, (iw - sw) * focus.x, (ih - sh) * focus.y, sw, sh, x, y, w, h);
}

/** Source size and the crop (in source pixels) that covers a w×h frame. */
export function coverCrop(img, w = W, h = H) {
  const iw = img.naturalWidth || img.videoWidth || img.width;
  const ih = img.naturalHeight || img.videoHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  return { iw, ih, sw: w / scale, sh: h / scale };
}

// Stand-in landscape so the layout reads before a photo is chosen.
function drawPlaceholder(ctx, x, y, w, h) {
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#8FA6B0');
  sky.addColorStop(0.5, '#D3CBBA');
  sky.addColorStop(1, '#B9AE98');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  const ridge = (base, amp, color, seed) => {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    for (let i = 0; i <= w; i += 8) {
      const t = i / w;
      ctx.lineTo(x + i, y + base - amp * (Math.sin(t * 5 + seed) * 0.6 + Math.sin(t * 13 + seed * 2) * 0.25));
    }
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  ridge(h * 0.55, 80, 'rgba(78,98,90,0.55)', 1.3);
  ridge(h * 0.66, 60, 'rgba(45,66,55,0.85)', 2.6);
  ridge(h * 0.8, 40, '#2A3B31', 0.4);
}

// A light band of darkening behind the strip, wherever it sits, so it reads on bright
// photos (snow, sky, beach) without muddying the rest; the text shadow does most of the work.
function drawScrim(ctx, top, bottom) {
  const from = Math.max(0, top - 260), to = Math.min(H, bottom + 220);
  const g = ctx.createLinearGradient(0, from, 0, to);
  g.addColorStop(0, 'rgba(10,14,12,0)');
  g.addColorStop(0.35, 'rgba(10,14,12,0.26)');
  g.addColorStop(0.75, 'rgba(10,14,12,0.38)');
  g.addColorStop(1, `rgba(10,14,12,${to >= H ? 0.38 : 0})`); // near the bottom edge, keep it to the edge
  ctx.fillStyle = g;
  ctx.fillRect(0, from, W, to - from);
}

/* ── Strip ────────────────────────────────────────────────────────────── */

function buildRows(r) {
  const cat = aqiCategory(r.aqi);
  const taken = r.takenAt ? new Date(r.takenAt) : new Date();
  return [
    { label: 'AQI',  lines: [r.pending ? '…' : r.aqi != null ? String(Math.round(r.aqi)) : '—'], dot: aqiDotColor(r.aqi) },
    { label: 'AIR',  lines: r.pending ? ['…'] : cat ? cat.lines : ['NO READING'] },
    { label: 'TIME', lines: [fmtTime(taken, r.timeZone, r.utcOffsetMin)] },
  ];
}

function drawStrip(ctx, r, rows, top, scene) {
  ctx.save();
  ctx.globalAlpha = OVERLAY_ALPHA;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 2;

  let y = top;
  dashed(ctx, y);
  y += 34;

  // Rows: label left, value right, baselines shared
  for (const row of rows) {
    const two = row.lines.length > 1;
    const h = two ? ROW_H_2 : ROW_H;
    const labelW = measureSpaced(ctx, row.label, LABEL, 4);
    const room = STRIP_W - labelW - 40;
    const longest = row.lines.reduce((a, b) => (b.length > a.length ? b : a));
    const size = fitSize(ctx, longest, (s) => `500 ${s}px ${MONO}`, two ? 40 : VALUE_SIZE, 26, room, 1);
    const lineH = size * 1.08;
    const lastBase = y + h - 26;

    ctx.font = `500 ${size}px ${MONO}`;
    ctx.fillStyle = COLORS.paper;
    row.lines.forEach((line, i) => {
      spaced(ctx, line, X1, lastBase - (row.lines.length - 1 - i) * lineH, 1, 'right');
    });
    if (row.dot) {
      const valueW = measureSpaced(ctx, row.lines[0], ctx.font, 1);
      drawDot(ctx, X1 - valueW - 22 - DOT_R, lastBase - size * 0.36, row.dot);
    }
    ctx.font = LABEL;
    ctx.fillStyle = COLORS.soft;
    spaced(ctx, row.label, X0, lastBase, 4, 'left');
    y += h;
  }

  dashed(ctx, y);
  y += 40;

  // Source + update time (attribution), URL
  let footer;
  if (r.sample) footer = 'SAMPLE DATA — NOT A MEASUREMENT';
  else if (r.pending) footer = 'READING THE AIR…';
  else if (r.aqi == null) footer = r.historical ? 'NO AIR DATA FOR THAT DAY · AERACAM.COM' : 'NO AIR DATA HERE · AERACAM.COM';
  else {
    const source = String(r.source || '').toUpperCase() + (r.scope === 'modeled' ? ' (MODELED)' : '');
    // Past photos show the modeled value for the hour they were taken ("FOR"), live ones when it was updated.
    const when = fmtTime(new Date(r.updatedAt), r.timeZone, r.utcOffsetMin);
    footer = `DATA ${source}, ${r.historical ? 'FOR' : 'UPDATED'} ${when} · AERACAM.COM`;
  }
  if (r.sample) {
    // Orange marker flags illustrative data without relying on orange text over a photo.
    ctx.fillStyle = COLORS.signal;
    ctx.fillRect(X0, y - 15, 14, 14);
  }
  ctx.fillStyle = COLORS.faint;
  fitLine(ctx, footer, y, 22, r.sample ? 26 : 0);

  // Wordmark, centred
  y += WORDMARK_GAP;
  ctx.font = WORDMARK.font;
  ctx.fillStyle = COLORS.paper;
  spaced(ctx, 'AERA', CX, y, WORDMARK.spacing, 'center');

  // Scene glyph under the wordmark
  if (scene) {
    ctx.strokeStyle = COLORS.paper;
    drawScene(ctx, scene, CX, y + ICON_GAP, ICON);
  }
  ctx.restore();
}

// Solid AQI colour, no ring; the strip's soft shadow keeps it apart from the photo.
function drawDot(ctx, cx, cy, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function dashed(ctx, y) {
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = COLORS.faint;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(X0, y);
  ctx.lineTo(X1, y);
  ctx.stroke();
  ctx.restore();
}

// Full-width footer line, shrunk if needed.
function fitLine(ctx, text, y, max, indent) {
  const size = fitSize(ctx, text, (s) => `400 ${s}px ${MONO}`, max, 14, STRIP_W - indent, 1.5);
  ctx.font = `400 ${size}px ${MONO}`;
  spaced(ctx, text, X0 + indent, y, 1.5, 'left');
}

/* ── Text helpers (manual tracking: canvas letterSpacing isn't universal) ─ */

function measureSpaced(ctx, text, font, spacing) {
  const prev = ctx.font;
  ctx.font = font;
  const w = ctx.measureText(text).width + spacing * Math.max(0, text.length - 1);
  ctx.font = prev;
  return w;
}

function spaced(ctx, text, x, y, spacing, align = 'left') {
  const total = ctx.measureText(text).width + spacing * Math.max(0, text.length - 1);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

function fitSize(ctx, text, fontAt, max, min, maxWidth, spacing = 0) {
  for (let s = max; s > min; s -= 1) {
    if (measureSpaced(ctx, text, fontAt(s), spacing) <= maxWidth) return s;
  }
  return min;
}

/* ── Formatting ───────────────────────────────────────────────────────── */

function fmtTime(d, timeZone, utcOffsetMin = null) {
  if (utcOffsetMin != null) {
    return fmtTime(new Date(d.getTime() + utcOffsetMin * 60000), 'UTC');
  }
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(d);
}
