// On-device gallery of finished Aera photos (IndexedDB). Nothing is uploaded.
// Two stores so the grid loads small thumbnails without pulling every full image:
//   meta: { id, createdAt, aqi, scene, thumb: Blob }
//   full: { id, blob: Blob, name }  (the 1080×1920 JPEG, exactly as shared)

const DB_NAME = 'aera';
const DB_VERSION = 1;
const THUMB_W = 270, THUMB_H = 480;

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('meta', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        d.createObjectStore('full', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function tx(stores, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Save or replace a photo. `canvas` is the composed image; `blob` its exported JPEG. */
export async function savePhoto({ id, createdAt, aqi, scene, canvas, blob, name }) {
  const thumb = await makeThumb(canvas);
  await tx(['meta', 'full'], 'readwrite', (t) => {
    t.objectStore('meta').put({ id, createdAt: +createdAt, aqi, scene, thumb });
    t.objectStore('full').put({ id, blob, name });
  });
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict the gallery
}

/** Newest first; thumbnails only. */
export function listPhotos() {
  return tx(['meta'], 'readonly', (t) => t.objectStore('meta').getAll())
    .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
}

/** @returns {Promise<{id, blob: Blob, name: string}|null>} */
export function getPhoto(id) {
  return tx(['full'], 'readonly', (t) => t.objectStore('full').get(id)).then((row) => row ?? null);
}

export function deletePhoto(id) {
  return tx(['meta', 'full'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id);
    t.objectStore('full').delete(id);
  });
}

function makeThumb(canvas) {
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  c.getContext('2d').drawImage(canvas, 0, 0, THUMB_W, THUMB_H);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.75));
}
