/* service-worker.js */
// Bump this any time you change the precache list or caching strategy
const CACHE_VERSION = "v15";
const CACHE_NAME = `pp-dispatcher-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pp-dispatcher-runtime-${CACHE_VERSION}`;

const APP_SHELL = [  "./index.html",
  "./styles.css?v=v15",
  "./app.js?v=v15",
  "./manifest.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",

  // data
  "./assets/data/ads.json",
  "./assets/data/classifieds.json",
  "./assets/data/article_templates.json",
  "./assets/data/dispatches.json",
  "./assets/data/commendations.json",
  "./assets/data/crises.json",

  // Newspaper ad images (precache so they always render, even offline)
  "./assets/ads/ad_donut_shop.png",
  "./assets/ads/ad_tow_truck.png",
  "./assets/ads/ad_pawn_shop.png",
  "./assets/ads/ad_diner.png",
  "./assets/ads/ad_police_scanner.png",

  // Audio: precache known files
  "./assets/audio/music_main.mp3",
  "./assets/audio/music_crisis.mp3",
  "./assets/audio/music_ending.mp3",
  "./assets/audio/sfx_city.mp3",
  "./assets/audio/sfx_traffic.mp3",
  "./assets/audio/sfx_button.mp3",
  "./assets/audio/sfx_dice.mp3",
  "./assets/audio/sfx_investigate_success.mp3",
  "./assets/audio/sfx_investigate_fail.mp3",
  "./assets/audio/sfx_arrest_success.mp3",
  "./assets/audio/sfx_arrest_fail.mp3",
  "./assets/audio/sfx_emergency_success.mp3",
  "./assets/audio/sfx_emergency_fail.mp3",
  // Note: this file wasn't present in the repo; keep runtime-cached instead.
  // "./assets/audio/sfx_commendation.mp3",
  "./assets/audio/sfx_dispatch.mp3",
  "./assets/audio/sfx_crisis.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // cache.addAll() fails the whole install if *any* request fails.
      // We add items one-by-one so missing optional files don't break installs.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            // Non-fatal: runtime cache (or network) can still serve these.
            console.warn("[SW] Precache failed:", url, err);
          }
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k === CACHE_NAME || k === RUNTIME_CACHE) return null;
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

// Allow the page to tell the SW to activate immediately
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Never cache the service worker script itself
  if (sameOrigin && url.pathname.endsWith("/sw.js")) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  // Navigations / HTML: network-first so new releases show up immediately
  const acceptsHTML = (req.headers.get("accept") || "").includes("text/html");
  if (req.mode === "navigate" || (sameOrigin && acceptsHTML)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Same-origin assets/data: stale-while-revalidate
  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Cross-origin: just go to network (no runtime caching)
  event.respondWith(fetch(req));
});



async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    if (fresh && fresh.status === 200) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Offline fallback for SPA navigations
    return caches.match("./index.html");
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((res) => {
      // Cache successful basic responses
      if (res && res.status === 200) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  // Return cached immediately if available, else wait for network
  return cached || (await fetchPromise) || (await caches.match("./index.html"));
}
