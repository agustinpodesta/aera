// Local dev server: static files + /api/* handlers with a Vercel-style req/res,
// so the app runs without `vercel dev` (no login or project link needed).
//   node dev-server.mjs            → http://localhost:8120

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Load .env.local (e.g. IQAIR_API_KEY, via `vercel env pull .env.local`) like Vercel does.
try {
  for (const line of (await readFile(join(ROOT, '.env.local'), 'utf8')).split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* no .env.local: APIs fall back to keyless sources */ }
const PORT = Number(process.env.PORT) || 8120;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain',
};

async function api(req, res, url) {
  const name = url.pathname.slice('/api/'.length).replace(/\/$/, '');
  if (!/^[a-z0-9-]+$/.test(name)) return send(res, 404, 'Not found');
  let handler;
  try {
    // Cache-bust so edits to api/ apply without restarting (shared _lib modules still cache).
    const file = join(ROOT, 'api', `${name}.js`);
    handler = (await import(`${pathToFileURL(file).href}?v=${(await stat(file)).mtimeMs}`)).default;
  } catch {
    return send(res, 404, 'Not found');
  }
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
  res.send = (body) => { res.end(body); return res; };
  try { await handler(req, res); } catch (err) { console.error(err); if (!res.headersSent) send(res, 500, 'Server error'); }
}

async function file(res, url) {
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length, // fixed length: avoids flaky chunked transfers of large photos
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain' });
  res.end(text);
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return url.pathname.startsWith('/api/') ? api(req, res, url) : file(res, url);
}).listen(PORT, () => console.log(`Aera dev server → http://localhost:${PORT}`));
