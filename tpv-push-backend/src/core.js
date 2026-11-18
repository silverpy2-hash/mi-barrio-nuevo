// Pure, dependency-injected core for the TPV push backend.
// This module never imports the Firebase SDK, so it is fully testable offline.
// Production wiring (SDK adapters) lives in src/index.js.

import { randomBytes } from 'node:crypto';

export class TpvPushError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TpvPushError';
    this.code = code;
  }
}

export const TPV_DEVICES_COLLECTION = 'tpvPushDevices';
export const MAX_TOKEN_LENGTH = 4096;
export const DEFAULT_BATCH_SIZE = 400; // FCM multicast hard limit is 500 tokens per call.
export const PERMANENT_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function requireConfiguredAdminUid(configuredAdminUid) {
  if (typeof configuredAdminUid !== 'string' || configuredAdminUid.trim() === '') {
    // Fail closed: with no admin UID configured there is no legitimate caller.
    throw new TpvPushError('failed-precondition', 'TPV admin is not configured on the server.');
  }
  return configuredAdminUid.trim();
}

function requireAdminCaller(request, configuredAdminUid) {
  const adminUid = requireConfiguredAdminUid(configuredAdminUid);
  const auth = request?.auth ?? null;
  if (!auth || typeof auth.uid !== 'string' || auth.uid.trim() === '') {
    throw new TpvPushError('unauthenticated', 'The function must be called while authenticated.');
  }
  if (auth.uid !== adminUid) {
    throw new TpvPushError('permission-denied', 'Only the configured TPV administrator may manage TPV devices.');
  }
  return adminUid;
}

function normalizeToken(token) {
  if (typeof token !== 'string') {
    throw new TpvPushError('invalid-argument', 'The function must be called with a "token" string.');
  }
  const trimmed = token.trim();
  if (trimmed === '' || trimmed.length > MAX_TOKEN_LENGTH) {
    throw new TpvPushError('invalid-argument', 'The provided FCM registration token is empty or too long.');
  }
  return trimmed;
}

function deviceDocId(hashToken, adminUid, token) {
  // Deterministic, safe document id: salted per admin, never the raw token.
  return hashToken(`${adminUid}:${token}`);
}

export function createTpvPushBackend({
  store,
  messaging,
  logger,
  configuredAdminUid,
  hashToken,
  now = () => Date.now(),
  randomId = () => randomBytes(16).toString('hex'),
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  if (!store || !messaging || !logger || typeof hashToken !== 'function') {
    throw new TypeError('createTpvPushBackend requires store, messaging, logger and hashToken adapters.');
  }
  const effectiveBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? Math.min(batchSize, 500) : DEFAULT_BATCH_SIZE;

  async function registerTpvDevice(request) {
    const adminUid = requireAdminCaller(request, configuredAdminUid);
    const token = normalizeToken(request?.data?.token);
    const id = deviceDocId(hashToken, adminUid, token);
    await store.setDoc(id, {
      token,
      adminUid,
      updatedAt: now(),
      // Random nonce per registration: re-registering never bumps this into an
      // earlier value, so atomic compare-and-delete can spot stale snapshots
      // even when two writes land in the same millisecond.
      revision: randomId(),
    });
    logger.info('tpv device registered', { adminUid });
    // Never echo the raw token back to the caller or into logs.
    return { registered: true };
  }

  async function unregisterTpvDevice(request) {
    const adminUid = requireAdminCaller(request, configuredAdminUid);
    const token = normalizeToken(request?.data?.token);
    const id = deviceDocId(hashToken, adminUid, token);
    // deleteDoc is idempotent: revoking an unknown or already-revoked token succeeds.
    await store.deleteDoc(id);
    logger.info('tpv device unregistered', { adminUid });
    return { revoked: true };
  }

  async function cleanupInvalidToken(snapshot, errorCode) {
    if (!PERMANENT_TOKEN_ERROR_CODES.has(errorCode)) {
      return false;
    }
    // Atomic compare-and-delete inside a transaction (see I/O adapter): the
    // document is removed only if the admin, token AND revision still match
    // the snapshot that was sent. A freshly refreshed/replaced registration
    // has a different revision and is never deleted.
    return store.deleteDocIfMatches(snapshot.id, {
      adminUid: snapshot.adminUid,
      token: snapshot.token,
      revision: snapshot.revision,
    });
  }

  async function notifyTpvNewOrder(event) {
    const adminUid = requireConfiguredAdminUid(configuredAdminUid);
    const orderId = event?.params?.id;
    if (typeof orderId !== 'string' || orderId.trim() === '') {
      throw new TpvPushError('invalid-argument', 'Order id is missing from the trigger event.');
    }
    const trimmedOrderId = orderId.trim();

    const devices = (await store.listDevices(adminUid))
      .filter((device) => typeof device?.token === 'string' && device.token !== '');

    if (devices.length === 0) {
      logger.info('tpv new order: no registered admin devices', { orderId: trimmedOrderId });
      return { attempted: 0, succeeded: 0, failed: 0, invalidRemoved: 0 };
    }

    const tag = `tpv-new-order-${trimmedOrderId}`;
    // Generic payload only: no customer, total, items or payment details.
    // `tpv-new-order-<orderId>` is the canonical tag on every platform and is
    // what the frontend/service worker receiver parses. `icon` is an own-scope
    // relative path — never an external or project-specific URL. `fcmOptions.link`
    // is deliberately absent: no configured, validated HTTPS destination exists.
    const webpushData = {
      type: 'tpv-new-order',
      orderId: trimmedOrderId,
      tag,
    };
    const message = {
      notification: {
        title: 'Mi Barrio TPV',
        body: 'Nuevo pedido pendiente en el TPV.',
      },
      data: { ...webpushData },
      android: {
        notification: { tag },
      },
      webpush: {
        notification: {
          title: 'Mi Barrio TPV',
          body: 'Nuevo pedido pendiente en el TPV.',
          tag,
          icon: './icon-192.png',
        },
        data: { ...webpushData },
      },
    };

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let invalidRemoved = 0;

    for (let offset = 0; offset < devices.length; offset += effectiveBatchSize) {
      const batch = devices.slice(offset, offset + effectiveBatchSize);
      attempted += batch.length;
      // Adapter-level exceptions propagate: with an explicit retry policy on the
      // trigger this event is retried; invalid tokens already cleaned up stay clean.
      const result = await messaging.sendEachForMulticast({ ...message, tokens: batch.map((d) => d.token) });
      const responses = Array.isArray(result?.responses) ? result.responses : [];
      for (let i = 0; i < batch.length; i += 1) {
        const response = responses[i];
        if (response?.success) {
          succeeded += 1;
          continue;
        }
        failed += 1;
        const errorCode = response?.error?.code;
        if (typeof errorCode === 'string' && (await cleanupInvalidToken(batch[i], errorCode))) {
          invalidRemoved += 1;
        }
      }
    }

    // Counts only — never raw tokens — so logs are safe to keep.
    logger.info('tpv new order notification fanout', {
      orderId: trimmedOrderId,
      attempted,
      succeeded,
      failed,
      invalidRemoved,
    });
    return { attempted, succeeded, failed, invalidRemoved };
  }

  return { registerTpvDevice, unregisterTpvDevice, notifyTpvNewOrder };
}
