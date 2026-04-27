// Compound PWA Service Worker
const CACHE_NAME = 'compound-v8';
const RUNTIME_CACHE = 'compound-runtime-v8';
const IS_LOCAL_DEV = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);

// App shell files to precache
const PRECACHE_URLS = ['/', '/manifest.json'];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    (IS_LOCAL_DEV
      ? Promise.resolve()
      : caches.open(CACHE_NAME).then((cache) => {
          return cache.addAll(PRECACHE_URLS);
        })
    ).then(() => self.skipWaiting()),
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  const currentCaches = IS_LOCAL_DEV ? [] : [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return cacheNames.filter(
          (name) => name.startsWith('compound-') && !currentCaches.includes(name),
        );
      })
      .then((toDelete) => {
        return Promise.all(toDelete.map((name) => caches.delete(name)));
      })
      .then(() => {
        if (IS_LOCAL_DEV) return self.registration.unregister();
        return self.clients.claim();
      }),
  );
});

// Fetch: network-first for API calls, stale-while-revalidate for static assets
self.addEventListener('fetch', (event) => {
  if (IS_LOCAL_DEV) return;

  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) {
    // For external requests (fonts, etc.), cache-first
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // API routes: network-only
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests: network-first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/') || caches.match(request);
      }),
    );
    return;
  }

  // Static assets (_next/static): cache-first (content-hashed, safe to cache forever)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Other same-origin: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      return cached || fetchPromise;
    }),
  );
});
