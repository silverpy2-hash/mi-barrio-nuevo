import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createFirestoreStore } from './src/firestore-store.js';

import {
  createTpvPushBackend,
  TpvPushError,
} from './src/core.js';

// ---------------------------------------------------------------------------
// Deterministic in-memory adapters. Production wiring lives in src/index.js;
// these adapters exist so the core logic is exercised without the Firebase
// SDK, network access or credentials. There is no test-only production path:
// handlers below are the same handler factories the deployed module uses.
// ---------------------------------------------------------------------------

function createFakeStore(initialDocs = {}) {
  const docs = new Map(Object.entries(initialDocs));
  const calls = { set: 0, delete: 0, get: 0, list: 0 };
  return {
    calls,
    docs,
    async getDoc(id) {
      calls.get += 1;
      return docs.has(id) ? { id, ...docs.get(id) } : null;
    },
    async setDoc(id, data) {
      calls.set += 1;
      docs.set(id, { ...(docs.get(id) ?? {}), ...data });
    },
    async deleteDoc(id) {
      calls.delete += 1;
      docs.delete(id);
    },
    async deleteDocIfMatches(id, expected) {
      calls.delete += 1;
      const current = docs.get(id);
      if (!current) return false;
      if (current.adminUid !== expected.adminUid || current.token !== expected.token || current.revision !== expected.revision) {
        return false;
      }
      docs.delete(id);
      return true;
    },
    async listDevices(adminUid) {
      calls.list += 1;
      return [...docs.entries()]
        .filter(([, d]) => d.adminUid === adminUid)
        .map(([id, d]) => ({ id, ...d }));
    },
  };
}

function createFakeMessaging(behavior = {}) {
  const calls = [];
  return {
    calls,
    async sendEachForMulticast(message) {
      calls.push(message);
      const responses = message.tokens.map((token) => {
        if (behavior.throw) {
          throw behavior.throw;
        }
        const b = behavior[token] ?? behavior.default ?? { success: true };
        if (b.throw) {
          throw b.throw;
        }
        if (b.success === false) {
          return { success: false, error: { code: b.code ?? 'messaging/unknown-error' } };
        }
        return { success: true };
      });
      return { responses, successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length };
    },
  };
}

function createSilentLogger() {
  const entries = [];
  const push = (level) => (...args) => entries.push({ level, args });
  return { entries, info: push('info'), warn: push('warn'), error: push('error') };
}

const ADMIN_UID = 'admin-uid-example';
const OTHER_UID = 'other-uid-example';

function fakeHash(input) {
  return createHash('sha256').update(String(input)).digest('hex');
}

function makeBackend({ store, messaging, logger, configuredAdminUid = ADMIN_UID, now = () => 1000 } = {}) {
  return createTpvPushBackend({
    store: store ?? createFakeStore(),
    messaging: messaging ?? createFakeMessaging(),
    logger: logger ?? createSilentLogger(),
    configuredAdminUid,
    hashToken: fakeHash,
    now,
    batchSize: 2,
  });
}

const caller = (uid) => ({ uid, token: { uid } });
const callableRequest = (data, uid) => ({ data, auth: uid ? caller(uid) : null });

// ---------------------------------------------------------------------------
// registerTpvDevice
// ---------------------------------------------------------------------------

test('registerTpvDevice rejects unauthenticated callers with no persisted mutation', async () => {
  const store = createFakeStore();
  const backend = makeBackend({ store });
  await assert.rejects(
    backend.registerTpvDevice(callableRequest({ token: 'tok-1' }, null)),
    (err) => err instanceof TpvPushError && err.code === 'unauthenticated',
  );
  assert.equal(store.calls.set, 0);
  assert.equal(store.docs.size, 0);
});

test('registerTpvDevice rejects a verified user that is not the configured admin', async () => {
  const store = createFakeStore();
  const backend = makeBackend({ store });
  await assert.rejects(
    backend.registerTpvDevice(callableRequest({ token: 'tok-1' }, OTHER_UID)),
    (err) => err.code === 'permission-denied',
  );
  assert.equal(store.calls.set, 0);
  assert.equal(store.docs.size, 0);
});

