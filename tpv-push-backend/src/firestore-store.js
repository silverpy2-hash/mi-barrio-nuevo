// Firestore SDK adapter for the TPV push store.
// The db instance is injected so the exact production logic runs against any
// Firestore-compatible object — including a mocked transaction boundary in tests.
// This module imports nothing from firebase-admin; see src/index.js for wiring.

export function createFirestoreStore(db, collectionName = 'tpvPushDevices') {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new TypeError('createFirestoreStore requires a Firestore-compatible db with collection() and runTransaction().');
  }

  const col = () => db.collection(collectionName);

  return {
    async getDoc(id) {
      const snap = await col().doc(id).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },

    async setDoc(id, data) {
      await col().doc(id).set(data);
    },

    async deleteDoc(id) {
      await col().doc(id).delete();
    },

    async listDevices(adminUid) {
      const snap = await col().where('adminUid', '==', adminUid).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    // Atomic compare-and-delete: the document is deleted inside a transaction
    // only if its adminUid, token and revision still match the snapshot that
    // was sent to FCM. If the device re-registered (new revision) before or
    // during this call, nothing is deleted. Returns true only when this call
    // actually removed the document.
    async deleteDocIfMatches(id, expected) {
      if (!expected || typeof expected.token !== 'string' || typeof expected.adminUid !== 'string' || typeof expected.revision !== 'string') {
        return false;
      }
      const docRef = col().doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) {
          return false;
        }
        const data = snap.data() ?? {};
        if (data.adminUid !== expected.adminUid || data.token !== expected.token || data.revision !== expected.revision) {
          return false;
        }
        tx.delete(docRef);
        return true;
      });
    },
  };
}
