const CACHE = 'fortel-crm-v3';
const CORE_URLS = ['/index.html', '/manifest.json'];

async function precacheAppShell() {
  const cache = await caches.open(CACHE);
  await Promise.all(CORE_URLS.map(url => cache.add(url).catch(() => null)));
  try {
    const response = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    const assets = Object.values(manifest.files || {})
      .filter(url => typeof url === 'string' && url.startsWith('/') && !url.endsWith('.map'));
    await Promise.all([...new Set(assets)].map(url => cache.add(url).catch(() => null)));
  } catch (_) {
    // The core navigation fallback still works when the manifest is unavailable.
  }
}

self.addEventListener('install', event => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE).then(cache => cache.put('/index.html', response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  const url = new URL(request.url);
  const isStaticAsset = url.origin === self.location.origin
    && ['script', 'style', 'font', 'image'].includes(request.destination);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