test('registerTpvDevice fails closed when TPV_ADMIN_UID is not configured', async () => {
  const store = createFakeStore();
  for (const configuredAdminUid of ['', '   ', null]) {
    const backend = makeBackend({ store, configuredAdminUid });
    await assert.rejects(
      backend.registerTpvDevice(callableRequest({ token: 'tok-1' }, ADMIN_UID)),
      (err) => err.code === 'failed-precondition',
    );
  }
  assert.equal(store.calls.set, 0);
  assert.equal(store.docs.size, 0);
});

test('registerTpvDevice rejects invalid tokens without mutating storage', async () => {
  const store = createFakeStore();
  const backend = makeBackend({ store });
  const badTokens = ['', '   ', 123, null, undefined, {}, 'x'.repeat(4097)];
  for (const token of badTokens) {
    await assert.rejects(
      backend.registerTpvDevice(callableRequest({ token }, ADMIN_UID)),
      (err) => err.code === 'invalid-argument',
    );
  }
  assert.equal(store.calls.set, 0);
  assert.equal(store.docs.size, 0);
});

test('registerTpvDevice stores a server-only doc under a hashed id bound to the admin', async () => {
  const store = createFakeStore();
  const backend = makeBackend({ store });
  const result = await backend.registerTpvDevice(callableRequest({ token: 'device-token-abc' }, ADMIN_UID));
  assert.deepEqual(result, { registered: true });
  assert.equal(store.docs.size, 1);
  const [[id, doc]] = [...store.docs.entries()];
  assert.equal(id, fakeHash(`${ADMIN_UID}:device-token-abc`));
  assert.equal(id.includes('device-token-abc'), false);
  assert.equal(doc.adminUid, ADMIN_UID);
  assert.equal(doc.token, 'device-token-abc');
  assert.equal(typeof doc.updatedAt, 'number');
  assert.equal(store.calls.set, 1);
});

test('registerTpvDevice is idempotent and safe for multiple devices of the same admin', async () => {
  const store = createFakeStore();
  let tick = 1000;
  const backend = makeBackend({ store, now: () => (tick += 10) });
  await backend.registerTpvDevice(callableRequest({ token: 'tok-a' }, ADMIN_UID));
  await backend.registerTpvDevice(callableRequest({ token: 'tok-b' }, ADMIN_UID));
  assert.equal(store.docs.size, 2);
  await backend.registerTpvDevice(callableRequest({ token: 'tok-a' }, ADMIN_UID));
  assert.equal(store.docs.size, 2);
  const idA = fakeHash(`${ADMIN_UID}:tok-a`);
  assert.equal(store.docs.get(idA).updatedAt, 1030);
});

// ---------------------------------------------------------------------------
// unregisterTpvDevice
// ---------------------------------------------------------------------------

test('unregisterTpvDevice revokes only the bound token and is idempotent', async () => {
  const store = createFakeStore();
  const backend = makeBackend({ store });
  await backend.registerTpvDevice(callableRequest({ token: 'tok-a' }, ADMIN_UID));
  await backend.registerTpvDevice(callableRequest({ token: 'tok-b' }, ADMIN_UID));

  const first = await backend.unregisterTpvDevice(callableRequest({ token: 'tok-a' }, ADMIN_UID));
  assert.deepEqual(first, { revoked: true });
  assert.equal(store.docs.has(fakeHash(`${ADMIN_UID}:tok-a`)), false);
  assert.equal(store.docs.has(fakeHash(`${ADMIN_UID}:tok-b`)), true);

  const second = await backend.unregisterTpvDevice(callableRequest({ token: 'tok-a' }, ADMIN_UID));
  assert.deepEqual(second, { revoked: true });
  assert.equal(store.calls.delete, 2);
});

