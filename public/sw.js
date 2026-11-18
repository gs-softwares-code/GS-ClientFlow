// Clean-up service worker that unregisters any legacy/stale worker on localhost
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister().then(() => self.clients.matchAll()).then((clients) => {
      clients.forEach((client) => {
        if ('navigate' in client) {
          client.navigate(client.url);
        }
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Let all requests pass directly to the network without interception
  event.respondWith(fetch(event.request));
});
