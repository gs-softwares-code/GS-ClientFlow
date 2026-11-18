// GS-ClientFlow Security-Enforced Service Worker
// Enforces strict network-only routing for all /api/* routes to prevent cache storage persistence.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Purge all browser caches to guarantee zero residual data leaks
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => {
        clients.forEach((client) => {
          if ('navigate' in client) {
            client.navigate(client.url);
          }
        });
      })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // STRICT NETWORK-ONLY: Never cache any /api/* routes, auth cookies, or non-GET requests
  if (
    url.pathname.startsWith('/api/') ||
    event.request.method !== 'GET' ||
    event.request.headers.has('Authorization')
  ) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Network request failed or offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
        );
      })
    );
    return;
  }

  // Pass-through without local caching
  event.respondWith(fetch(event.request));
});
