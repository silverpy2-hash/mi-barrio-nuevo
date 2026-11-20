// Mi Barrio - TPV Celular — unit tests (Node native runner).
// Run: node --test mi-barrio-tpv-celular/test.mjs
// Behavioral tests exercise the public helpers from push-helpers.js (the same module
// the app imports). Structural/hash assertions cover the preservation contract (S3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

import {
    ADMIN_UID,
    isAdminUid,
    resolveAdminAccess,
    PUSH_UI,
    pushConfigReady,
    resolvePushUiState,
    canRequestPushPermission,
    orderTag,
    buildGenericNotification,
    registerDeviceToken,
    unregisterDeviceToken,
    revokePushBeforeLogout,
    mobileAutoPrintAllowed,
} from './push-helpers.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex').toUpperCase();

// ===== Auth: exclusive administrator, no fallback role =====
test('isAdminUid accepts only the exact rules administrator UID', () => {
    assert.equal(ADMIN_UID, 'e8czOfuF82VqPwNUZjMpOSMHUQo2');
    assert.equal(isAdminUid('e8czOfuF82VqPwNUZjMpOSMHUQo2'), true);
    assert.equal(isAdminUid('e8czOfuF82VqPwNUZjMpOSMHUQo3'), false);
    assert.equal(isAdminUid('DELIVERYUID'), false);
    assert.equal(isAdminUid(''), false);
    assert.equal(isAdminUid(undefined), false);
    assert.equal(isAdminUid(null), false);
    assert.equal(isAdminUid(123), false);
});

test('resolveAdminAccess gates listeners: only the admin session proceeds', () => {
    assert.deepEqual(resolveAdminAccess({ uid: ADMIN_UID }), { ok: true });
    assert.deepEqual(resolveAdminAccess({ uid: 'otro' }), { ok: false, reason: 'not-admin' });
    assert.deepEqual(resolveAdminAccess(null), { ok: false, reason: 'no-session' });
    assert.deepEqual(resolveAdminAccess({}), { ok: false, reason: 'not-admin' });
});

// ===== Payment effect: see buildPaymentPlan tests below (S3 all-type invariant) =====


// ===== Push: config gate, UI state, registration, revocation (S2) =====
test('pushConfigReady requires explicit enable + non-empty public VAPID key', () => {
    assert.equal(pushConfigReady(undefined), false);
    assert.equal(pushConfigReady({ enabled: false, vapidKey: 'Bpublic' }), false);
    assert.equal(pushConfigReady({ enabled: true, vapidKey: '' }), false);
    assert.equal(pushConfigReady({ enabled: true, vapidKey: '   ' }), false);
    assert.equal(pushConfigReady({ enabled: true, vapidKey: 'Bpublic-key' }), true);
});

test('resolvePushUiState: missing setup never looks active and never grants', () => {
    const off = { enabled: false, vapidKey: '' };
    assert.equal(resolvePushUiState({ cfg: off, supported: true, permission: 'granted', registered: true }), PUSH_UI.PENDING);
    assert.equal(resolvePushUiState({ cfg: off, supported: true, permission: 'default', registered: false }), PUSH_UI.PENDING);
    const cfg = { enabled: true, vapidKey: 'Bpublic-key' };
    assert.equal(resolvePushUiState({ cfg, supported: false, permission: 'default', registered: false }), PUSH_UI.UNSUPPORTED);
    assert.equal(resolvePushUiState({ cfg, supported: true, permission: 'denied', registered: false }), PUSH_UI.BLOCKED);
    assert.equal(resolvePushUiState({ cfg, supported: true, permission: 'default', registered: false }), PUSH_UI.INACTIVE);
    assert.equal(resolvePushUiState({ cfg, supported: true, permission: 'granted', registered: false }), PUSH_UI.INACTIVE);
    assert.equal(resolvePushUiState({ cfg, supported: true, permission: 'granted', registered: true }), PUSH_UI.ACTIVE);
});

