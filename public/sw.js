/*
 * صوتی بقیہ — service worker (hand-written; no build-time plugin).
 *
 * Strategy
 *   • navigations      network-first, cached shell as the offline fallback;
 *   • static assets    stale-while-revalidate (fonts, icons, hashed bundles);
 *   • everything else  straight to the network, untouched.
 *
 * Vite's dev-server URLs (`/src/...`, `/@vite/...`) are always network-only:
 * caching transformed modules is how a dev preview ends up serving yesterday's
 * code after an edit.
 *
 * Bump CACHE_VERSION on any change to this file's caching rules.
 */
// AUDIT #22 — bumped from sauti-v1 so the new SW (and any cache-policy change)
// takes effect on every already-installed PWA. Policy: bump this constant on
// every change to this file's caching rules; a forgotten bump keeps an old
// shell alive indefinitely.
const CACHE_VERSION = "sauti-v2";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/og-cover.png",
];
const OFFLINE_HTML = `<!doctype html><html dir="rtl" lang="ur"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>آف لائن</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;
       font-family:Tahoma,"Noto Nastaliq Urdu",serif;text-align:center;padding:24px;line-height:2}
  h1{font-size:22px;margin:0 0 8px}p{color:#94a3b8;max-width:32ch;margin:0 auto 16px}
  a{color:#7dd3fc}
</style></head><body><div><h1>آپ آف لائن ہیں</h1>
<p>صوتی بقیہ کا بنیادی حصہ اب بھی کھل جائے گا۔ اگر صفحہ نہ کھلے تو انٹرنیٹ آنے پر دوبارہ کوشش کریں۔</p>
<a href="/">دوبارہ کھولیں</a></div></body></html>`;

const DEV_PREFIXES = ["/src/", "/@vite/", "/@id/", "/@fs/", "/node_modules/", "/__vite"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Individual failures must not abort the whole install.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:css|js|mjs|woff2?|ttf|png|jpe?g|svg|webp|ico|webmanifest)$/.test(url.pathname)
  );
}

async function staleWhileRevalidate(request, cache) {
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

async function networkFirstNavigation(request, cache) {
  try {
    const response = await fetch(request);
    if (response && response.ok) void cache.put("/", response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match("/"));
    return cached || new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (DEV_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        return networkFirstNavigation(request, cache);
      })(),
    );
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        return staleWhileRevalidate(request, cache);
      })(),
    );
  }
});
