// Jiggered's service worker. It exists so the app can open without a connection: it keeps a copy of the app's
// own files (never anything from /api/, so no one's data) and serves them when the network is down.
// Network first, so as soon as you are online you get the latest version.

const CACHE = "jiggered-app-v1";
// Everything the signed-in app needs to start. server_test.go checks this against the files that ship.
const SHELL = [
  "/", "/app.js", "/sync.js", "/device.js", "/editor.js", "/model.js", "/util.js", "/today.js", "/episodes.js", "/history.js", "/account.js", "/admin.js", "/help.js", "/tooltips.js",
  "/style.css", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/favicon-32.png", "/apple-touch-icon.png",
  "/fonts/atkinson-400-latin.woff2", "/fonts/atkinson-400-latin-ext.woff2", "/fonts/atkinson-700-latin.woff2",
  "/fonts/atkinson-700-latin-ext.woff2", "/fonts/bricolage-latin.woff2",
];

// Keep only a real answer for exactly this URL: not an error, and not a sign-in page that a redirect led to.
const cacheable = res => res.ok && !res.redirected && res.type === "basic";

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async url => {
      try { const res = await fetch(url, { cache: "reload" }); if (cacheable(res)) await cache.put(url, res) } catch { /* picked up on a later visit */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || ["/healthz", "/login", "/logout"].includes(url.pathname)) return; // data and sign-in always go to the server
  e.respondWith(networkFirst(req, url.pathname));
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  // Network first, but a connection that hangs or a proxy answering 5xx (the app is down) is as good as none.
  const fallback = async err => { const hit = await cache.match(key); if (hit) return hit; throw err };
  try {
    const res = await fetch(req, { signal: AbortSignal.timeout(5000) });
    if (res.status >= 500) return await fallback(new Error("HTTP " + res.status)).catch(() => res);
    if (cacheable(res)) cache.put(key, res.clone());
    return res;
  } catch (err) {
    return fallback(err);
  }
}