test('canRequestPushPermission only when ready, supported, undecided', () => {
    const cfg = { enabled: true, vapidKey: 'Bpublic-key' };
    assert.equal(canRequestPushPermission({ cfg, supported: true, permission: 'default' }), true);
    assert.equal(canRequestPushPermission({ cfg, supported: true, permission: 'denied' }), false);
    assert.equal(canRequestPushPermission({ cfg, supported: true, permission: 'granted' }), false);
    assert.equal(canRequestPushPermission({ cfg, supported: false, permission: 'default' }), false);
    assert.equal(canRequestPushPermission({ cfg: { enabled: false, vapidKey: '' }, supported: true, permission: 'default' }), false);
});

test('orderTag is stable per order, namespaced tpv-new-order-, never empty', () => {
    assert.equal(orderTag('abc123'), 'tpv-new-order-abc123');
    assert.equal(orderTag('abc123'), orderTag('abc123'));
    assert.notEqual(orderTag('a'), orderTag('b'));
    assert.equal(orderTag(''), 'tpv-new-order-sin-id');
    assert.equal(orderTag(undefined), 'tpv-new-order-sin-id');
    assert.equal(orderTag(42), 'tpv-new-order-42');
});

test('buildGenericNotification carries no customer PII, generic body, stable tag', () => {
    const n = buildGenericNotification({ orderId: 'ped-1', cliente: { nombre: 'Juan', celular: '0981' }, total: 99000 });
    assert.equal(n.body, 'Nuevo pedido recibido');
    assert.equal(n.tag, 'tpv-new-order-ped-1');
    assert.equal(n.title, 'Mi Barrio - TPV Celular');
    const flat = JSON.stringify(n);
    assert.ok(!flat.includes('Juan') && !flat.includes('0981') && !flat.includes('99000'));
    assert.deepEqual(Object.keys(n).sort(), ['body', 'orderId', 'tag', 'title']);
});

test('registerDeviceToken sends {token} to the callable and rejects empty tokens', async () => {
    const calls = [];
    const out = await registerDeviceToken({ callRegister: async (p) => { calls.push(p); return { ok: true }; }, token: ' tok-1 ' });
    assert.deepEqual(calls, [{ token: 'tok-1' }]);
    assert.deepEqual(out, { ok: true });
    await assert.rejects(() => registerDeviceToken({ callRegister: async () => ({}), token: '' }), /token-vacio/);
    await assert.rejects(() => registerDeviceToken({ token: 'x' }), /registrar-no-disponible/);
});

test('unregisterDeviceToken sends {token} to the callable and rejects empty tokens', async () => {
    const calls = [];
    await unregisterDeviceToken({ callUnregister: async (p) => { calls.push(p); return { ok: true }; }, token: 'tok-9' });
    assert.deepEqual(calls, [{ token: 'tok-9' }]);
    await assert.rejects(() => unregisterDeviceToken({ callUnregister: async () => ({}), token: '  ' }), /token-vacio/);
});

test('revokePushBeforeLogout: server revoke happens BEFORE browser token deletion', async () => {
    const order = [];
    const res = await revokePushBeforeLogout({
        token: 'tok-1',
        callUnregister: async () => { order.push('server'); return { ok: true }; },
        deleteBrowserToken: async () => { order.push('browser'); },
    });
    assert.deepEqual(order, ['server', 'browser']);
    assert.deepEqual(res, { ok: true, skipped: false });
});

test('revokePushBeforeLogout: server failure aborts logout, browser token kept, no silent success', async () => {
    let browserDeleted = false;
    const res = await revokePushBeforeLogout({
        token: 'tok-1',
        callUnregister: async () => { throw new Error('unavailable'); },
        deleteBrowserToken: async () => { browserDeleted = true; },
    });
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'server');
    assert.equal(browserDeleted, false);
});

test('revokePushBeforeLogout: browser failure is reported, not swallowed', async () => {
    const res = await revokePushBeforeLogout({
        token: 'tok-1',
        callUnregister: async () => ({ ok: true }),
        deleteBrowserToken: async () => { throw new Error('boom'); },
    });
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'browser');
});

