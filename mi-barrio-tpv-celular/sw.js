// Mi Barrio - TPV Celular — service worker with a scope isolated to this folder.
// Caches ONLY this app's static shell. It NEVER deletes other apps' caches
// (only keys with the mi-barrio-tpv-celular- prefix), NEVER caches Firebase/Auth/
// Firestore responses or any cross-origin request, NEVER queues order/money writes
// offline, and is the entry point for background push notifications.
//
// Push payload contract (data-only, sent by the backend via FCM; nested envelopes tolerated):
//   { notification: {title, body}, data: { type:"tpv-new-order", orderId:"<firestore id>", tag:"tpv-new-order-<id>" }, android: {...} }
//   { data: { notification: {...}, data: { type, orderId, tag } } }   — double-nested SDK envelopes
// No customer PII is ever read from the payload: title/body are always generic,
// the tag is validated against /^[A-Za-z0-9._-]{1,80}$/ (derived from orderId otherwise),
// and clicks/icons stay inside this app's scope.
// A stable per-order tag bounds visual duplication. This is NOT an exactly-once guarantee.
const VERSION = 'mi-barrio-tpv-celular-v4';
const CACHE_PREFIX = 'mi-barrio-tpv-celular-';
const SHELL = [
    './',
    './index.html',
    './manifest.json',
    './push-config.js',
    './push-helpers.js',
    './mobile.css',
    './mobile-ui.js',
    './icon.svg',
    './icon-maskable.svg',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-192.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(VERSION)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    // Only this app's own caches are ever removed — never global cache cleanup.
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // Cross-origin (Firebase, Google APIs, CDNs, fonts): always straight to the network, never cached.
    if (url.origin !== self.location.origin) return;
    // Never touch anything that is not a plain GET (no order/money writes, no API calls).
    if (event.request.method !== 'GET') return;
    // Navigations: network first; offline falls back to the cached shell.
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
        return;
    }
    // Static shell of this folder: cache first, then network (and cache a good copy).
    event.respondWith(
        caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(VERSION).then((cache) => cache.put(event.request, copy));
            }
            return res;
        }))
    );
});

// ===== Background push (closed app) =====
// Kept deliberately tiny and free of Firebase imports: FCM delivers the push to this
// worker; we render a generic notification with a stable per-order tag.
// The parser walks the documented FCM web envelope shapes (top level, one level of
// `data`/`notification` nesting, and the double-nested `data.data` variant) instead of
// assuming a flat payload, so orderId/tag survive realistic deliveries.
const PUSH_TITLE = 'Mi Barrio - TPV Celular';
const PUSH_BODY = 'Nuevo pedido recibido';
const TAG_RE = /^[A-Za-z0-9._-]{1,80}$/;

function pushCleanId(value) {
    return String(value == null ? '' : value).trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60);
}

function parsePushPayload(event) {
    let payload = null;
    try {
        payload = event && event.data ? event.data.json() : null;
    } catch (e) {
        payload = null;
    }
    const candidates = [];
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        candidates.push(payload);
        if (payload.notification && typeof payload.notification === 'object') candidates.push(payload.notification);
        if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
            candidates.push(payload.data);
            if (payload.data.notification && typeof payload.data.notification === 'object') candidates.push(payload.data.notification);
            if (payload.data.data && typeof payload.data.data === 'object' && !Array.isArray(payload.data.data)) candidates.push(payload.data.data);
        }
    }
    const pick = (key) => {
        for (const c of candidates) {
            const v = c[key];
            if (v != null && String(v).trim() !== '') return String(v).trim();
        }
        return null;
    };
    const orderId = pushCleanId(pick('orderId'));
    let tag = pick('tag') || '';
    if (!TAG_RE.test(tag)) tag = 'tpv-new-order-' + (orderId || 'sin-id');
    // Title/body ALWAYS generic: the payload never decides what the user sees, so
    // customer data (or an attacker-controlled sender) cannot leak into the tray.
    return { title: PUSH_TITLE, body: PUSH_BODY, tag, orderId };
}

self.addEventListener('push', (event) => {
    const note = parsePushPayload(event);
    event.waitUntil(
        self.registration.showNotification(note.title, {
            body: note.body,
            tag: note.tag, // same order re-pushed: the OS replaces, does not stack duplicates
            icon: './icon-192.png',
            badge: './icon-192.png',
            data: { url: './', orderId: note.orderId },
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification && event.notification.data && event.notification.data.url) || './';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            const scope = self.registration.scope;
            const match = list.find((c) => typeof c.url === 'string' && c.url.startsWith(scope));
            if (match && 'focus' in match) return match.focus();
            return self.clients.openWindow(target);
        })
    );
});
