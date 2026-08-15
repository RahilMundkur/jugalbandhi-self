// Jugalbandhi Self — Service Worker
// Strategy: precache core shell, lazy-cache audio on first play
const CACHE_VERSION = 'jb-v1';
// Bump this string (jb-core-vN) whenever reader.html/index.html/fonts change.
// Browsers only detect a service worker update by byte-diffing sw.js itself
// — editing reader.html/index.html alone doesn't trigger that check, so the
// old service worker keeps running with its existing (stale) cache contents
// indefinitely, no matter how many times the app itself gets rebuilt and
// reinstalled. Bumping this string changes sw.js's own bytes, which forces
// the browser to register a new worker, re-run install() against the
// current CORE_ASSETS, and (via the activate handler below) delete the old
// cache entirely instead of leaving stale entries mixed in with fresh ones.
const CORE_CACHE   = 'jb-core-v28';
// Bump this whenever an already-shipped audio file's CONTENT changes at the
// same filename/URL (e.g. re-splicing a paragraph's clip) — the fetch
// handler below is cache-first for audio, so a web/PWA user who already
// played a paragraph once has it cached indefinitely and would otherwise
// keep hearing the old bytes forever at that same URL. Bumping this string
// changes sw.js's own bytes (forcing the SW update), and the activate
// handler deletes any cache not matching the current AUDIO_CACHE name,
// clearing stale audio so it's re-fetched fresh.
const AUDIO_CACHE  = 'jb-audio-v3';

// Core files precached on install
const CORE_ASSETS = [
  './',
  './index.html',
  './reader.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-1024.png',
  './icons/apple-touch-icon.png',
  // Fonts — required for offline rendering
  './Cormorant_Garamond,Inter,Noto_Serif/Cormorant_Garamond/CormorantGaramond-VariableFont_wght.ttf',
  './Cormorant_Garamond,Inter,Noto_Serif/Cormorant_Garamond/CormorantGaramond-Italic-VariableFont_wght.ttf',
  './Cormorant_Garamond,Inter,Noto_Serif/Inter/Inter-VariableFont_opsz,wght.ttf',
  './Cormorant_Garamond,Inter,Noto_Serif/Inter/Inter-Italic-VariableFont_opsz,wght.ttf',
  './Cormorant_Garamond,Inter,Noto_Serif/Noto_Serif/NotoSerif-VariableFont_wdth,wght.ttf',
  './Cormorant_Garamond,Inter,Noto_Serif/Noto_Serif/NotoSerif-Italic-VariableFont_wdth,wght.ttf'
];

// Install: precache core shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CORE_CACHE && k !== AUDIO_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for core + audio, network-first for everything else
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Audio files: cache-first, then network (lazy cache on first play)
  if (url.pathname.includes('/audio/')) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Core assets and navigation: stale-while-revalidate
  if (event.request.mode === 'navigate' || CORE_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '')))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CORE_CACHE).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: network-first (API calls, external resources)
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
