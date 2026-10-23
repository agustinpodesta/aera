// Live camera via getUserMedia. Rear camera preferred; the stream is always
// stopped when not on screen so the camera light never stays on.

let stream = null;

/**
 * Start the camera into a <video>. Throws DOMException-style errors:
 * NotAllowedError (denied), NotFoundError (no camera), NotSupportedError (no API / insecure page).
 * @returns {Promise<{mirrored: boolean}>}
 */
export async function startCamera(video) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Camera API unavailable'), { name: 'NotSupportedError' });
  }
  stopCamera(video);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  // Laptops and selfie cameras report "user" (or nothing): mirror those so the preview feels natural.
  const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
  return { mirrored: facing !== 'environment' };
}

export function stopCamera(video) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

export const cameraRunning = () => !!stream;

/** Freeze the current frame at full sensor resolution, as seen in the preview. */
export function captureFrame(video, mirrored) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  if (mirrored) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0);
  return c;
}
