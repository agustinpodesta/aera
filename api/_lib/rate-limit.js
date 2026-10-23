// In-memory burst limiter keyed by IP (per warm serverless instance).
// Free and good enough to stop floods; swap for Upstash/Vercel KV if traffic grows.

const WINDOW_MS = 10_000;
const MAX_HITS = 12;
const hits = new Map();

export function checkBurst(req) {
  const ip = getClientIp(req);
  if (!ip) return true;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 1000) {
    for (const [key, times] of hits) if (times.every((t) => now - t > WINDOW_MS)) hits.delete(key);
  }
  return recent.length <= MAX_HITS;
}

function getClientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null;
}
