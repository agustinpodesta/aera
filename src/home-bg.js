// Home background: short trip clips (media/home/NN.mp4, ~4 s, silent, portrait) that
// crossfade in a random order. The first clip's still shows at once; only the next clip
// loads in the background. Reduced motion or data saver → one still, no video.
// Plays only while the home screen is visible.
//
// Phones sometimes refuse play() for a moment (coming back from the photo picker or
// the camera, a load still in flight, low-power mode). That is never final: Aera shows
// stills meanwhile and tries the video again shortly, when the page is shown again,
// or on the next tap.

const CLIPS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]; // 09 dropped (readable car plates)
const FADE_BEFORE_END = 0.9; // seconds: start the next clip this long before the current ends
const STILL_MS = 4200;        // stills rotate at the clip pace while video is refused
const RETRY_MS = [400, 1500, 4000]; // quick retries before waiting for a tap or a return

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
  let stillsTimer = 0, retryTimer = 0, retries = 0, swapping = false;

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData === true;
  const next = (i) => order[(i + 1) % order.length];

  still.src = stillUrl(order[0]);
  still.classList.add('on');
  if (calm) return { setActive() {} };

  for (const v of [a, b]) {
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
  }

  function load(video, n) {
    video.src = clipUrl(n);
    video.load();
  }

  const running = () => active && !document.hidden;

  /* ── Stills: shown while the video is refused, never as a final state ── */
  function showStills() {
    still.src = stillUrl(order[at]);
    still.classList.add('on');
    a.classList.remove('on');
    b.classList.remove('on');
    clearInterval(stillsTimer);
    stillsTimer = setInterval(() => {
      if (!running()) return;
      at = (at + 1) % order.length;
      const img = new Image();
      img.onload = () => { still.src = img.src; };
      img.src = stillUrl(order[at]);
    }, STILL_MS);
  }

  function hideStills() {
    clearInterval(stillsTimer);
    stillsTimer = 0;
    setTimeout(() => { if (front.classList.contains('on')) still.classList.remove('on'); }, 1000);
  }

  /* ── Playing ── */
  function play() {
    clearTimeout(retryTimer);
    if (!running()) return;
    // After stills moved on, start from the clip they reached.
    if (!front.src.endsWith(clipUrl(order[at]))) { load(front, order[at]); load(back, next(at)); }
    front.play().then(() => {
      retries = 0;
      front.classList.add('on');
      hideStills();
    }).catch(refused);
  }

  function refused() {
    if (!running()) return;
    if (!stillsTimer) showStills();
    if (retries < RETRY_MS.length) retryTimer = setTimeout(play, RETRY_MS[retries++]);
    // Past the quick retries: the next tap, or the next return to the page, tries again.
  }

  function swap() {
    if (swapping || !running()) return;
    swapping = true;
    at = (at + 1) % order.length;
    const incoming = back;
    incoming.currentTime = 0;
    incoming.play().then(() => {
      incoming.classList.add('on');
      front.classList.remove('on');
      const outgoing = front;
      front = incoming;
      back = outgoing;
      // After the fade, the old clip makes room for the one after next.
      setTimeout(() => { if (back === outgoing) { outgoing.pause(); load(outgoing, next(at)); } }, 1200);
    }).catch(() => {
      at = (at - 1 + order.length) % order.length; // keep showing what we had
      refused();
    }).finally(() => { swapping = false; });
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
      else if (!swapping) { delete v.dataset.handedOff; v.currentTime = 0; play(); } // a swap failed: loop this one
    });
  }

  load(front, order[0]);
  load(back, next(0));

  function pauseAll() {
    clearTimeout(retryTimer);
    clearInterval(stillsTimer);
    if (stillsTimer) stillsTimer = 0;
    a.pause();
    b.pause();
  }

  function setActive(on) {
    if (on === active) return;
    active = on;
    retries = 0;
    if (on) play(); else pauseAll();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAll();
    else { retries = 0; play(); }
  });
  // A tap counts as permission to play for browsers that held back autoplay.
  document.addEventListener('pointerdown', () => {
    if (running() && (front.paused || stillsTimer)) { retries = 0; play(); }
  }, { passive: true });

  return { setActive };
}
