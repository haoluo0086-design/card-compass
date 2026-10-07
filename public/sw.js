/* Build replaces the two placeholders. Never register this development template. */
const BUILD = "__BUILD_ID__";
const PRECACHE = /* __PRECACHE__ */ [];
const BASE = self.registration.scope;
const PREFIX = `card-compass:${new URL(BASE).pathname}:`;
const CACHE = `${PREFIX}${BUILD}`;
const URLS = PRECACHE.map((file) => new URL(file, BASE).href);
const KNOWN = new Set(URLS);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(URLS.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
    if (response.ok) {
      await cache.put(fallbackUrl || request, response.clone());
      return response;
    }
    const cached = await cache.match(fallbackUrl || request);
    return cached || response;
  } catch {
    return await cache.match(fallbackUrl || request) || new Response('暂时离线，请联网后重试。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(BASE)) return;
  const relative = url.pathname.slice(new URL(BASE).pathname.length);
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, new URL('index.html', BASE).href));
  } else if (/^data\/(catalog|source-status)\.json$/.test(relative)) {
    // A refresh tries the network; offline mode retains the last downloaded file.
    event.respondWith(networkFirst(request, new URL(relative, BASE).href));
  } else if (KNOWN.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