test('unregisterTpvDevice rejects unauthenticated and non-admin callers without deleting', async () => {
  const store = createFakeStore();
  const backend = makeBackend({ store });
  await backend.registerTpvDevice(callableRequest({ token: 'tok-a' }, ADMIN_UID));
  const before = store.calls.delete;

  await assert.rejects(
    backend.unregisterTpvDevice(callableRequest({ token: 'tok-a' }, null)),
    (err) => err.code === 'unauthenticated',
  );
  await assert.rejects(
    backend.unregisterTpvDevice(callableRequest({ token: 'tok-a' }, OTHER_UID)),
    (err) => err.code === 'permission-denied',
  );
  assert.equal(store.calls.delete, before);
  assert.equal(store.docs.size, 1);
});

test('unregisterTpvDevice fails closed when admin UID is not configured', async () => {
  const store = createFakeStore({
    [fakeHash(`${ADMIN_UID}:tok-a`)]: { token: 'tok-a', adminUid: ADMIN_UID, updatedAt: 1 },
  });
  const backend = makeBackend({ store, configuredAdminUid: '' });
  await assert.rejects(
    backend.unregisterTpvDevice(callableRequest({ token: 'tok-a' }, ADMIN_UID)),
    (err) => err.code === 'failed-precondition',
  );
  assert.equal(store.calls.delete, 0);
});

// ---------------------------------------------------------------------------
// notifyTpvNewOrder
// ---------------------------------------------------------------------------

const orderEvent = (id = 'order-1', eventId = 'event-1') => ({
  params: { id },
  id: eventId,
});

async function seedDevices(store, count, adminUid = ADMIN_UID) {
  for (let i = 0; i < count; i += 1) {
    await store.setDoc(fakeHash(`${adminUid}:seed-${i}`), {
      token: `seed-${i}`,
      adminUid,
      updatedAt: 100 + i,
      revision: `rev-seed-${i}`,
    });
  }
  store.calls.set = 0;
}

test('notifyTpvNewOrder sends a generic no-PII notification to registered admin devices only', async () => {
  const store = createFakeStore();
  await seedDevices(store, 2, ADMIN_UID);
  await seedDevices(store, 1, OTHER_UID); // must never receive the notification
  const messaging = createFakeMessaging();
  const backend = makeBackend({ store, messaging });

  const summary = await backend.notifyTpvNewOrder(orderEvent('order-9', 'event-9'));
  assert.equal(summary.attempted, 2);
  assert.equal(summary.succeeded, 2);
  assert.equal(messaging.calls.length, 1);
  const message = messaging.calls[0];
  assert.deepEqual(message.tokens.sort(), ['seed-0', 'seed-1']);
  const serialized = JSON.stringify(message);
  for (const pii of ['cliente', 'pizzas', 'total', 'mensaje', 'pago', 'telefono', 'direccion']) {
    assert.equal(serialized.includes(pii), false, `payload must not include ${pii}`);
  }
  assert.equal(message.data.orderId, 'order-9');
  assert.equal(message.data.tag, 'tpv-new-order-order-9');
  assert.equal(message.android?.notification?.tag, 'tpv-new-order-order-9');
});

test('notifyTpvNewOrder bounds fanout to the configured batch size', async () => {
  const store = createFakeStore();
  await seedDevices(store, 5, ADMIN_UID);
  const messaging = createFakeMessaging();
  const backend = makeBackend({ store, messaging }); // batchSize: 2 in makeBackend

  const summary = await backend.notifyTpvNewOrder(orderEvent());
  assert.equal(summary.attempted, 5);
  assert.equal(messaging.calls.length, 3);
  assert.deepEqual(messaging.calls.map((c) => c.tokens.length), [2, 2, 1]);
});

test('notifyTpvNewOrder with no registered devices does not call messaging', async () => {
  const messaging = createFakeMessaging();
  const backend = makeBackend({ messaging });
  const summary = await backend.notifyTpvNewOrder(orderEvent());
  assert.equal(summary.attempted, 0);
  assert.equal(messaging.calls.length, 0);
});

