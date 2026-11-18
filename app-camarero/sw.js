/* MI BARRIO — App Camarero · Service Worker
   App shell en caché para que la interfaz abra sin Internet.
   Los datos (menú, mesas, solicitudes) SIEMPRE van a Firestore: nunca se
   simula una confirmación offline. */

const CACHE = 'mb-camarero-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './js/firebase.js',
  './js/config.js',
  './js/cuentas.js',
  '../cuentas-mesa/core.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return; // Firebase se maneja solo

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(r => {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copia));
        return r;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      if (r.ok) {
        const copia = r.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, copia));
      }
      return r;
    }))
  );
});
