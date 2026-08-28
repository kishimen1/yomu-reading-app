const CACHE_NAME = "yomu-shell-v4";
const CORE_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/lucide.min.js",
  "./assets/app-icon.png",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png",
  "./assets/book-cover-sprite.png"
];

const BUILD_SHELL_CANDIDATES = [
  "./src/main.ts",
  "./src/styles.css",
  "./assets/app.js",
  "./assets/styles.css"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(CORE_SHELL);
      await Promise.allSettled(BUILD_SHELL_CANDIDATES.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response.ok || response.type === "opaque") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()));
      return cached || network;
    })
  );
});