test('revokePushBeforeLogout: no stored token is an explicit skip, not a silent success', async () => {
    const res = await revokePushBeforeLogout({ token: '', callUnregister: async () => { throw new Error('must not be called'); } });
    assert.deepEqual(res, { ok: true, skipped: true });
});

// ===== Mobile auto print disabled; explicit printing retained =====
test('mobileAutoPrintAllowed is always false on the phone build', () => {
    assert.equal(mobileAutoPrintAllowed(), false);
});

// The later, explicitly authorized web-promotion feature changes the original
// pages and rules. Preserve the unrelated manual-order block instead of pinning
// those entire files forever to the mobile-app creation milestone.
test('web promotion preserves existing manual-order totals in both panels', () => {
    for (const path of ['panel_nuevo.html', 'mi-barrio-tpv-celular/index.html']) {
        const html = readFileSync(path, 'utf8');
        const start = html.indexOf('function nuevoTotales()');
        const end = html.indexOf('function nuevoMsg(', start + 1);
        assert.ok(start >= 0 && end > start);
        assert.equal(sha256(html.slice(start, end).replace(/\r\n/g, '\n')), '89409BBFA05726C294605BFA32582EFD4773B2C1D2E2F1CBE6C9036D2F821609');
    }
});

test('new app wires admin gate, push and en_camino invariant into the UI', () => {
    const html = read('./index.html');
    assert.ok(html.includes('<title>Mi Barrio - TPV Celular</title>'));
    assert.ok(html.includes('resolveAdminAccess'));
    assert.ok(html.includes('registerTpvDevice') && html.includes('unregisterTpvDevice'));
    assert.ok(html.includes('us-central1'));
    assert.ok(!html.includes("localStorage.getItem('autoComanda')"));
    assert.ok(html.includes("'./sw.js'"));
    assert.ok(html.includes('href="./manifest.json"'));
    // Correction batch wiring: single atomic payment transaction + serialized push orchestration.
    assert.ok(html.includes('buildPaymentPlan'));
    assert.ok(html.includes('createPushController'));
    assert.ok(!html.includes('buildCobroUpdate'));
    assert.ok(!html.includes('cobroEstadoObjetivo'));
    const cobroStart = html.indexOf('async function confirmarCobro()');
    const cobroEnd = html.indexOf("$('modal-cobro').addEventListener('click'", cobroStart);
    assert.ok(cobroStart > 0 && cobroEnd > cobroStart);
    const cobroBlock = html.slice(cobroStart, cobroEnd);
    assert.ok(!cobroBlock.includes('estadoActualizado') && !cobroBlock.includes("estado: 'preparacion'"));
    assert.equal((cobroBlock.match(/tx\.update\(/g) || []).length, 1); // exactly one atomic write
});

test('service worker never purges other apps caches and never caches cross-origin', () => {
    const sw = read('./sw.js');
    assert.ok(sw.includes('mi-barrio-tpv-celular-'));
    assert.ok(!sw.includes('keys.filter((k) => k !== VERSION)')); // camarero-style global cleanup absent
    assert.ok(sw.includes('k.startsWith(CACHE_PREFIX)')); // own-prefix cleanup only
    assert.ok(sw.includes("url.origin !== self.location.origin"));
    assert.ok(sw.includes("addEventListener('push'"));
    assert.ok(sw.includes("addEventListener('notificationclick'"));
    assert.ok(!sw.includes('https://')); // no remote endpoints loaded by the worker
    assert.ok(!sw.includes('importScripts')); // worker renders notifications itself
});

test('push-config.js is disabled by default, public settings only, no secrets', () => {
    const cfg = read('./push-config.js');
    assert.ok(/enabled:\s*false/.test(cfg));
    assert.ok(!/serviceAccount|private_key|PRIVATE KEY|AIza[0-9A-Za-z_-]{35}/.test(cfg));
});

test('manifest declares the Spanish name, standalone display and local scope', () => {
    const m = JSON.parse(read('./manifest.json'));
    assert.equal(m.name, 'Mi Barrio - TPV Celular');
    assert.equal(m.display, 'standalone');
    assert.equal(m.scope, './');
    assert.equal(m.start_url, './');
    assert.equal(m.lang, 'es');
    assert.ok(m.icons.some((i) => i.sizes === 'any'));
});

// ===== Service worker: real push handler executed in a VM (S2 / blocker 2) =====
// The ACTUAL 'push' handler from sw.js is executed against realistic FCM envelopes;
// assertions cover nested orderIds, distinct/stable tags, generic content (no PII)
// and own-scope notification clicks. These tests fail before the parser rewrite.
function makeSw() {
    const handlers = new Map();
    const shown = [];
    const state = { focused: null, opened: null, clientList: [] };
    const noopCache = {
        open: async () => ({ addAll: async () => {}, put: async () => {} }),
        keys: async () => [],
        delete: async () => true,
        match: async () => undefined,
    };
    const self = {
        addEventListener: (type, fn) => handlers.set(type, fn),
        skipWaiting: async () => {},
        location: { origin: 'https://tpv-celular.example.test' },
        registration: {
            scope: 'https://tpv-celular.example.test/mi-barrio-tpv-celular/',
            showNotification: async (title, opts) => { shown.push({ title, opts }); },
        },
        clients: {
            claim: async () => {},
            matchAll: async () => state.clientList,
            openWindow: async (url) => { state.opened = url; return { url }; },
        },
    };
    const context = vm.createContext({
        self, caches: noopCache, console, URL, JSON, Promise,
        fetch: async () => { throw new Error('network disabled in tests'); },
    });
    vm.runInContext(read('./sw.js'), context, { filename: 'sw.js' });
    return { handlers, shown, state };
}

async function dispatchPush(sw, payload) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const event = {
        data: { json: () => JSON.parse(raw) },
        waitUntil(p) { this.pending = p; },
    };
    sw.handlers.get('push')(event);
    await event.pending;
}

