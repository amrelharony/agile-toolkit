/*
 * Agile Toolkit service worker — offline support for pages you've visited.
 *
 * Visitors' work already lives in localStorage, so once a tool's page and
 * its scripts are cached the tool keeps working without a connection.
 *
 *  - /_next/static/* (content-hashed, immutable): cache first.
 *  - Page navigations: network first; on failure, the last copy of that
 *    same page; failing that, a small offline page.
 *  - Everything else (API, auth, Supabase, AI providers, RSC fetches, the
 *    mascot model) is left to the network and the browser's HTTP cache.
 *
 * Bump VERSION to drop every cache on the next activation. The app can
 * switch this worker off with NEXT_PUBLIC_DISABLE_SW=1 (see
 * components/pwa/service-worker.tsx), which unregisters it.
 */
const VERSION = "v1";
const STATIC_CACHE = `at-static-${VERSION}`;
const PAGE_CACHE = `at-pages-${VERSION}`;
const MAX_PAGES = 60;

/** Routes that must never come from a cache. */
const NEVER_CACHE = /^\/(api|auth|settings|guest|not-authorized)(\/|$)/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("at-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

async function trimPages() {
  const cache = await caches.open(PAGE_CACHE);
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) {
    await cache.delete(request);
  }
}

function cacheable(response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  const cc = response.headers.get("Cache-Control") || "";
  return !/no-store/i.test(cc) && !response.headers.has("Set-Cookie");
}

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline | Agile Toolkit</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06080f;color:#e6edf6;font:16px/1.5 system-ui,sans-serif;padding:24px}main{max-width:28rem}a{color:#00e1ff}</style></head><body><main><h1>You're offline</h1><p>This page hasn't been opened on this device yet, so it isn't available offline. Tools you've used before still work. Your data is saved in this browser.</p><p><a href="/">Go to the home page</a></p></main></body></html>`;

async function handleNavigation(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      await cache.put(request, response.clone());
      trimPages();
    }
    return response;
  } catch {
    // Only this page's own copy: serving another page's HTML under this URL
    // would hydrate the wrong route. Every comic is /comics?ep=NN, so there the
    // query is what says which page this is; elsewhere it's only page state.
    const cached = await cache.match(request, {
      ignoreSearch: new URL(request.url).pathname !== "/comics",
    });
    return (
      cached ||
      new Response(OFFLINE_HTML, {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.test(url.pathname)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStatic(request));
    return;
  }
  // Full page loads only. App Router client navigations fetch RSC payloads
  // (not "navigate" requests) and fall back to a full load when offline.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
  }
});
