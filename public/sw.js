/* O nome do cache leva a versao do build (carimbada no `postbuild`,
   scripts/stamp-sw.mjs).
   Antes era fixo ('dividepass-pwa-v1'): o cache sobrevivia a TODOS os
   deploys, o index.html velho continuava apontando para o bundle velho e
   o cliente ficava preso na primeira versao que abriu. Como o nome muda a
   cada build, o activate apaga o cache antigo e o cliente recebe a
   versao nova. */
const CACHE_NAME = 'dividepass-pwa-__DP_BUILD__';
const CORE_ASSETS = ['/', '/dashboard', '/index.html', '/manifest.webmanifest', '/logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
      // Avisa as abas abertas que ja existe uma versao nova: a pagina
      // ainda esta rodando o bundle antigo em memoria, entao so um
      // recarregamento traz o codigo novo.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'DP_NOVA_VERSAO' }));
      })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      }).catch(() => cached);
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() || '' };
  }

  const title = payload.title || 'DividePass';
  const options = {
    body: payload.body || payload.message || '',
    icon: '/logo.png',
    badge: '/logo.png',
    data: {
      url: payload.url || '/dashboard',
      event_type: payload.event_type || 'info',
      metadata: payload.metadata || {},
    },
    tag: payload.tag || payload.event_type || 'dividepass-notification',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification?.data?.url || '/dashboard', self.location.origin).href;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        if (client.url.includes(url)) return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
    return null;
  })());
});
