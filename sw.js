const CACHE_VERSION = "pp-companion-v2"; // bump each deploy

const CACHE_ASSETS = [
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",

  // Audio (small files -> cache them)
  "/assets/audio/music_main.mp3",
  "/assets/audio/music_crisis.mp3",
  "/assets/audio/sfx_dispatch.mp3",
  "/assets/audio/sfx_crisis.mp3",
  "/assets/audio/sfx_city.mp3",
  "/assets/audio/sfx_radio.mp3",
  "/assets/audio/sfx_beep.mp3",
  "/assets/audio/sfx_traffic.mp3",
  "/assets/audio/sfx_siren.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

// Cache-first with network fallback
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((resp) => {
        // Cache successful, non-redirect responses
        if (resp && resp.ok && resp.type !== "opaqueredirect") {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return resp;
      });
    })
  );
});
