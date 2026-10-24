// On-device gallery of Aera photos (IndexedDB). Nothing is uploaded.
// Three stores, so the grid loads small thumbnails without pulling big files:
//   meta:     { id, createdAt, aqi, scene, thumb: Blob, edit }  (edit = crop, strip, reading…)
//   full:     { id, blob: Blob, name }   the finished JPEG, exactly as shared
//   original: { id, blob: Blob }         the untouched photo, so the edit can be reopened
// Photos saved before v2 have no original/edit and stay view-only.

const DB_NAME = 'aera';
const DB_VERSION = 2;
const THUMB_W = 270, THUMB_H = 480;

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        if (!d.objectStoreNames.contains('full')) d.createObjectStore('full', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('original')) d.createObjectStore('original', { keyPath: 'id' });
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

/**
 * Save or replace a photo. `canvas` is the composed image; `blob` its exported JPEG.
 * `original` (the untouched photo) is written only when given, i.e. once per photo.
 */
export async function savePhoto({ id, createdAt, aqi, scene, canvas, blob, name, edit = null, original = null }) {
  const thumb = await makeThumb(canvas);
  const stores = original ? ['meta', 'full', 'original'] : ['meta', 'full'];
  await tx(stores, 'readwrite', (t) => {
    t.objectStore('meta').put({ id, createdAt: +createdAt, aqi, scene, thumb, edit });
    t.objectStore('full').put({ id, blob, name });
    if (original) t.objectStore('original').put({ id, blob: original });
  });
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict the gallery
}

/** Newest first; thumbnails + edit state only. */
export function listPhotos() {
  return tx(['meta'], 'readonly', (t) => t.objectStore('meta').getAll())
    .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
}

/** @returns {Promise<{id, blob: Blob, name: string}|null>} the finished JPEG */
export function getPhoto(id) {
  return tx(['full'], 'readonly', (t) => t.objectStore('full').get(id)).then((row) => row ?? null);
}

/** @returns {Promise<{meta: object, original: Blob}|null>} everything needed to reopen the edit */
export async function getEditable(id) {
  const [meta, orig] = await Promise.all([
    tx(['meta'], 'readonly', (t) => t.objectStore('meta').get(id)),
    tx(['original'], 'readonly', (t) => t.objectStore('original').get(id)),
  ]);
  return meta?.edit && orig?.blob ? { meta, original: orig.blob } : null;
}

export function deletePhoto(id) {
  return tx(['meta', 'full', 'original'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id);
    t.objectStore('full').delete(id);
    t.objectStore('original').delete(id);
  });
}

function makeThumb(canvas) {
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  c.getContext('2d').drawImage(canvas, 0, 0, THUMB_W, THUMB_H);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.75));
}