async function dispatchClick(sw, notification) {
    const event = {
        notification: { close() { this.closed = true; }, ...notification },
        waitUntil(p) { this.pending = p; },
    };
    sw.handlers.get('notificationclick')(event);
    await event.pending;
}

test('SW parses FCM envelope {notification, data}: orderId and tag survive nesting', async () => {
    const sw = makeSw();
    await dispatchPush(sw, {
        notification: { title: 'Mi Barrio TPV', body: 'Nuevo pedido pendiente en el TPV.' },
        data: { type: 'tpv-new-order', orderId: 'a1', tag: 'tpv-new-order-a1' },
        android: { notification: { tag: 'tpv-new-order-a1' } },
    });
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].opts.tag, 'tpv-new-order-a1');
});

test('SW parses deeply nested {data:{data, notification}} envelopes', async () => {
    const sw = makeSw();
    await dispatchPush(sw, {
        data: {
            notification: { title: 'Mi Barrio TPV', body: 'x' },
            data: { type: 'tpv-new-order', orderId: 'b2', tag: 'tpv-new-order-b2' },
        },
    });
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].opts.tag, 'tpv-new-order-b2');
});

test('SW: distinct order ids produce distinct, stable per-order tags', async () => {
    const sw = makeSw();
    await dispatchPush(sw, { data: { orderId: 'c3' } });
    await dispatchPush(sw, { data: { orderId: 'd4' } });
    await dispatchPush(sw, { data: { orderId: 'c3' } });
    assert.deepEqual(sw.shown.map((n) => n.opts.tag), ['tpv-new-order-c3', 'tpv-new-order-d4', 'tpv-new-order-c3']);
    assert.equal(new Set(sw.shown.map((n) => n.opts.tag)).size, 2);
});

