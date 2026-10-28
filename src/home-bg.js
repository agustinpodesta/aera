// Home background: short trip clips (media/home/NN.mp4, ~4 s, silent, portrait) that
// crossfade in a random order. The first clip's still shows at once; only the next clip
// loads in the background. Plays only while the home screen is visible.
//
// Phones stop background video in many ways: play() refused for a moment (back from the
// picker or camera), a clip frozen on one frame after the app was in the background, a
// load that stalls. So a watchdog checks every 1.5 s that new frames are really being
// drawn, and climbs a ladder until they are: resume → reload the clip → next clip. It
// never gives up while home is showing; stills cover the gap. Reduced motion → a still.

const CLIPS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]; // 09 dropped (readable car plates)
const FADE_BEFORE_END = 0.9; // seconds: start the next clip this long before the current ends
const STILL_MS = 4200;       // stills rotate at the clip pace while video is held up
const CHECK_MS = 1500;       // watchdog period
const LOAD_GRACE_MS = 8000;  // a clip still downloading gets this long before it's skipped

const pad = (n) => String(n).padStart(2, '0');
const clipUrl = (n) => `media/home/${pad(n)}.mp4`;
const stillUrl = (n) => `media/home/${pad(n)}.jpg`;

function shuffled() {
  const a = [...CLIPS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function homeBackground(root) {
  const [a, b] = root.querySelectorAll('video');
  const still = root.querySelector('img');
  const order = shuffled();
  let at = 0;               // index in `order` of the clip on screen
  let front = a, back = b;  // front = the visible video
  let active = false;       // home screen showing
  let stillsTimer = 0, checkTimer = 0, swapping = false;
  let strikes = 0, loadingFor = 0, lastTime = -1, refusedByPolicy = false;
  const frames = new WeakMap(); // video → frames drawn since the last check

  still.src = stillUrl(order[0]);
  still.classList.add('on');
  // Reduced motion (an accessibility setting) gets a still, by design.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { setActive() {} };

  const next = (i) => order[(i + 1) % order.length];
  const running = () => active && !document.hidden;

  for (const v of [a, b]) {
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    frames.set(v, 0);
    // Count frames actually painted: a "playing" video can still be frozen on screen.
    if (v.requestVideoFrameCallback) {
      const tick = () => { frames.set(v, frames.get(v) + 1); v.requestVideoFrameCallback(tick); };
      v.requestVideoFrameCallback(tick);
    }
  }
  const countsFrames = typeof a.requestVideoFrameCallback === 'function';

  function load(video, n) {
    video.src = clipUrl(n);
    video.load();
  }

  /* ── Stills: cover any gap, never a final state ── */
  function showStills() {
    if (stillsTimer) return;
    let k = at;
    still.src = stillUrl(order[k]);
    still.classList.add('on');
    stillsTimer = setInterval(() => {
      if (!running()) return;
      k = (k + 1) % order.length;
      const img = new Image();
      img.onload = () => { still.src = img.src; };
      img.src = stillUrl(order[k]);
    }, STILL_MS);
  }

  function hideStills() {
    clearInterval(stillsTimer);
    stillsTimer = 0;
    setTimeout(() => { if (front.classList.contains('on') && !front.paused) still.classList.remove('on'); }, 1000);
  }

  /* ── Playing ── */
  function play() {
    if (!running()) return;
    if (!front.src.endsWith(clipUrl(order[at]))) { load(front, order[at]); load(back, next(at)); }
    front.play().then(() => {
      refusedByPolicy = false;
      front.classList.add('on');
      back.classList.remove('on');
    }).catch((err) => {
      refusedByPolicy = err?.name === 'NotAllowedError';
      if (running()) showStills();
    });
  }

  function swap() {
    if (swapping || !running()) return;
    swapping = true;
    const incoming = back;
    incoming.currentTime = 0;
    incoming.play().then(() => {
      at = (at + 1) % order.length;
      incoming.classList.add('on');
      front.classList.remove('on');
      const outgoing = front;
      front = incoming;
      back = outgoing;
      lastTime = -1;
      // After the fade, the old clip makes room for the one after next.
      setTimeout(() => { if (back === outgoing) { outgoing.pause(); load(outgoing, next(at)); } }, 1200);
    }).catch(() => {
      // The next clip won't start: replay this one; the watchdog takes it from there.
      delete front.dataset.handedOff;
      front.currentTime = 0;
      play();
    }).finally(() => { swapping = false; });
  }

  // Skip to the clip after this one (the current one won't play).
  function skip() {
    at = (at + 1) % order.length;
    front.classList.remove('on');
    load(front, order[at]);
    load(back, next(at));
    lastTime = -1;
    play();
  }

  function onTime() {
    if (!running() || this !== front || !this.duration) return;
    if (this.currentTime >= this.duration - FADE_BEFORE_END && !this.dataset.handedOff) {
      this.dataset.handedOff = '1';
      swap();
    }
  }

  for (const v of [a, b]) {
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', () => { delete v.dataset.handedOff; });
    v.addEventListener('ended', () => {
      if (v !== front) return;
      if (!v.dataset.handedOff) { v.dataset.handedOff = '1'; swap(); }
      else if (!swapping) { delete v.dataset.handedOff; v.currentTime = 0; play(); }
    });
    v.addEventListener('error', () => { if (v === front && running()) skip(); });
  }

  /* ── Watchdog: are new frames really reaching the screen? ── */
  function check() {
    if (!running() || swapping) return;
    const v = front;
    const drawn = frames.get(v);
    frames.set(v, 0);
    const advanced = v.currentTime !== lastTime;
    lastTime = v.currentTime;
    const healthy = !v.paused && advanced && (!countsFrames || drawn > 0) && v.classList.contains('on');
    if (healthy) {
      strikes = 0;
      loadingFor = 0;
      if (stillsTimer) hideStills();
      return;
    }
    // Still downloading: give it time before calling it stuck.
    if (v.readyState < 3 && v.networkState === 2 && loadingFor < LOAD_GRACE_MS) { loadingFor += CHECK_MS; return; }
    loadingFor = 0;
    if (!stillsTimer && !v.classList.contains('on')) showStills();
    // Autoplay refused by the browser: keep asking gently (a tap also unlocks it).
    if (refusedByPolicy) { play(); return; }
    strikes++;
    if (strikes === 1) play();                                       // resume
    else if (strikes === 2) { load(v, order[at]); lastTime = -1; play(); } // reload this clip
    else { strikes = 0; skip(); }                                     // move on
  }

  function startWatching() {
    clearInterval(checkTimer);
    strikes = 0;
    lastTime = -1;
    checkTimer = setInterval(check, CHECK_MS);
  }

  function pauseAll() {
    clearInterval(checkTimer);
    checkTimer = 0;
    clearInterval(stillsTimer);
    stillsTimer = 0;
    a.pause();
    b.pause();
  }

  function resume() {
    if (!running()) return;
    play();
    startWatching();
  }

  load(front, order[0]);
  load(back, next(0));

  function setActive(on) {
    if (on === active) return;
    active = on;
    if (on) resume(); else pauseAll();
  }

  // Every way back to the page restarts playback and the watchdog.
  document.addEventListener('visibilitychange', () => (document.hidden ? pauseAll() : resume()));
  addEventListener('pageshow', resume);
  addEventListener('focus', resume);
  addEventListener('online', resume);
  // A tap counts as permission to play for browsers that held back autoplay.
  document.addEventListener('pointerdown', () => { if (running() && (front.paused || stillsTimer)) play(); }, { passive: true });

  return { setActive };
}
