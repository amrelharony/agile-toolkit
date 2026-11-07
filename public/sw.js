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
 *    mascot sheet) is left to the network and the browser's HTTP cache.
 *
 * Bump VERSION to drop every cache on the next activation. The app can
 * switch this worker off with NEXT_PUBLIC_DISABLE_SW=1 (see
 * components/pwa/service-worker.tsx), which unregisters it.
 */
const VERSION = "v2";
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

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline | Agile Toolkit</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f1e6;color:#1d1a18;font:16px/1.5 system-ui,sans-serif;padding:24px}main{max-width:28rem;background:#fffcf5;border:2px solid #2b2622;border-radius:9px 7px 10px 6px/7px 10px 6px 9px;box-shadow:3px 3px 0 0 #1d1a18;padding:24px}a{color:#873a16}</style></head><body><main><h1>You're offline</h1><p>This page hasn't been opened on this device yet, so it isn't available offline. Tools you've used before still work. Your data is saved in this browser.</p><p><a href="/">Go to the home page</a></p></main></body></html>`;

/** lib/comics/entry's EP_PATTERN: 1-999, with a leading zero allowed on 1-9. */
const EP_PATTERN = /^(?:0?[1-9]|[1-9]\d{1,2})$/;

/**
 * What a page is saved under. Every comic is /comics?ep=NN, so there the episode
 * says which page this is, and nothing else does: a printed QR's `src` is tidied
 * away once it's counted, so the copy saved under a scan must still be found
 * under the tidied address, and the printed ep=07 is the site's own ep=7.
 * Elsewhere the query is only page state.
 */
function pageKey(request) {
  const url = new URL(request.url);
  if (url.pathname !== "/comics") return { key: request, ignoreSearch: true };
  const ep = url.searchParams.getAll("ep");
  const key = new URL("/comics", url.origin);
  if (ep.length === 1)
    key.searchParams.set("ep", EP_PATTERN.test(ep[0]) ? String(Number(ep[0])) : ep[0]);
  return { key: key.href, ignoreSearch: false };
}

async function handleNavigation(request) {
  const cache = await caches.open(PAGE_CACHE);
  const { key, ignoreSearch } = pageKey(request);
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      await cache.put(key, response.clone());
      trimPages();
    }
    return response;
  } catch {
    // Only this page's own copy: serving another page's HTML under this URL
    // would hydrate the wrong route.
    // Then this exact address, as the worker before pageKey saved pages.
    const cached = (await cache.match(key, { ignoreSearch })) || (await cache.match(request));
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
