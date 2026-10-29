// sw.js - lets the online app open at once and without internet. After the app has started, it
// sends the list of files it loaded ("keep"); they're fetched again and kept, all of them or none,
// so the next start comes from the phone itself, and an update to the app shows up the time after
// it was published. The word lists don't pass through here: data.js keeps those itself.
// The laptop's copy at 127.0.0.1 doesn't use this (app.js).

const CACHE = "shengci-app";
const own = (url) => url.origin === location.origin && !/\/(units|local)\//.test(url.pathname);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !own(url)) return;
  e.respondWith(caches.open(CACHE)
    .then((cache) => cache.match(e.request, { ignoreSearch: e.request.mode === "navigate" }))
    .then((kept) => kept || fetch(e.request)));
});

async function keep(urls) {
  const cache = await caches.open(CACHE);
  const kept = (await cache.keys()).map((request) => request.url);
  const all = [...new Set([...urls.filter((url) => own(new URL(url))), ...kept])];
  let fresh;
  try {
    fresh = await Promise.all(all.map(async (url) => [url, await fetch(url, { cache: "no-cache" })]));
  } catch {
    return; // offline: keep what we have
  }
  if (fresh.some(([, response]) => !response.ok && response.status !== 404)) return;
  await Promise.all(fresh.map(([url, response]) => (response.ok ? cache.put(url, response) : cache.delete(url))));
}

self.addEventListener("message", (e) => {
  if (e.data?.keep) e.waitUntil(keep(e.data.keep));
});
