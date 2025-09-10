const CACHE = "fep-cache-v4";
const ASSETS = ["./","./index.html","./manifest.json","./icon-192.png","./icon-512.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  clients.claim();
  e.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request)
            .then(res => {
              cache.put(e.request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});
