// Mi Barrio - TPV Celular: pure, dependency-injected helpers.
// Used by the app (index.html) and by test.mjs. No Firebase imports here so the
// module stays unit-testable in plain Node. Spanish UI lives in index.html;
// identifiers and comments stay in English.

// Administrator identity required by the existing Firestore rules (esAdmin()).
// The frontend check SUPPLEMENTS the rules; it never replaces them.
export const ADMIN_UID = 'e8czOfuF82VqPwNUZjMpOSMHUQo2';

export function isAdminUid(uid) {
    return typeof uid === 'string' && uid.length > 0 && uid === ADMIN_UID;
}

// Auth gate: resolve before ANY Firestore listener starts.
export function resolveAdminAccess(user) {
    if (!user || typeof user !== 'object') return { ok: false, reason: 'no-session' };
    if (!isAdminUid(user.uid)) return { ok: false, reason: 'not-admin' };
    return { ok: true };
}

// ===== Push configuration (public settings only, disabled by default) =====
export const PUSH_UI = Object.freeze({
    PENDING: 'pending-setup',
    BLOCKED: 'permission-blocked',
    INACTIVE: 'inactive',
    ACTIVE: 'active',
    UNSUPPORTED: 'unsupported',
});

export function pushConfigReady(cfg) {
    return !!cfg
        && cfg.enabled === true
        && typeof cfg.vapidKey === 'string'
        && cfg.vapidKey.trim().length > 0;
}

// Resolve which UI state the notifications button shows.
// Never requests permission; pure decision from config + browser state.
export function resolvePushUiState({ cfg, supported, permission, registered } = {}) {
    if (!pushConfigReady(cfg)) return PUSH_UI.PENDING;
    if (!supported) return PUSH_UI.UNSUPPORTED;
    if (permission === 'denied') return PUSH_UI.BLOCKED;
    if (permission === 'granted' && registered) return PUSH_UI.ACTIVE;
    return PUSH_UI.INACTIVE;
}

// Permission may ONLY be requested when config is ready, the browser supports
// push, and the user never decided before. Callers must invoke this from an
// explicit user gesture.
export function canRequestPushPermission({ cfg, supported, permission } = {}) {
    return pushConfigReady(cfg) && supported === true && permission === 'default';
}

// ===== Notifications (generic, no PII) =====
// Stable per-order tag bounds visual duplication; it is not an exactly-once guarantee.
// Namespace must match the sender (tpv-push-backend): tpv-new-order-<orderId>.
export function orderTag(orderId) {
    const id = String(orderId == null ? '' : orderId).trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60);
    return 'tpv-new-order-' + (id || 'sin-id');
}

// Deterministic, data-only shape used by the service worker and the sender contract.
// Never carries customer name, phone, address or totals.
export function buildGenericNotification(payload = {}) {
    const orderId = payload && typeof payload.orderId !== 'undefined' ? String(payload.orderId) : '';
    return {
        title: 'Mi Barrio - TPV Celular',
        body: 'Nuevo pedido recibido',
        tag: orderTag(orderId),
        orderId: orderId,
    };
}