test('notifyTpvNewOrder removes permanently invalid tokens and keeps healthy ones', async () => {
  const store = createFakeStore();
  await seedDevices(store, 3, ADMIN_UID);
  const messaging = createFakeMessaging({
    'seed-1': { success: false, code: 'messaging/registration-token-not-registered' },
  });
  const backend = makeBackend({ store, messaging });

  const summary = await backend.notifyTpvNewOrder(orderEvent());
  assert.equal(summary.invalidRemoved, 1);
  assert.equal(store.docs.has(fakeHash(`${ADMIN_UID}:seed-1`)), false);
  assert.equal(store.docs.has(fakeHash(`${ADMIN_UID}:seed-0`)), true);
  assert.equal(store.docs.has(fakeHash(`${ADMIN_UID}:seed-2`)), true);
});

test('notifyTpvNewOrder does not delete a freshly refreshed registration flagged stale', async () => {
  const store = createFakeStore();
  await seedDevices(store, 1, ADMIN_UID);
  const docId = fakeHash(`${ADMIN_UID}:seed-0`);
  const messaging = {
    calls: [],
    async sendEachForMulticast(message) {
      this.calls.push(message);
      // Simulate the device re-registering while the send was in flight:
      // the stored doc revision now differs from the snapshot that was sent.
      const current = await store.getDoc(docId);
      await store.setDoc(docId, { ...current, revision: 'rev-refreshed', updatedAt: current.updatedAt + 5000 });
      return {
        responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }],
        successCount: 0,
        failureCount: 1,
      };
    },
  };
  const backend = makeBackend({ store, messaging });
  const summary = await backend.notifyTpvNewOrder(orderEvent());
  assert.equal(summary.invalidRemoved, 0);
  assert.equal(store.docs.has(docId), true);
});

test('notifyTpvNewOrder keeps registrations on transient messaging failures and reports them', async () => {
  const store = createFakeStore();
  await seedDevices(store, 2, ADMIN_UID);
  const messaging = createFakeMessaging({
    'seed-0': { success: false, code: 'messaging/internal-error' },
  });
  const backend = makeBackend({ store, messaging });
  const summary = await backend.notifyTpvNewOrder(orderEvent());
  assert.equal(summary.attempted, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.invalidRemoved, 0);
  assert.equal(store.docs.size, 2);
});

test('notifyTpvNewOrder propagates messaging exceptions without deleting registrations', async () => {
  const store = createFakeStore();
  await seedDevices(store, 2, ADMIN_UID);
  const messaging = createFakeMessaging({
    default: { throw: new Error('network unavailable') },
  });
  const backend = makeBackend({ store, messaging });
  await assert.rejects(backend.notifyTpvNewOrder(orderEvent()), /network unavailable/);
  assert.equal(store.docs.size, 2);
});

test('notifyTpvNewOrder tolerates a missing order id and fails closed without admin config', async () => {
  const store = createFakeStore();
  await seedDevices(store, 1, ADMIN_UID);
  const messaging = createFakeMessaging();
  const backend = makeBackend({ store, messaging, configuredAdminUid: '' });
  await assert.rejects(backend.notifyTpvNewOrder(orderEvent()), (err) => err.code === 'failed-precondition');
  assert.equal(messaging.calls.length, 0);

  const noId = makeBackend({ store, messaging });
  await assert.rejects(noId.notifyTpvNewOrder({ params: {}, id: 'e' }), (err) => err.code === 'invalid-argument');
  assert.equal(messaging.calls.length, 0);
});

test('notifyTpvNewOrder logs counts only and never the raw token', async () => {
  const store = createFakeStore();
  await seedDevices(store, 1, ADMIN_UID);
  const logger = createSilentLogger();
  const backend = makeBackend({ store, logger });
  await backend.notifyTpvNewOrder(orderEvent('order-77'));
  const output = JSON.stringify(logger.entries);
  assert.equal(output.includes('seed-0'), false);
  assert.equal(output.includes('order-77'), true);
});

// ---------------------------------------------------------------------------
// B2: Real web-push nested payload contract (what the custom service worker
// actually receives and merges), not just top-level FCM fields.
// ---------------------------------------------------------------------------

