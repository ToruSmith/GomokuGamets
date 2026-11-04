// 離線快取。版本號與資源清單由 scripts/build.mjs 在建置時填入。
const CACHE = 'gomoku-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('gomoku-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 頁面走網路優先，確保部署後拿到新版；離線才用快取
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }

  // 帶雜湊的資源永遠不變，可以快取優先
  if (url.origin === location.origin) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
    return;
  }

  // 字型下載過一次後離線也能用；Firebase 等其他跨網域請求不攔截
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') void cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
