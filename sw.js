"use strict";

const cachePrefix = `age-capital-${self.registration.scope}-`;
const cacheName = `${cachePrefix}v1`;
const assets = [
  "./", "./index.html", "./styles.css", "./capstruct.js", "./app.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./data/assumptions.csv", "./data/example_firms.csv", "./data/ebit_scenarios.csv",
  "./data/cdss.csv", "./data/banker_schedule.csv"
];
const urls = new Set(assets.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets.map(path => new Request(new URL(path, self.registration.scope), {
      cache: "reload"
    })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(cacheName);
  let response;
  try {
    response = await fetch(request, { cache: "no-cache" });
    if (response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch (error) {
        console.warn("Unable to update offline cache.", error);
      }
      return response;
    }
  } catch (error) {
    const saved = await cache.match(request);
    if (saved) return saved;
    throw error;
  }
  return (await cache.match(request)) || response;
}

self.addEventListener("fetch", event => {
  if (event.request.method === "GET" && urls.has(event.request.url)) {
    event.respondWith(networkFirst(event.request));
  }
});
