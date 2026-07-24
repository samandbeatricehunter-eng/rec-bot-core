// Minimal service worker — exists purely to satisfy Chrome/Android's installability
// criteria (a registered fetch handler). No offline caching yet; every request just passes
// through to the network untouched. A real caching strategy is a separate, later task.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally no-op — no response override, no cache.
});