// ===== Payment (cobro) effect =====
// Project invariant (spec, all order types): a PAID order belongs in the delivery
// flow — it moves to en_camino regardless of tipo (delivery/retiro/local) and
// regardless of the previous stage. Retiro/local keep their tipo/origen; only the
// estado changes so the repartidor app (which filters estado == 'en_camino') sees
// every paid order.
//
// buildPaymentPlan is authoritative: callers MUST pass the LATEST document data
// (read inside the transaction), not the list snapshot, so a stale view cannot
// double-charge or write over a canceled/paid order. Every rejection returns an
// update: undefined plan so a rejected input can never reach Firestore.
export function buildPaymentPlan({ cur, metodo, recibido, isAdmin } = {}) {
    const PAGOS_OK = ['efectivo', 'transferencia', 'pos'];
    if (!isAdmin) return { ok: false, reason: 'not-admin' };
    const latest = cur && typeof cur === 'object' ? cur : {};
    if (latest.pagado === true) return { ok: false, reason: 'already-paid' };
    const estado = String(latest.estado || '');
    if (estado === 'cancelado' || estado === 'archivado') {
        return { ok: false, reason: 'not-chargeable' };
    }
    const t = Number(latest.total);
    if (!Number.isFinite(t) || t < 0) return { ok: false, reason: 'total-invalido' };
    const m = String(metodo || '');
    if (!PAGOS_OK.includes(m)) return { ok: false, reason: 'metodo-invalido' };
    const efectivo = m === 'efectivo';
    let rec = t;
    if (efectivo) {
        const raw = Number(recibido);
        rec = (recibido == null || !Number.isFinite(raw) || raw <= 0) ? t : Math.round(raw);
        if (rec < t) return { ok: false, reason: 'efectivo-incompleto', falta: t - rec };
    }
    const vuelto = efectivo ? rec - t : 0;
    return {
        ok: true,
        // Exactly the payment metadata keys allowed by the proposed admin rule
        // (pago, pagado, cobradoEn, recibido, vuelto, estado). cobradoEn is added by
        // the caller with serverTimestamp(); nothing else is written by a payment.
        update: {
            pago: m,
            pagado: true,
            recibido: efectivo ? rec : null,
            vuelto: efectivo ? vuelto : null,
            estado: 'en_camino',
        },
        vuelto,
        total: t,
    };
}

// ===== Registration / revocation (dependency-injected) =====
// register: token -> callable registerTpvDevice({ token }). Throws on failure so the
// caller can roll back (delete the browser token) and stay honestly "not active".
export async function registerDeviceToken({ callRegister, token }) {
    const t = String(token || '').trim();
    if (!t) throw new Error('token-vacio');
    if (typeof callRegister !== 'function') throw new Error('registrar-no-disponible');
    return callRegister({ token: t });
}

export async function unregisterDeviceToken({ callUnregister, token }) {
    const t = String(token || '').trim();
    if (!t) throw new Error('token-vacio');
    if (typeof callUnregister !== 'function') throw new Error('desregistrar-no-disponible');
    return callUnregister({ token: t });
}

