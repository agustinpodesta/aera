// Minimal line icons for where a photo was taken — Aera's answer to Strava's
// shoe/bike glyph. Each draws in a 100×100 box with the current strokeStyle.

const path = (ctx, pts, close = false) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
  ctx.stroke();
};

const wave = (ctx, x0, x1, y, amp = 4, len = 14) => {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  for (let x = x0; x < x1; x += len) {
    ctx.quadraticCurveTo(x + len / 4, y - amp, x + len / 2, y);
    ctx.quadraticCurveTo(x + (3 * len) / 4, y + amp, x + len, y);
  }
  ctx.stroke();
};

const pine = (ctx, cx, top, h, w) => {
  const tier = h / 3;
  path(ctx, [
    [cx, top],
    [cx - w * 0.3, top + tier], [cx - w * 0.18, top + tier],
    [cx - w * 0.42, top + tier * 2], [cx - w * 0.28, top + tier * 2],
    [cx - w * 0.5, top + h], [cx + w * 0.5, top + h],
    [cx + w * 0.28, top + tier * 2], [cx + w * 0.42, top + tier * 2],
    [cx + w * 0.18, top + tier], [cx + w * 0.3, top + tier],
  ], true);
  path(ctx, [[cx, top + h], [cx, top + h + 9]]);
};

export const SCENES = {
  city: {
    label: 'City',
    draw(ctx) {
      path(ctx, [[54, 92], [54, 26], [80, 26], [80, 92]]);          // tower
      path(ctx, [[60, 26], [60, 18], [74, 18], [74, 26]]);          // crown
      path(ctx, [[67, 18], [67, 7]]);                               // antenna
      for (const x of [61, 67, 73]) path(ctx, [[x, 34], [x, 84]]);  // tower windows
      path(ctx, [[24, 92], [24, 44], [54, 60]]);                    // slanted block
      for (const y of [62, 70, 78, 86]) path(ctx, [[30, y], [48, y]]);
      path(ctx, [[14, 92], [88, 92]]);                              // ground
    },
  },
  neighborhood: {
    label: 'Neighborhood',
    draw(ctx) {
      path(ctx, [[8, 90], [8, 60], [26, 48], [44, 60], [44, 90]]);   // house 1
      path(ctx, [[21, 90], [21, 76], [31, 76], [31, 90]]);
      path(ctx, [[60, 90], [60, 64], [76, 53], [92, 64], [92, 90]]); // house 2
      path(ctx, [[71, 90], [71, 78], [81, 78], [81, 90]]);
      ctx.beginPath(); ctx.ellipse(52, 56, 7, 15, 0, 0, Math.PI * 2); ctx.stroke(); // tree
      path(ctx, [[52, 64], [52, 90]]);
      path(ctx, [[4, 90], [96, 90]]);
    },
  },
  coast: {
    label: 'Coast',
    draw(ctx) {
      ctx.beginPath(); ctx.arc(36, 64, 20, Math.PI, 0); ctx.stroke(); // setting sun
      path(ctx, [[70, 64], [72, 46], [70, 28]]);                      // palm trunk
      ctx.beginPath(); ctx.moveTo(70, 28); ctx.quadraticCurveTo(58, 20, 50, 28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(70, 28); ctx.quadraticCurveTo(82, 18, 92, 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(70, 28); ctx.quadraticCurveTo(66, 16, 74, 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(70, 28); ctx.quadraticCurveTo(84, 32, 86, 42); ctx.stroke();
      wave(ctx, 8, 92, 72);
      wave(ctx, 14, 86, 84);
    },
  },
  countryside: {
    label: 'Countryside',
    draw(ctx) {
      ctx.beginPath(); ctx.arc(72, 30, 9, 0, Math.PI * 2); ctx.stroke();            // sun
      ctx.beginPath(); ctx.moveTo(4, 66); ctx.quadraticCurveTo(34, 40, 64, 64); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(40, 70); ctx.quadraticCurveTo(70, 50, 96, 66); ctx.stroke();
      for (const x of [16, 32, 48, 64, 80]) path(ctx, [[x, 78], [x, 92]]);          // fence
      path(ctx, [[10, 82], [86, 82]]);
      path(ctx, [[10, 88], [86, 88]]);
    },
  },
  mountains: {
    label: 'Mountains',
    draw(ctx) {
      path(ctx, [[8, 84], [36, 30], [54, 62]]);
      path(ctx, [[44, 46], [64, 10], [92, 76]]);
      wave(ctx, 55, 75, 30, 3, 10);                                 // snowline
      wave(ctx, 27, 45, 48, 3, 9);
      ctx.beginPath(); ctx.moveTo(4, 90); ctx.quadraticCurveTo(50, 66, 96, 90); ctx.stroke();
    },
  },
  forest: {
    label: 'Forest',
    draw(ctx) {
      pine(ctx, 50, 8, 70, 40);
      pine(ctx, 26, 30, 52, 32);
      pine(ctx, 74, 30, 52, 32);
    },
  },
};

export function drawScene(ctx, id, cx, top, size) {
  const scene = SCENES[id];
  if (!scene) return;
  ctx.save();
  ctx.translate(cx - size / 2, top);
  ctx.scale(size / 100, size / 100);
  ctx.lineWidth = 4.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  scene.draw(ctx);
  ctx.restore();
}
