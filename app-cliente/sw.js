/* ==========================================================================
   MI BARRIO — Service Worker (PWA Offline Support)
   Estrategia: Cache First para assets estáticos, Network First para config/menu
   ========================================================================== */

const CACHE_NAME = 'mi-barrio-v5';
const STATIC_CACHE = 'mi-barrio-static-v5';
const DYNAMIC_CACHE = 'mi-barrio-dynamic-v5';

// Archivos estáticos a cachear al instalar
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/variables.css',
  '/css/base.css',
  '/css/components.css',
  '/css/layout.css',
  '/css/themes.css',
  '/js/firebase.js',
  '/js/config-listener.js',
  '/js/menu-store.js',
  '/js/cart.js',
  '/js/delivery.js',
  '/js/order.js',
  '/js/ui.js',
  '/js/app.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Nunito:wght@400;600;700;800&display=swap'
];

// Estrategias de cache
const STRATEGIES = {
  // Cache First: para assets estáticos (CSS, JS, fuentes, iconos)
  cacheFirst: async (request) => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      return new Response('Offline', { status: 503 });
    }
  },

  // Network First: para datos dinámicos (Firestore, config/menu, APIs)
  networkFirst: async (request) => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // Stale While Revalidate: para leaflet tiles, imágenes
  staleWhileRevalidate: async (request) => {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached || fetchPromise;
  }
};

// Install: cachear assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { credentials: 'omit', cache: 'reload' })));
    }).catch((err) => {
      console.error('[SW] Install failed:', err);
    })
  );
  self.skipWaiting();
});

// Activate: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
            .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: enrutar según tipo de request
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo GET
  if (request.method !== 'GET') return;

  // Ignorar extensiones de navegador, chrome-extension, etc.
  if (!url.protocol.startsWith('http')) return;

  // 1. Assets estáticos locales (CSS, JS, HTML) -> Cache First
  if (url.origin === location.origin &&
      (request.destination === 'style' ||
       request.destination === 'script' ||
       request.destination === 'document' ||
       request.destination === 'manifest' ||
       url.pathname.endsWith('.css') ||
       url.pathname.endsWith('.js') ||
       url.pathname.endsWith('.html') ||
       url.pathname.endsWith('.json') ||
       url.pathname.endsWith('.svg') ||
       url.pathname.endsWith('.png') ||
       url.pathname.endsWith('.ico'))) {
    event.respondWith(STRATEGIES.cacheFirst(request));
    return;
  }

  // 2. Google Fonts -> Cache First (son estáticos)
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(STRATEGIES.cacheFirst(request));
    return;
  }

  // 3. Leaflet CDN -> Cache First
  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.includes('leaflet')) {
    event.respondWith(STRATEGIES.cacheFirst(request));
    return;
  }

  // 4. Leaflet tiles (mapas) -> Stale While Revalidate
  if (url.origin === 'https://tile.openstreetmap.org' || url.origin === 'https://a.tile.openstreetmap.org' || url.origin === 'https://b.tile.openstreetmap.org' || url.origin === 'https://c.tile.openstreetmap.org') {
    event.respondWith(STRATEGIES.staleWhileRevalidate(request));
    return;
  }

  // 5. Firebase / Firestore APIs -> Network First (datos dinámicos)
  if (url.origin.includes('firebase') || url.origin.includes('googleapis.com') || url.pathname.includes('firestore')) {
    event.respondWith(STRATEGIES.networkFirst(request));
    return;
  }

  // 6. OSRM (cálculo delivery) -> Network First
  if (url.origin === 'https://router.project-osrm.org') {
    event.respondWith(STRATEGIES.networkFirst(request));
    return;
  }

  // 7. FormSubmit (email) -> Network First
  if (url.origin === 'https://formsubmit.co') {
    event.respondWith(STRATEGIES.networkFirst(request));
    return;
  }

  // 8. WhatsApp (wa.me) -> No cachear, dejar pasar
  if (url.origin === 'https://wa.me' || url.origin === 'https://api.whatsapp.com') {
    return; // No interceptar
  }

  // Por defecto: Network First para todo lo demás
  event.respondWith(STRATEGIES.networkFirst(request));
});

// Background Sync para pedidos offline (futuro)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pedidos') {
    event.waitUntil(syncPedidos());
  }
});

async function syncPedidos() {
  // Placeholder para V2: sincronizar pedidos guardados en IndexedDB cuando vuelva la conexión
  console.log('[SW] Background sync: sync-pedidos');
}

// Push notifications (futuro)
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/badge-72.png',
    vibrate: [200, 100, 200],
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'Ver pedido' },
      { action: 'dismiss', title: 'Cerrar' }
    ]
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open') {
    event.waitUntil(clients.openWindow(event.notification.data));
  }
});

// Mensaje desde cliente para skipWaiting
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Mi Barrio Service Worker loaded');