function collectKeys(value, into = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      into.add(key);
      collectKeys(v, into);
    }
  }
  return into;
}

test('notifyTpvNewOrder webpush payload carries generic notification, stable tag and orderId for the SW receiver', async () => {
  const store = createFakeStore();
  await seedDevices(store, 1, ADMIN_UID);
  const messaging = createFakeMessaging();
  const backend = makeBackend({ store, messaging });

  await backend.notifyTpvNewOrder(orderEvent('order-42', 'event-42'));
  const message = messaging.calls[0];

  // Stable canonical tag everywhere (android, data, webpush) and no other tag invented.
  assert.equal(message.data.tag, 'tpv-new-order-order-42');
  assert.equal(message.android?.notification?.tag, 'tpv-new-order-order-42');
  assert.equal(message.webpush?.notification?.tag, 'tpv-new-order-order-42');

  // webpush.notification: generic text only, own-scope relative icon (no external origin).
  assert.equal(typeof message.webpush?.notification?.title, 'string');
  assert.equal(typeof message.webpush?.notification?.body, 'string');
  assert.equal(message.webpush?.notification?.icon, './icon-192.png');
  assert.ok(!/^https?:\/\//.test(message.webpush?.notification?.icon ?? ''), 'icon must not hardcode an external origin');

  // webpush.data: string values usable by the SW; mirrors message.data.
  assert.equal(message.webpush?.data?.orderId, 'order-42');
  assert.equal(message.webpush?.data?.tag, 'tpv-new-order-order-42');
  assert.equal(message.webpush?.data?.type, 'tpv-new-order');
  for (const v of Object.values(message.webpush.data)) assert.equal(typeof v, 'string');

  // No fcmOptions.link anywhere (no configured/validated destination exists).
  const serialized = JSON.stringify(message);
  assert.equal(serialized.includes('fcmOptions'), false);
  assert.equal(serialized.includes('"link"'), false);

  // Simulate the receiver contract for a NESTED FCM body: the service worker
  // (aligned by the frontend writer) reads orderId/tag from `data` and the
  // display title/body/tag/icon from `notification`.
  const body = JSON.parse(JSON.stringify({ notification: message.webpush.notification, data: message.webpush.data }));
  const nestedData = body.data ?? {};
  const nestedNotification = body.notification ?? {};
  assert.equal(nestedData.orderId, 'order-42');
  assert.equal(nestedData.tag, 'tpv-new-order-order-42');
  assert.equal(nestedNotification.tag, nestedData.tag);
  assert.equal(typeof nestedNotification.title, 'string');
  assert.equal(nestedNotification.icon, './icon-192.png');

  // No PII anywhere in the nested payload, recursively (keys and values).
  for (const key of collectKeys(message)) {
    for (const pii of ['cliente', 'pizzas', 'total', 'mensaje', 'pago', 'telefono', 'direccion', 'recibido', 'vuelto']) {
      assert.equal(key.includes(pii), false, `key ${key} leaks order PII`);
    }
  }
});

// ---------------------------------------------------------------------------
// B3: Atomic compare-and-delete for stale token cleanup.
// The production adapter (src/firestore-store.js) runs against a mocked
// Firestore transaction boundary with real optimistic-concurrency semantics.
// ---------------------------------------------------------------------------

function createMockFirestoreDb(initialDocs = {}) {
  const docs = new Map(Object.entries(initialDocs));
  let refreshOnceBeforeCommit = null;
  const snapshotFor = (id, data) => ({
    id,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : { ...data }),
  });
  const db = {
    docs,
    refreshDocOnce(id, data) {
      refreshOnceBeforeCommit = { id, data };
    },
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            async get() {
              return snapshotFor(id, docs.get(id));
            },
            async set(data) {
              docs.set(id, { ...data });
            },
            async delete() {
              docs.delete(id);
            },
          };
        },
        where(field, op, value) {
          assert.equal(op, '==');
          return {
            async get() {
              const matched = [...docs.entries()]
                .filter(([, d]) => d[field] === value)
                .map(([id, d]) => snapshotFor(id, d));
              return { docs: matched };
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const readRevisions = new Map();
        const stagedDeletes = [];
        const tx = {
          async get(ref) {
            const data = docs.get(ref.id);
            readRevisions.set(ref.id, data ? data.revision ?? null : null);
            return snapshotFor(ref.id, data);
          },
          delete(ref) {
            stagedDeletes.push(ref.id);
          },
        };
        const result = await fn(tx);
        // A queued refresh simulates a concurrent writer landing between the
        // read and the commit — the commit MUST NOT go through.
        if (refreshOnceBeforeCommit) {
          docs.set(refreshOnceBeforeCommit.id, { ...refreshOnceBeforeCommit.data });
          refreshOnceBeforeCommit = null;
        }
        let consistent = true;
        for (const [id, rev] of readRevisions) {
          const current = docs.get(id);
          const currentRev = current ? current.revision ?? null : null;
          if (currentRev !== rev) {
            consistent = false;
            break;
          }
        }
        if (consistent) {
          for (const id of stagedDeletes) docs.delete(id);
          return result;
        }
        // else: optimistic-concurrency retry, like real Firestore
      }
      throw new Error('mock transaction did not converge');
    },
  };
  return db;
}

