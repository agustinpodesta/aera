// Home background: short trip clips (media/home/NN.mp4, ~4 s, silent, portrait) that
// crossfade in a random order. The first clip's still shows at once; only the next clip
// loads in the background. Reduced motion or data saver → one still, no video.
// Plays only while the home screen is visible.

const CLIPS = 12;
const FADE_BEFORE_END = 0.9; // seconds: start the next clip this long before the current ends
const STILL_MS = 4200;        // when video can't autoplay, stills rotate at the clip pace

const pad = (n) => String(n).padStart(2, '0');
const clipUrl = (n) => `media/home/${pad(n)}.mp4`;
const stillUrl = (n) => `media/home/${pad(n)}.jpg`;

function shuffled() {
  const a = Array.from({ length: CLIPS }, (_, i) => i + 1);
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
  let front = a, back = b;  // front = visible video
  let active = false, stillsTimer = 0, videoOk = true;

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

  function swap() {
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
    }).catch(fallBackToStills);
  }

  function onTime() {
    if (!active || this !== front || !this.duration) return;
    if (this.currentTime >= this.duration - FADE_BEFORE_END && !this.dataset.handedOff) {
      this.dataset.handedOff = '1';
      swap();
    }
  }

  for (const v of [a, b]) {
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', () => { delete v.dataset.handedOff; });
    v.addEventListener('ended', () => { if (v === front && !v.dataset.handedOff) { v.dataset.handedOff = '1'; swap(); } });
  }

  // Low-power mode (iOS) or a blocked autoplay: rotate the stills instead.
  function fallBackToStills() {
    if (!videoOk) return;
    videoOk = false;
    a.classList.remove('on');
    b.classList.remove('on');
    still.classList.add('on');
    if (active) rotateStills();
  }

  function rotateStills() {
    clearInterval(stillsTimer);
    stillsTimer = setInterval(() => {
      at = (at + 1) % order.length;
      const img = new Image();
      img.onload = () => { still.src = img.src; };
      img.src = stillUrl(order[at]);
    }, STILL_MS);
  }

  load(front, order[0]);
  load(back, next(0));

  function setActive(on) {
    if (on === active) return;
    active = on;
    if (!on) {
      clearInterval(stillsTimer);
      a.pause();
      b.pause();
      return;
    }
    if (!videoOk) return rotateStills();
    front.play().then(() => {
      front.classList.add('on');
      setTimeout(() => still.classList.remove('on'), 1000); // the still hides once the clip is up
    }).catch(fallBackToStills);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { a.pause(); b.pause(); clearInterval(stillsTimer); }
    else if (active) { active = false; setActive(true); }
  });

  return { setActive };
}
