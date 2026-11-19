// Mi Barrio · Repartidor — service worker mínimo offline-ready.
// Shell en caché para que la app abra sin internet; Firebase siempre va a la red.
const VERSION = 'mi-barrio-repartidor-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './logica.js', './resumen.js', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mi-barrio-repartidor-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // Las llamadas a Firebase/Google siempre van a la red, sin caché.
    if (url.origin !== self.location.origin) return;
    if (event.request.method !== 'GET') return;
    // Navegación: red primero, caché como respaldo para abrir offline.
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).then((res) => res).catch(() => caches.match('./index.html')));
        return;
    }
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((cache) => cache.put(event.request, copy)); }
        return res;
    })));
});
