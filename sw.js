// ===== CACHE VERSION (bump this each deploy) =====
const CACHE_VERSION = "pp-v2026.01.24.1";

const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const AUDIO_CACHE = `${CACHE_VERSION}-audio`;

// App shell: cache for offline, but prefer NETWORK so updates are instant
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

// Audio: cache-first, and we pre-cache so offline works immediately after first visit
const AUDIO_ASSETS = [
  "./assets/audio/music_main.mp3",
  "./assets/audio/music_crisis.mp3",
  "./assets/audio/sfx_dispatch.mp3",
  "./assets/audio/sfx_crisis.mp3",
  "./assets/audio/sfx_radio.mp3",
  "./assets/audio/sfx_city.mp3",
  "./assets/audio/sfx_siren.mp3",
  "./assets/audio/sfx_traffic.mp3",
  "./assets/audio/sfx_beep.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(APP_SHELL_CACHE);
    await shell.addAll(SHELL_ASSETS);

    const audio = await caches.open(AUDIO_CACHE);
    await audio.addAll(AUDIO_ASSETS);

    // Install completes; activation can be forced by SKIP_WAITING message
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (!k.startsWith(CACHE_VERSION)) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

// Allow the page to tell SW to activate immediately
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isAudioRequest(req) {
  const url = new URL(req.url);
  return url.pathname.includes("/assets/audio/");
}

function isShellRequest(req) {
  const url = new URL(req.url);

  // Navigations should be network-first (loads newest index.html)
  if (req.mode === "navigate") return true;

  // Core assets should be network-first for instant updates
  return (
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/manifest.webmanifest")
  );
}

// Network-first (instant updates; offline fallback to cache)
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw new Error("Network and cache both failed");
  }
}

// Cache-first (fast + offline-friendly; ideal for audio)
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  // Audio: cache-first
  if (isAudioRequest(req)) {
    event.respondWith(cacheFirst(req, AUDIO_CACHE));
    return;
  }

  // App shell: network-first (instant updates)
  if (isShellRequest(req)) {
    if (req.mode === "navigate") {
      event.respondWith(networkFirst("./index.html", APP_SHELL_CACHE));
      return;
    }
    event.respondWith(networkFirst(req, APP_SHELL_CACHE));
    return;
  }

  // Other assets: try cache then network
  event.respondWith((async () => {
    const cached = await caches.match(req);
    return cached || fetch(req);
  })());
});
