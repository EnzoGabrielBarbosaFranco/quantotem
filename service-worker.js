const CACHE_NAME = "quanto-tem-shell-v7";
const APP_SHELL = ["/", "/index.html", "/style.css?v=5", "/script.js?v=6", "/reports.js?v=2", "/favicon.svg", "/quantotem-simbolo.svg", "/manifest.webmanifest", "/vendor/jspdf.umd.min.js", "/vendor/jspdf.plugin.autotable.min.js", "/assets/fonts/NotoSans-Regular.ttf", "/assets/fonts/NotoSans-Bold.ttf"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {}));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return request.mode === "navigate" ? caches.match("/index.html") : Response.error();
  }));
});
