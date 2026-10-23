// Where a photo was taken, and what kind of place that is.
// GPS is read from EXIF on-device; only rounded coordinates go to /api/scene.

import * as exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs';

/** @returns {Promise<{lat:number, lon:number}|null>} */
export async function photoGps(src) {
  try {
    const gps = await exifr.gps(src);
    return gps?.latitude != null ? { lat: gps.latitude, lon: gps.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * When the photo was taken (EXIF DateTimeOriginal) and the UTC offset of the place,
 * so TIME shows the local clock where it was taken. Returns null when absent.
 * @returns {Promise<{at: Date, utcOffsetMin: number|null}|null>}
 */
export async function photoTakenAt(src) {
  try {
    const tags = await exifr.parse(src);
    const at = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (!(at instanceof Date) || Number.isNaN(+at)) return null;
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(tags.OffsetTimeOriginal ?? tags.OffsetTime ?? '');
    return { at, utcOffsetMin: m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null };
  } catch {
    return null;
  }
}

/** @returns {Promise<{scene:string|null, signals?:object}>} */
export async function fetchScene({ lat, lon }) {
  try {
    const res = await fetch(`api/scene?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
    return await res.json();
  } catch {
    return { scene: null };
  }
}
