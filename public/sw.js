// GS-ClientFlow Security-Enforced Service Worker
// Enforces strict network-only routing for /api/* routes to prevent cache storage persistence and cross-tenant poisoning.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Purge all browser caches to guarantee zero residual data leaks
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Listen for CLEAR_TENANT_CACHE messages sent on tenant switch or logout
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_TENANT_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    );
  }
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

  // Pass-through network-first without caching sensitive responses
  event.respondWith(fetch(event.request));
});