test('firestore-store deleteDocIfMatches deletes only when admin, token and revision all match', async () => {
  const db = createMockFirestoreDb({
    'doc-1': { token: 'tok', adminUid: ADMIN_UID, updatedAt: 1, revision: 'rev-1' },
  });
  const store = createFirestoreStore(db);

  assert.equal(await store.deleteDocIfMatches('doc-1', { adminUid: ADMIN_UID, token: 'tok', revision: 'rev-x' }), false);
  assert.equal(db.docs.has('doc-1'), true);
  assert.equal(await store.deleteDocIfMatches('doc-1', { adminUid: OTHER_UID, token: 'tok', revision: 'rev-1' }), false);
  assert.equal(await store.deleteDocIfMatches('doc-1', { adminUid: ADMIN_UID, token: 'other', revision: 'rev-1' }), false);
  assert.equal(await store.deleteDocIfMatches('nope', { adminUid: ADMIN_UID, token: 'tok', revision: 'rev-1' }), false);
  assert.equal(await store.deleteDocIfMatches('doc-1', { adminUid: ADMIN_UID, token: 'tok', revision: 'rev-1' }), true);
  assert.equal(db.docs.has('doc-1'), false);
});

test('firestore-store deleteDocIfMatches survives a refresh landing between read and delete inside the transaction', async () => {
  const db = createMockFirestoreDb({
    'doc-race': { token: 'tok', adminUid: ADMIN_UID, updatedAt: 1, revision: 'rev-1' },
  });
  const store = createFirestoreStore(db);
  // Concurrent re-registration lands between the transaction read and commit.
  db.refreshDocOnce('doc-race', { token: 'tok', adminUid: ADMIN_UID, updatedAt: 2, revision: 'rev-2' });

  const deleted = await store.deleteDocIfMatches('doc-race', { adminUid: ADMIN_UID, token: 'tok', revision: 'rev-1' });
  assert.equal(deleted, false);
  assert.deepEqual(db.docs.get('doc-race'), { token: 'tok', adminUid: ADMIN_UID, updatedAt: 2, revision: 'rev-2' });
});

test('notifyTpvNewOrder counts invalidRemoved only for actual atomic deletions, never for refreshed docs', async () => {
  const db = createMockFirestoreDb({
    [fakeHash(`${ADMIN_UID}:seed-0`)]: { token: 'seed-0', adminUid: ADMIN_UID, updatedAt: 1, revision: 'rev-1' },
  });
  const store = createFirestoreStore(db);
  const messaging = {
    async sendEachForMulticast() {
      // Device refreshes its registration while the notification is in flight.
      db.refreshDocOnce(fakeHash(`${ADMIN_UID}:seed-0`), { token: 'seed-0', adminUid: ADMIN_UID, updatedAt: 2, revision: 'rev-2' });
      return { responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] };
    },
  };
  const backend = makeBackend({ store, messaging });
  const summary = await backend.notifyTpvNewOrder(orderEvent('order-race'));
  assert.equal(summary.invalidRemoved, 0);
  assert.equal(db.docs.size, 1);
});

