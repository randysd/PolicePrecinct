// ===== CACHE VERSION (bump this each deploy) =====
const CACHE_VERSION = "pp-v2026.01.24.2";

const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const AUDIO_CACHE = `${CACHE_VERSION}-audio`;

// Use ABSOLUTE paths (not "./") to avoid redirect/canonicalization weirdness
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
    const shell = await caches.open(APP_SHELL_CACHE);
    await shell.addAll(SHELL_ASSETS);

    const audio = await caches.open(AUDIO_CACHE);
    await audio.addAll(AUDIO_ASSETS);

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

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function isAudioRequest(req) {
  const url = new URL(req.url);
  return url.pathname.startsWith("/assets/audio/");
}

function isCoreShellPath(pathname) {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/app.js" ||
    pathname === "/styles.css" ||
    pathname === "/manifest.webmanifest"
  );
}

// Network-first: prefer freshest, but fall back to cache.
// IMPORTANT: Do not cache/serve redirect responses (opaqueredirect).
async function networkFirst(request, cacheName, fallbackUrl = "/index.html") {
  const cache = await caches.open(cacheName);

  try {
    const fresh = await fetch(request, { cache: "no-store" });

    // If we got a redirect response, don't cache it and don't serve it for navigation.
    if (fresh.type === "opaqueredirect") {
      // Try fetching the fallback directly
      const hard = await fetch(fallbackUrl, { cache: "no-store" });
      if (hard.ok) {
        cache.put(fallbackUrl, hard.clone());
        return hard;
      }
      // fall back to cache below
    } else if (fresh.ok) {
      cache.put(request, fresh.clone());
      return fresh;
    }
  } catch {
    // ignore and fall back to cache
  }

  // Cache fallback
  const cached = await cache.match(request);
  if (cached && cached.type !== "opaqueredirect") return cached;

  const cachedFallback = await cache.match(fallbackUrl);
  if (cachedFallback && cachedFallback.type !== "opaqueredirect") return cachedFallback;

  // Last resort: return a simple offline response
  return new Response("Offline (no cached app shell available)", {
    status: 503,
    headers: { "Content-Type": "text/plain" }
  });
}

// Cache-first: best for audio
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  const cached = await cache.match(request);
  if (cached) return cached;

  const fresh = await fetch(request);
  if (fresh.ok && fresh.type !== "opaqueredirect") {
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Audio: cache-first (offline)
  if (isAudioRequest(req)) {
    event.respondWith(cacheFirst(req, AUDIO_CACHE));
    return;
  }

  // Navigations: ALWAYS return a real document (not a redirect)
  if (req.mode === "navigate") {
    // Serve /index.html network-first, cached fallback
    event.respondWith(networkFirst("/index.html", APP_SHELL_CACHE, "/index.html"));
    return;
  }

  // Core shell assets: network-first for instant updates
  if (isCoreShellPath(url.pathname)) {
    event.respondWith(networkFirst(req, APP_SHELL_CACHE, "/index.html"));
    return;
  }

  // Other assets: cache then network
  event.respondWith((async () => {
    const cached = await caches.match(req);
    return cached || fetch(req);
  })());
});
