// Cache the whole app so a championship keeps running with no signal at the pitch.
const CACHE = 'dad-champs-v19';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'tournament.js',
  'sync.mjs',
  'manifest.webmanifest',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so a deployed update lands straight away, cache as the fallback.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // shared championships are live data, never something to serve from a cache
  if (new URL(event.request.url).pathname.includes('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('index.html')))
  );
});

/* ---------------------------- being told things --------------------------- */
/* The app is not running when a message arrives — the phone wakes this file up
   on its own, shows the notification, and goes back to sleep. */

self.addEventListener('push', (event) => {
  let message = { title: 'Dad Championships', body: '' };
  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch {
    if (event.data) message.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: message.tag || 'dad-champs',
      renotify: true,
      data: { url: message.url || './' },
    })
  );
});

/* Tapping the notification opens the championship rather than a second copy
   of the app on top of the one already there. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.location.href).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