// ---------------------------------------------------------------------------
// S4: Proposed (NOT applied) Firestore rules for the admin paid-order handoff.
// Static preservation of the original rules + executable mirror fixtures of the
// proposed helper. No emulator claim is made here.
// ---------------------------------------------------------------------------

const rulesOriginalPath = fileURLToPath(new URL('../reglas_firestore (2).txt', import.meta.url));
const rulesProposedPath = fileURLToPath(new URL('./firestore.rules.proposed.txt', import.meta.url));

function isSubsequence(needle, haystack) {
  let i = 0;
  for (const line of haystack) {
    if (line === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

test('S4: proposed rules are the EXACT original rules plus only the narrow helper and admin alternative', () => {
  const stripCr = (s) => s.replaceAll('\r\n', '\n');
  const original = stripCr(readFileSync(rulesOriginalPath, 'utf8'));
  const proposed = stripCr(readFileSync(rulesProposedPath, 'utf8'));

  // Baseline preserved verbatim (line subsequence, in order).
  assert.ok(isSubsequence(original.split('\n'), proposed.split('\n')), 'original rules must be preserved verbatim inside the proposal');

  // The proposal must contain the narrow helper and the alternative allow.
  for (const fragment of [
    'function esAdminCobroHandoff()',
    "next.estado == 'en_camino'",
    "prev.get('pagado', false) == false",
    "next.pago in ['efectivo', 'transferencia', 'pos']",
    'next.cobradoEn == request.time',
    "['estado', 'pago', 'pagado', 'cobradoEn', 'recibido', 'vuelto']",
    'allow update: if esAdminCobroHandoff();',
  ]) {
    assert.ok(proposed.includes(fragment), `proposal must include: ${fragment}`);
  }

  // It must NOT open any broader access.
  assert.equal(proposed.includes('allow read, write: if true'), false);
  const altUpdates = proposed.match(/allow update: if esAdminCobroHandoff\(\);/g) ?? [];
  assert.equal(altUpdates.length, 1);
  // Original admin transition rule still present unchanged.
  assert.ok(proposed.includes("allow update: if esAdmin()\n                    && (request.resource.data.estado == resource.data.estado"));

  // Promotion and web modality add only bounded helpers/fields/validation.
  // All unrelated permissions retain their original baseline bytes.
  const withoutPromotion = original
    .replace(/    \/\/ Optional web-promotion snapshot;[\s\S]*?(?=    match \/pedidos\/)/, '')
    .replace(", 'descuento', 'porcentajeDescuento'", '')
    .replace(", 'tipo'", '')
    .replace('                    && descuentoWebValido()\n', '')
    .replace('                    && tipoWebValido()\n', '')
    .trimEnd();
  assert.equal(createHash('sha256').update(withoutPromotion).digest('hex').toUpperCase(),
    '0C0C66ED555EE359463C0C77781DC17A58EB487EDE80B8C6A1CFE273FC26AB59');
});

// Executable mirror of the proposed helper, used ONLY as a fixture harness.
// It is a requirements mirror, not a Firestore rules engine — the emulator is
// the only place the real rule semantics execute.
function esAdminCobroHandoffMirror({ isAdmin, prev, next, keysChanged, now }) {
  const changed = new Set(keysChanged);
  const allowed = new Set(['estado', 'pago', 'pagado', 'cobradoEn', 'recibido', 'vuelto']);
  if (!isAdmin) return false;
  if (!['nuevo', 'preparacion', 'en_camino', 'entregado'].includes(prev.estado)) return false;
  if (next.estado !== 'en_camino') return false;
  if ((prev.pagado ?? false) !== false) return false;
  if (next.pagado !== true) return false;
  if (!['efectivo', 'transferencia', 'pos'].includes(next.pago)) return false;
  if (next.cobradoEn !== now) return false;
  for (const key of changed) if (!allowed.has(key)) return false;
  if (next.pago === 'efectivo') {
    if (typeof next.recibido !== 'number' || typeof next.total !== 'number') return false;
    if (next.recibido < next.total) return false;
    if (typeof next.vuelto !== 'number' || next.vuelto !== next.recibido - next.total) return false;
  } else {
    if (next.recibido !== null || next.vuelto !== null) return false;
  }
  return true;
}

const handoffPrev = { estado: 'preparacion', total: 50000 };
const nowMarker = 'SERVER_TIMESTAMP';
const handoffNextValidCash = {
  estado: 'en_camino', total: 50000, pagado: true, pago: 'efectivo',
  recibido: 100000, vuelto: 50000, cobradoEn: nowMarker,
};

test('S4 fixtures: valid admin payment handoff is allowed (cash, transferencia, POS, unpaid en_camino, entregado)', () => {
  const changedAll = ['estado', 'pago', 'pagado', 'cobradoEn', 'recibido', 'vuelto'];
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: handoffNextValidCash, keysChanged: changedAll, now: nowMarker }), true);
  const transferNext = { ...handoffNextValidCash, pago: 'transferencia', recibido: null, vuelto: null };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: transferNext, keysChanged: changedAll, now: nowMarker }), true);
  const posNext = { ...handoffNextValidCash, pago: 'pos', recibido: null, vuelto: null };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: posNext, keysChanged: changedAll, now: nowMarker }), true);
  const unpaidEnCamino = { ...handoffPrev, estado: 'en_camino' };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: unpaidEnCamino, next: handoffNextValidCash, keysChanged: changedAll, now: nowMarker }), true);
  const entregadoUnpaid = { ...handoffPrev, estado: 'entregado' };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: entregadoUnpaid, next: handoffNextValidCash, keysChanged: changedAll, now: nowMarker }), true);
});