test('SW: notification carries only generic content — payload PII never leaks', async () => {
    const sw = makeSw();
    await dispatchPush(sw, {
        data: { type: 'tpv-new-order', orderId: 'p9', cliente: { nombre: 'Juan Perez', celular: '0981123456' }, total: 99000 },
        notification: { title: 'Secreto', body: 'Juan Perez items 99000' },
    });
    const n = sw.shown[0];
    const flat = JSON.stringify(n);
    assert.ok(!flat.includes('Juan') && !flat.includes('0981123456') && !flat.includes('99000'));
    assert.equal(n.title, 'Mi Barrio - TPV Celular');
    assert.equal(n.opts.body, 'Nuevo pedido recibido');
});

test('SW: hostile tag is rejected; tag derives from orderId, and weird orderIds sanitize', async () => {
    const sw = makeSw();
    await dispatchPush(sw, { data: { orderId: 'e5', tag: '<script>alert(1)</script>' } });
    assert.equal(sw.shown[0].opts.tag, 'tpv-new-order-e5');
    await dispatchPush(sw, { data: { orderId: 'ok 1/../x', tag: 'con espacios y/mas' } });
    assert.equal(sw.shown[1].opts.tag, 'tpv-new-order-ok1..x');
});

test('SW: push without orderId never crashes and uses the shared fallback tag', async () => {
    const sw = makeSw();
    await dispatchPush(sw, { notification: { title: 'x', body: 'y' } });
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].opts.tag, 'tpv-new-order-sin-id');
    await dispatchPush(sw, 'not-json{{{');
    assert.equal(sw.shown.length, 2);
    assert.equal(sw.shown[1].opts.tag, 'tpv-new-order-sin-id');
});

test('SW: notification icon and click target stay inside this app scope, no PII', async () => {
    const sw = makeSw();
    await dispatchPush(sw, { data: { orderId: 'g7' } });
    const n = sw.shown[0];
    assert.equal(n.opts.icon, './icon-192.png');
    assert.equal(n.opts.data.url, './');
});

test('SW: notificationclick focuses an own-scope client; cross-scope client is never focused', async () => {
    const sw = makeSw();
    sw.state.clientList = [
        { url: 'https://evil.example.test/x', focus: async () => { throw new Error('must not focus'); } },
        { url: 'https://tpv-celular.example.test/mi-barrio-tpv-celular/index.html', focus: async () => { sw.state.focused = 'own'; return 'own'; } },
    ];
    await dispatchClick(sw, { data: { url: './', orderId: 'g7' } });
    assert.equal(sw.state.focused, 'own');
    assert.equal(sw.state.opened, null);
});

test('SW: notificationclick with no own-scope client opens the own-scope target', async () => {
    const sw = makeSw();
    sw.state.clientList = [{ url: 'https://evil.example.test/x', focus: async () => 'evil' }];
    await dispatchClick(sw, { data: { url: './', orderId: 'g7' } });
    assert.equal(sw.state.opened, './');
});

// ===== Payment transaction plan: latest-doc authoritative, single write set =====
// RED until buildPaymentPlan exists in push-helpers.js. The dynamic import keeps the
// rest of the suite running so the RED is attributed to THIS blocker only.
const paymentMod = () => import('./push-helpers.js');

const CUR = Object.freeze({ total: 50000, estado: 'entregado', pagado: false, tipo: 'retiro', origen: 'local' });

test('buildPaymentPlan: every paid type yields en_camino with exactly the five payment keys', async () => {
    const { buildPaymentPlan } = await paymentMod();
    for (const tipo of ['delivery', 'retiro', 'local', undefined]) {
        const cur = { ...CUR, tipo };
        const r = buildPaymentPlan({ cur, metodo: 'efectivo', recibido: 50000, isAdmin: true });
        assert.equal(r.ok, true, tipo);
        assert.equal(r.update.estado, 'en_camino');
        assert.equal(r.update.pagado, true);
        assert.equal(r.update.pago, 'efectivo');
        assert.deepEqual(Object.keys(r.update).sort(), ['estado', 'pagado', 'pago', 'recibido', 'vuelto']);
    }
});

