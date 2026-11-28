/* Agent Office install shell.
 *
 * Network-only on purpose: the local app is served with no-store and changes
 * often, so a cache-first service worker would show stale UI after an update.
 * Having a fetch handler makes the manifest installable as a PWA; every
 * request still goes to the local server unchanged.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});
