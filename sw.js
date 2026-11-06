// Turbo Overdose Service Worker
// 策略：自家檔案「網路優先」（有網路時永遠拿最新版，推上 main 後下次開啟就是新版），沒網路才用快取；
// CDN 上有版本號的檔案（three.js、字型、Firebase SDK）「快取優先」，離線也能玩單機模式。
const CACHE = 'turbo-overdose-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'game.js', 'pwa.js', 'car.js', 'city.js', 'data.js', 'fx.js', 'icons.js', 'music.js', 'net.js',
  'openworld.js', 'physics.js', 'tracks.js', 'firebase-config.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const CDN = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', e => {
  // 單一檔案失敗不該讓整個安裝失敗，所以逐個 add
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' });   // 向伺服器驗證，避免吃到 10 分鐘的瀏覽器快取
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : Response.error());
      }
    })());
  } else if (CDN.includes(url.hostname) && (url.hostname !== 'www.gstatic.com' || url.pathname.startsWith('/firebasejs/'))) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
  }
});