test('buildPaymentPlan: stage of the latest doc does not change the target state', async () => {
    const { buildPaymentPlan } = await paymentMod();
    for (const estado of ['nuevo', 'preparacion', 'en_camino', 'entregado']) {
        const r = buildPaymentPlan({ cur: { ...CUR, estado }, metodo: 'transferencia', isAdmin: true });
        assert.equal(r.update.estado, 'en_camino', estado);
        assert.equal(r.update.recibido, null);
        assert.equal(r.update.vuelto, null);
    }
});

test('buildPaymentPlan: paid in modo POS keeps pos and carries no recibido/vuelto', async () => {
    const { buildPaymentPlan } = await paymentMod();
    const r = buildPaymentPlan({ cur: CUR, metodo: 'pos', isAdmin: true });
    assert.equal(r.update.pago, 'pos');
    assert.equal(r.update.recibido, null);
    assert.equal(r.update.vuelto, null);
});

test('buildPaymentPlan: already-paid latest state rejects with no update (stale snapshot safe)', async () => {
    const { buildPaymentPlan } = await paymentMod();
    const r = buildPaymentPlan({ cur: { ...CUR, pagado: true }, metodo: 'efectivo', recibido: 50000, isAdmin: true });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'already-paid');
    assert.equal(r.update, undefined);
});

test('buildPaymentPlan: canceled/archived orders fail closed as invalid business inputs', async () => {
    const { buildPaymentPlan } = await paymentMod();
    for (const estado of ['cancelado', 'archivado']) {
        const r = buildPaymentPlan({ cur: { ...CUR, estado }, metodo: 'efectivo', recibido: 50000, isAdmin: true });
        assert.equal(r.ok, false, estado);
        assert.equal(r.reason, 'not-chargeable');
        assert.equal(r.update, undefined);
    }
});

test('buildPaymentPlan: non-admin is rejected before any write', async () => {
    const { buildPaymentPlan } = await paymentMod();
    const r = buildPaymentPlan({ cur: CUR, metodo: 'efectivo', recibido: 50000, isAdmin: false });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-admin');
    assert.equal(r.update, undefined);
});

test('buildPaymentPlan: total, method and cash bounds rejected without an update', async () => {
    const { buildPaymentPlan } = await paymentMod();
    assert.equal(buildPaymentPlan({ cur: { ...CUR, total: NaN }, metodo: 'efectivo', recibido: 0, isAdmin: true }).reason, 'total-invalido');
    assert.equal(buildPaymentPlan({ cur: { ...CUR, total: -1 }, metodo: 'efectivo', recibido: 0, isAdmin: true }).reason, 'total-invalido');
    assert.equal(buildPaymentPlan({ cur: CUR, metodo: 'tarjeta', recibido: 0, isAdmin: true }).reason, 'metodo-invalido');
    const corto = buildPaymentPlan({ cur: CUR, metodo: 'efectivo', recibido: 20000, isAdmin: true });
    assert.equal(corto.reason, 'efectivo-incompleto');
    assert.equal(corto.falta, 30000);
    assert.equal(corto.update, undefined);
});

test('buildPaymentPlan: cash 0/null received means exact payment (original UX preserved)', async () => {
    const { buildPaymentPlan } = await paymentMod();
    for (const recibido of [0, null, undefined]) {
        const r = buildPaymentPlan({ cur: CUR, metodo: 'efectivo', recibido, isAdmin: true });
        assert.equal(r.ok, true);
        assert.equal(r.update.recibido, 50000);
        assert.equal(r.update.vuelto, 0);
    }
    const over = buildPaymentPlan({ cur: CUR, metodo: 'efectivo', recibido: 100000, isAdmin: true });
    assert.equal(over.vuelto, 50000);
    assert.equal(over.update.recibido, 100000);
});

test('buildPaymentPlan: does not mutate the snapshot it was given', async () => {
    const { buildPaymentPlan } = await paymentMod();
    const cur = { ...CUR };
    buildPaymentPlan({ cur, metodo: 'efectivo', recibido: 50000, isAdmin: true });
    assert.deepEqual(cur, CUR);
});

