// Aera service worker. Its one job for now: receive photos shared to Aera from other
// apps ("Share → Aera", Android only, once Aera is installed). The files are parked in
// a cache on this device, then the page picks them up. Nothing is uploaded.
// While we test whether shared photos keep their GPS, shares open the location lab.

const SHARE_CACHE = 'aera-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'POST' || url.pathname !== '/share-target') return; // everything else: network as usual
  e.respondWith((async () => {
    const files = (await e.request.formData()).getAll('photos').filter((f) => f instanceof File);
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
    await Promise.all(files.map((f, i) => cache.put(`/shared/${i}`, new Response(f, {
      headers: {
        'content-type': f.type || 'application/octet-stream',
        'x-name': encodeURIComponent(f.name),
        'x-modified': String(f.lastModified),
      },
    }))));
    return Response.redirect(`/lab.html?shared=${files.length}`, 303);
  })());
});
