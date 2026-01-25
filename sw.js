// ===== CACHE VERSION (bump this each deploy) =====
const CACHE_VERSION = "pp-v2026.01.24.4";

const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const AUDIO_CACHE = `${CACHE_VERSION}-audio`;

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png"
];

const AUDIO_ASSETS = [
  "/assets/audio/music_main.mp3",
  "/assets/audio/music_crisis.mp3",
  "/assets/audio/sfx_dispatch.mp3",
  "/assets/audio/sfx_crisis.mp3",
  "/assets/audio/sfx_radio.mp3",
  "/assets/audio/sfx_city.mp3",
  "/assets/audio/sfx_siren.mp3",
  "/assets/audio/sfx_traffic.mp3",
  "/assets/audio/sfx_beep.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await (await caches.open(APP_SHELL_CACHE)).addAll(SHELL_ASSETS);
    await (await caches.open(AUDIO_CACHE)).addAll(AUDIO_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith(CACHE_VERSION) ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const isAudio = (req) => new URL(req.url).pathname.startsWith("/assets/audio/");
const isCoreShellPath = (p) =>
  p === "/" || p === "/index.html" || p === "/app.js" || p === "/styles.css" || p === "/manifest.webmanifest";

async function networkFirst(request, cacheName, fallbackUrl = "/index.html") {
  const cache = await caches.open(cacheName);

  try {
    const fresh = await fetch(request, { cache: "no-store" });

    // Avoid caching/serving redirect responses for navigations
    if (fresh.type !== "opaqueredirect" && fresh.ok) {
      cache.put(request, fresh.clone());
      return fresh;
    }

    // If redirect or not ok, try fetching fallback directly
    const hard = await fetch(fallbackUrl, { cache: "no-store" });
    if (hard.ok) {
      cache.put(fallbackUrl, hard.clone());
      return hard;
    }
  } catch {
    // fall through to cache
  }

  return (await cache.match(request)) || (await cache.match(fallbackUrl)) ||
    new Response("Offline (no cached app shell available)", {
      status: 503,
      headers: { "Content-Type": "text/plain" }
    });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const fresh = await fetch(request);
  if (fresh.ok && fresh.type !== "opaqueredirect") cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (isAudio(req)) {
    event.respondWith(cacheFirst(req, AUDIO_CACHE));
    return;
  }

  // Navigations: always serve /index.html network-first
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(new Request("/index.html"), APP_SHELL_CACHE, "/index.html"));
    return;
  }

  if (isCoreShellPath(url.pathname)) {
    event.respondWith(networkFirst(req, APP_SHELL_CACHE, "/index.html"));
    return;
  }

  event.respondWith((async () => (await caches.match(req)) || fetch(req))());
});