// ===== Push controller: production path with a controlled async scheduler =====
// RED until createPushController exists in push-helpers.js. Registration is PAUSED
// at the callable, logout is requested while paused, then registration is released.
const controllerMod = () => import('./push-helpers.js');

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

function makeDeps(overrides = {}) {
    const state = {
        backend: new Set(),          // server subscription registry (empty at start/end)
        browserToken: null,          // what the browser holds
        storage: new Map([['tpvPushToken', '']]),
        calls: [],
        uid: 'e8czOfuF82VqPwNUZjMpOSMHUQo2',
        signedOut: false,
        permission: 'granted',
        permissionRequests: 0,
        supported: true,
    };
    const deps = {
        cfg: { enabled: true, vapidKey: 'B-test-vapid-key' },
        isSupported: async () => state.supported,
        getPermission: () => state.permission,
        requestPermission: async () => { state.permissionRequests += 1; state.permission = 'granted'; return 'granted'; },
        registerSW: async () => { state.calls.push('register-sw'); return { scope: './' }; },
        waitForSWReady: async () => { state.calls.push('sw-ready'); },
        getToken: async () => { state.calls.push('get-token'); return 'tok-race'; },
        deleteBrowserToken: async () => { state.calls.push('delete-browser-token'); state.browserToken = null; },
        callRegister: overrides.callRegister || (async ({ token }) => { state.calls.push('server-register'); state.backend.add(token); state.browserToken = token; return { ok: true }; }),
        callUnregister: overrides.callUnregister || (async ({ token }) => { state.calls.push('server-unregister'); state.backend.delete(token); return { ok: true }; }),
        storage: {
            get: (k) => state.storage.get(k) || '',
            set: (k, v) => { state.storage.set(k, v); },
            remove: (k) => { state.storage.delete(k); },
        },
        getAuthUid: () => state.uid,
        signOut: overrides.signOut || (async () => { state.calls.push('sign-out'); state.signedOut = true; state.uid = null; }),
        ...overrides.deps,
    };
    return { deps, state };
}

test('controller: paused register + logout request → unregister strictly before sign-out, backend empty', async () => {
    const { createPushController } = await controllerMod();
    const gate = deferred();
    const order = [];
    const { deps, state } = makeDeps({
        callRegister: async ({ token }) => { order.push('register'); state.backend.add(token); await gate.promise; order.push('register-accepted'); return { ok: true }; },
        callUnregister: async ({ token }) => { order.push('unregister'); state.backend.delete(token); return { ok: true }; },
        signOut: async () => { order.push('sign-out'); state.signedOut = true; state.uid = null; },
    });
    const c = createPushController(deps);
    const pActivar = c.activarNotificaciones();
    await tick(); await tick(); // let activation reach the paused callable
    const pSalir = c.cerrarSesion();   // logout starts while register is in flight
    await tick(); await tick();
    gate.resolve();                    // release the accepted registration
    const [ra, rb] = await Promise.all([pActivar, pSalir]);
    assert.equal(ra.ok, true);
    assert.equal(rb.ok, true);
    assert.deepEqual(order, ['register', 'register-accepted', 'unregister', 'sign-out']);
    assert.equal(state.backend.size, 0);
    assert.equal(!!state.storage.get('tpvPushToken'), false);
    assert.equal(state.signedOut, true);
});

test('controller: no activation may start once logout is requested', async () => {
    const { createPushController } = await controllerMod();
    const { deps, state } = makeDeps();
    state.storage.set('tpvPushToken', 'tok-x');
    const c = createPushController(deps);
    const pSalir = c.cerrarSesion();
    const res = await c.activarNotificaciones(); // logout already in progress
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'logout-en-curso');
    assert.equal(state.permissionRequests, 0);
    assert.equal(state.calls.includes('register-sw'), false);
    await pSalir;
});

