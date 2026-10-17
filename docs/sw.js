// Keeps Pitstop working with a weak or no connection: the app itself comes from the network when it can and from
// this cache when it can't; map tiles, prices and libraries are served from the cache and refreshed in the background.
const VERSION = "pitstop-v1";
const SHELL = ["./", "index.html", "core.js", "manifest.webmanifest", "icon.png", "icon-192.png", "favicon-32.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("pitstop-") && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isData = u => u.hostname === "raw.githubusercontent.com" || u.hostname === "cdn.jsdelivr.net"
  || u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith(new URL("./", self.location).pathname)) {
    // the app: newest when online, cached copy when not
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
  } else if (isData(url)) {
    // data and libraries: answer from the cache at once, refresh it for next time
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const fresh = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
  }
});
