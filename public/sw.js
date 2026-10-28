// sw.js — two jobs, both optional for the app to work:
//  1. Notifications (Web Push): shows "your video is ready", fetches that video ahead (so it plays the
//     moment the notification is tapped), and opens that exact video in Review.
//  2. Offline review: the app's own files are kept so it opens with no connection, and when the agent
//     taps "Save for offline" in Review, the videos waiting for review (and the lists they need) are
//     kept too. Nothing personal is cached unless they asked; logging out clears it.
const SHELL = 'shell-v1', MEDIA = 'media-v1', DATA = 'offline-v1', PRELOAD = 'preload-v1';
const SHELL_PATHS = ['/', '/index.html', '/app.js', '/screens/account.js', '/screens/admin.js', '/screens/brand.js', '/screens/coach.js', '/screens/communicate.js', '/screens/content.js', '/screens/create.js', '/screens/mindset.js', '/screens/review.js', '/screens/settings.js', '/screens/signoff.js', '/screens/replies.js', '/screens/grow.js', '/screens/guide.js', '/screens/steps.js', '/screens/setup.js', '/screens/studio.js', '/screens/team.js', '/mixer-core.js', '/comms-core.js', '/mindset-core.js', '/niches/index.js', '/niches/life-insurance.js', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];
const DATA_PATHS = ['/api/me', '/api/videos', '/api/config'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(m.title || 'A video is ready', {
      body: m.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: m.tag || undefined,
      ...(m.image ? { image: m.image } : {}), data: { url: m.url || '/#/review' },
    }),
    m.media ? preload(m.media) : null,
  ]));
});
// A video fetched ahead into the preload cache (at most 3 kept; the page keeps only those still waiting).
// Nothing is fetched ahead on a data saver or a slow (2G) connection.
const thrifty = () => { const c = self.navigator?.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))); };
async function preload(path) {
  try {
    if (!/^\/media\/video_[\w-]+\.mp4$/.test(path) || thrifty()) return;
    const cache = await caches.open(PRELOAD);
    if (await cache.match(path)) return;
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok || Number(res.headers.get('content-length') || 0) > 60e6) return;
    await cache.put(path, res);
    const keys = (await cache.keys()).filter(k => new URL(k.url).pathname !== path);
    for (const k of keys.slice(0, Math.max(0, keys.length - 2))) await cache.delete(k);
  } catch { /* it plays from the network instead */ }
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/#/review', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const open = list.find(c => new URL(c.url).origin === self.location.origin);
    if (!open) return self.clients.openWindow(url);
    // Brought to the front first (browsers only allow it right after the tap), then asked to switch screens
    // itself (no reload); one that doesn't answer is sent there instead.
    await open.focus().catch(() => {});
    const answered = await new Promise(resolve => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(false), 600);
      ch.port1.onmessage = () => { clearTimeout(t); resolve(true); };
      try { open.postMessage({ type: 'open', url }, [ch.port2]); } catch { clearTimeout(t); resolve(false); }
    });
    if (!answered) await open.navigate(url).catch(() => {});
  }));
});

self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin) return;
  if (u.pathname.startsWith('/media/')) return e.respondWith(media(req, u.pathname));
  if (SHELL_PATHS.includes(u.pathname)) return e.respondWith(networkFirst(req, SHELL, true));
  if (DATA_PATHS.includes(u.pathname)) return e.respondWith(networkFirst(req, DATA, false));
});

// The network when it answers; the kept copy when it doesn't. `always`: keep a fresh copy every time
// (the app's own files); otherwise only refresh a copy the agent chose to keep.
async function networkFirst(req, name, always) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    // Logged out (or the session ended): nothing personal stays on the device.
    if (res.status === 401 && !always) { await Promise.all([caches.delete(DATA), caches.delete(MEDIA), caches.delete(PRELOAD)]); return res; }
    if (res.ok && (always || await cache.match(req, { ignoreSearch: true }))) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
// Saved videos play offline, including the byte ranges video players ask for.
async function media(req, pathname) {
  const hit = (await (await caches.open(MEDIA)).match(pathname)) || (await (await caches.open(PRELOAD)).match(pathname));
  if (!hit) return fetch(req);
  const range = req.headers.get('range');
  if (!range) return hit;
  // (A slice of the kept file, not the whole file read into memory for every range a player asks for.)
  const blob = await hit.blob(), n = blob.size, m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? Number(m[1]) : m[2] ? Math.max(0, n - Number(m[2])) : 0;
  let end = m[1] && m[2] ? Number(m[2]) : n - 1;
  if (start >= n) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${n}` } });
  end = Math.min(end, n - 1);
  return new Response(blob.slice(start, end + 1), { status: 206, headers: { 'Content-Type': hit.headers.get('Content-Type') || 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${n}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
