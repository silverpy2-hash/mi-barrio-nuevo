// Production wiring for the TPV push backend.
// SDK adapters live here; all testable logic lives in src/core.js.
// This module is NOT deployed yet: deployment requires explicit user
// authorization, a Blaze plan, and the steps in README.md.
import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

import { createTpvPushBackend, TpvPushError, TPV_DEVICES_COLLECTION } from './core.js';
import { createFirestoreStore } from './firestore-store.js';

// Same Firebase project as the existing Mi Barrio app — never a separate one.
initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 2 });

// Server-only configuration. TPV_ADMIN_UID is the exact Firebase Auth UID of
// the TPV administrator (the same identity the Firestore rules treat as admin).
// No value is embedded in this repository; provide it via a local .env file or
// deploy-time prompt. The backend fails closed when it is missing.
const tpvAdminUid = defineString('TPV_ADMIN_UID');

const messaging = getMessaging();

const store = createFirestoreStore(getFirestore(), TPV_DEVICES_COLLECTION);

const messagingAdapter = {
  sendEachForMulticast: (message) => messaging.sendEachForMulticast(message),
};

const hashToken = (input) => createHash('sha256').update(String(input)).digest('hex');

// Resolve the admin UID at cold start. defineString is only resolvable inside
// Cloud Functions; when it is unavailable (for example, local tooling that
// imports this module) the backend fails closed instead of crashing.
function resolveAdminUid() {
  try {
    return tpvAdminUid.value();
  } catch {
    return '';
  }
}

const backend = createTpvPushBackend({
  store,
  messaging: messagingAdapter,
  logger,
  configuredAdminUid: resolveAdminUid(),
  hashToken,
});

function toHttpsError(error) {
  if (error instanceof TpvPushError) {
    return new HttpsError(error.code, error.message);
  }
  logger.error('tpv push backend internal error', { name: error?.name });
  return new HttpsError('internal', 'Unexpected error in the TPV push backend.');
}

export const registerTpvDevice = onCall({ region: 'us-central1' }, async (request) => {
  try {
    return await backend.registerTpvDevice(request);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const unregisterTpvDevice = onCall({ region: 'us-central1' }, async (request) => {
  try {
    return await backend.unregisterTpvDevice(request);
  } catch (error) {
    throw toHttpsError(error);
  }
});

// New-order fanout. Delivery is best effort: the stable tag
// `tpv-new-order-<orderId>` bounds duplicate notifications on retry, but no
// exactly-once guarantee is claimed. Permanently invalid tokens are removed;
// transient failures are reported in logs and keep the registration.
export const notifyTpvNewOrder = onDocumentCreated(
  { document: 'pedidos/{id}', region: 'us-central1' },
  async (event) => {
    try {
      return await backend.notifyTpvNewOrder(event);
    } catch (error) {
      if (error instanceof TpvPushError) {
        // Client/config errors are not retryable: log and stop.
        logger.error('tpv new order trigger rejected', { code: error.code });
        return { aborted: true, code: error.code };
      }
      // Unknown/messaging errors propagate so an explicitly configured retry
      // policy can re-attempt the event; nothing is deleted on this path.
      throw error;
    }
  },
);
