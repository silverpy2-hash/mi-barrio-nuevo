// Mi Barrio · Camarero — service worker de alcance acotado a /mi-barrio-camarero/.
// Cachea solo el shell estático de esta página. NUNCA intercepta Firebase/Auth/Firestore
// (todo origen externo va directo a la red) y NO encola pedidos offline: sin conexión
// no se puede operar; la página lo informa y bloquea el envío.
const VERSION = 'mi-barrio-camarero-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icon.svg', './icon-maskable.svg', './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // Fuera del origen propio (Firebase, Google APIs, CDNs): siempre a la red, sin caché.
    if (url.origin !== self.location.origin) return;
    if (event.request.method !== 'GET') return;
    // Navegación: red primero; si no hay conexión, se muestra el shell cacheado
    // (la página informa que no se puede operar sin conexión).
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
        return;
    }
    // Estáticos de la carpeta: caché primero con respaldo a la red.
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((cache) => cache.put(event.request, copy)); }
        return res;
    })));
});