test('controller: missing push config never requests permission, never registers', async () => {
    const { createPushController } = await controllerMod();
    const { deps, state } = makeDeps();
    deps.cfg = { enabled: false, vapidKey: '' };
    const c = createPushController(deps);
    const res = await c.activarNotificaciones();
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'config');
    assert.equal(state.permissionRequests, 0);
    assert.equal(state.calls.length, 0);
    assert.equal(state.backend.size, 0);
});

test('controller: unsupported browser and denied permission never request tokens', async () => {
    const { createPushController } = await controllerMod();
    const d1 = makeDeps();
    d1.deps.cfg = { enabled: true, vapidKey: 'B-test' };
    d1.state.supported = false;
    const r1 = await createPushController(d1.deps).activarNotificaciones();
    assert.equal(r1.reason, 'unsupported');
    assert.equal(d1.state.permissionRequests, 0);
    const d2 = makeDeps();
    d2.state.permission = 'denied';
    const r2 = await createPushController(d2.deps).activarNotificaciones();
    assert.equal(r2.reason, 'denied');
    assert.equal(d2.state.permissionRequests, 0);
});

test('controller: session vanishing mid-activation aborts without contacting the backend', async () => {
    const { createPushController } = await controllerMod();
    const { deps, state } = makeDeps();
    const realGetToken = deps.getToken;
    deps.getToken = async (...a) => { const t = await realGetToken(...a); state.uid = null; return t; };
    const res = await createPushController(deps).activarNotificaciones();
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'session-ended');
    assert.equal(state.calls.includes('server-register'), false);
    assert.equal(state.backend.size, 0);
    assert.equal(state.browserToken, null); // browser token was rolled back
    assert.equal(!!state.storage.get('tpvPushToken'), false);
});

test('controller: account change mid-activation aborts and never advertises active', async () => {
    const { createPushController } = await controllerMod();
    const { deps, state } = makeDeps();
    const realGetToken = deps.getToken;
    deps.getToken = async (...a) => { const t = await realGetToken(...a); state.uid = 'otro-uid'; return t; };
    const res = await createPushController(deps).activarNotificaciones();
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'account-changed');
    assert.equal(state.calls.includes('server-register'), false);
    assert.equal(state.backend.size, 0);
    assert.equal(!!state.storage.get('tpvPushToken'), false);
});

test('controller: backend revoke failure aborts logout honestly; session and storage kept', async () => {
    const { createPushController } = await controllerMod();
    const { deps, state } = makeDeps({ callUnregister: async () => { throw new Error('unavailable'); } });
    state.storage.set('tpvPushToken', 'tok-keep');
    state.backend.add('tok-keep');
    state.signedOut = false;
    const res = await createPushController(deps).cerrarSesion();
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'server');
    assert.equal(state.signedOut, false);
    assert.equal(state.storage.get('tpvPushToken'), 'tok-keep');
    assert.deepEqual(state.calls.includes('delete-browser-token'), false, 'browser token untouched while subscription exists');
});

test('controller: browser delete failure aborts logout; storage kept for retry; backend already clean', async () => {
    const { createPushController } = await controllerMod();
    const { deps, state } = makeDeps({ deps: {} });
    deps.deleteBrowserToken = async () => { throw new Error('boom'); };
    state.storage.set('tpvPushToken', 'tok-keep');
    state.backend.add('tok-keep');
    const res = await createPushController(deps).cerrarSesion();
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'browser');
    assert.equal(state.signedOut, false);
    assert.equal(state.backend.size, 0);
    assert.equal(state.storage.get('tpvPushToken'), 'tok-keep');
});

test('controller: activation backend failure rolls back browser token and storage', async () => {
    const { createPushController } = await controllerMod();
    const { deps, state } = makeDeps({ callRegister: async () => { state.calls.push('server-register'); throw new Error('unavailable'); } });
    const res = await createPushController(deps).activarNotificaciones();
    assert.equal(res.ok, false);
    assert.equal(state.calls.includes('delete-browser-token'), true);
    assert.equal(!!state.storage.get('tpvPushToken'), false);
    assert.equal(state.backend.size, 0);
});


