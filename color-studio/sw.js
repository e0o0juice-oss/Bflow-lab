"use strict";
const CACHE = "color-studio-shell-v7";
const ASSETS = [
  "/color-studio/",
  "/color-studio/studio.css",
  "/color-studio/studio.js",
  "/color-studio/content.js",
  "/color-studio/qr.js",
  "/color-studio/fonts/PretendardVariable.woff2",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("color-studio-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/color-studio/api/")
  )
    return;
  if (
    event.request.mode === "navigate" &&
    url.pathname.startsWith("/color-studio/")
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/color-studio/")),
    );
    return;
  }
  if (ASSETS.includes(url.pathname))
    event.respondWith(
      fetch(event.request).catch(() => caches.match(url.pathname)),
    );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    ![
      "/color-studio/report.js",
      "/color-studio/fonts/ReportRegular.ttf",
      "/color-studio/fonts/ReportSemibold.ttf",
    ].includes(url.pathname)
  )
    return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }),
  );
});