// ===== Push orchestration (production path, dependency-injected) =====
// Same logic the app wires to its buttons; tests drive it with a controlled scheduler.
// Goals:
//  - One awaited lock serializes activation, deactivation and logout.
//  - No activation may start once logout begins (logout sets the flag synchronously).
//  - Logout waits for an accepted in-flight activation, revokes the EXACT stored token
//    while auth is still active, deletes the browser token, and only then signs out.
//  - Any failure aborts logout honestly; localStorage is cleared only after a revoke
//    that actually happened (or an explicit nothing-to-revoke skip).
//  - Account generation is validated after every await: if the session vanished or
//    changed, activation rolls the browser token back and never contacts the backend.
export function createPushController(deps = {}) {
    const {
        cfg, isSupported, getPermission, requestPermission,
        registerSW, waitForSWReady, getToken, deleteBrowserToken,
        callRegister, callUnregister, storage, getAuthUid, signOut,
    } = deps;
    let logoutRequested = false;
    let lock = Promise.resolve();
    const exclusive = (fn) => {
        const run = lock.then(() => fn());
        lock = run.then(() => {}, () => {});
        return run;
    };
    const storeGet = () => { try { return storage.get('tpvPushToken') || ''; } catch (e) { return ''; } };
    const storeSet = (v) => { try { storage.set('tpvPushToken', v); } catch (e) { /* storage unavailable: state reported via return values */ } };
    const storeClear = () => { try { storage.remove('tpvPushToken'); } catch (e) {} };

    async function activarNotificaciones() {
        if (logoutRequested) return { ok: false, reason: 'logout-en-curso' };
        return exclusive(async () => {
            if (logoutRequested) return { ok: false, reason: 'logout-en-curso' };
            const uidInicial = typeof getAuthUid === 'function' ? getAuthUid() : null;
            if (!isAdminUid(uidInicial)) return { ok: false, reason: 'not-admin' };
            if (!pushConfigReady(cfg)) return { ok: false, reason: 'config' };
            try {
                const suportado = typeof isSupported === 'function' ? await isSupported() : false;
                if (!suportado) return { ok: false, reason: 'unsupported' };
                let perm = typeof getPermission === 'function' ? getPermission() : 'denied';
                if (perm === 'denied') return { ok: false, reason: 'denied' };
                if (perm === 'default') {
                    perm = await requestPermission(); // only ever from this explicit gesture path
                }
                if (perm !== 'granted') return { ok: false, reason: 'permission-not-granted' };
                const reg = await registerSW();
                if (typeof waitForSWReady === 'function') await waitForSWReady();
                const token = await getToken({ vapidKey: String(cfg.vapidKey).trim(), serviceWorkerRegistration: reg });
                // Account generation re-check after every await; the browser token must
                // be rolled back if the session ended or belongs to someone else now.
                const uidActual = typeof getAuthUid === 'function' ? getAuthUid() : null;
                if (!uidActual) {
                    try { await deleteBrowserToken(); } catch (e) { /* best effort rollback */ }
                    return { ok: false, reason: 'session-ended' };
                }
                if (uidActual !== uidInicial) {
                    try { await deleteBrowserToken(); } catch (e) { /* best effort rollback */ }
                    return { ok: false, reason: 'account-changed' };
                }
                if (!token) return { ok: false, reason: 'token-vacio' };
                await callRegister({ token }); // throws -> rollback below
                storeSet(token);
                return { ok: true, token };
            } catch (e) {
                try { await deleteBrowserToken(); } catch (e2) { /* browser token may not exist */ }
                storeClear();
                return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
            }
        });
    }

    async function desactivarNotificaciones() {
        return exclusive(async () => {
            const token = storeGet();
            const res = await revokePushBeforeLogout({ token, callUnregister, deleteBrowserToken });
            if (!res.ok) return { ok: false, stage: res.stage, error: res.error };
            storeClear();
            return { ok: true, skipped: !!res.skipped };
        });
    }

    async function cerrarSesion() {
        logoutRequested = true; // synchronous: blocks any activation that starts now
        return exclusive(async () => {
            const token = storeGet();
            const res = await revokePushBeforeLogout({ token, callUnregister, deleteBrowserToken });
            if (!res.ok) {
                // Honest abort: no sign-out while a device subscription may stay active,
                // and the stored token is kept so a retry can complete the revoke.
                return { ok: false, stage: res.stage, error: res.error };
            }
            storeClear();
            await signOut();
            return { ok: true };
        });
    }

    return { activarNotificaciones, desactivarNotificaciones, cerrarSesion };
}

// Logout ordering: server-side revocation MUST happen BEFORE the browser token is
// deleted and BEFORE Firebase Auth sign-out. Any failure aborts the logout so the
// app never reports a successful sign-out while a device subscription stays active.
export async function revokePushBeforeLogout({ token, callUnregister, deleteBrowserToken } = {}) {
    const t = String(token || '').trim();
    if (!t) return { ok: true, skipped: true };
    try {
        await unregisterDeviceToken({ callUnregister, token: t });
    } catch (e) {
        return { ok: false, stage: 'server', error: e };
    }
    try {
        if (typeof deleteBrowserToken === 'function') await deleteBrowserToken();
    } catch (e) {
        return { ok: false, stage: 'browser', error: e };
    }
    return { ok: true, skipped: false };
}

// Mobile snapshots never trigger automatic printing (unlike the PC panel).
// Explicit print buttons stay available.
export function mobileAutoPrintAllowed() {
    return false;
}