test('S4 fixtures: non-admin, payment metadata mismatch, unrelated keys and paid duplicates are rejected', () => {
  const changedAll = ['estado', 'pago', 'pagado', 'cobradoEn', 'recibido', 'vuelto'];
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: false, prev: handoffPrev, next: handoffNextValidCash, keysChanged: changedAll, now: nowMarker }), false);
  const paidPrev = { ...handoffPrev, pagado: true };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: paidPrev, next: handoffNextValidCash, keysChanged: changedAll, now: nowMarker }), false);
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: handoffNextValidCash, keysChanged: [...changedAll, 'total'], now: nowMarker }), false);
  const tarjeta = { ...handoffNextValidCash, pago: 'tarjeta', recibido: null, vuelto: null };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: tarjeta, keysChanged: changedAll, now: nowMarker }), false);
  const under = { ...handoffNextValidCash, recibido: 40000, vuelto: -10000 };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: under, keysChanged: changedAll, now: nowMarker }), false);
  const vueltoBad = { ...handoffNextValidCash, vuelto: 49999 };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: vueltoBad, keysChanged: changedAll, now: nowMarker }), false);
  const transferExtra = { ...handoffNextValidCash, pago: 'transferencia', recibido: 50000, vuelto: null };
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: transferExtra, keysChanged: changedAll, now: nowMarker }), false);
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: { ...handoffNextValidCash, cobradoEn: 'NOT_NOW' }, keysChanged: changedAll, now: nowMarker }), false);
  for (const estado of ['cancelado', 'archivado']) {
    assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: { ...handoffPrev, estado }, next: handoffNextValidCash, keysChanged: changedAll, now: nowMarker }), false);
  }
  assert.equal(esAdminCobroHandoffMirror({ isAdmin: true, prev: handoffPrev, next: { ...handoffNextValidCash, estado: 'entregado' }, keysChanged: changedAll, now: nowMarker }), false);
});
