# Mi Barrio — TPV Push Backend (prepared, not deployed)

**Status: prepared source only. Nothing in this directory is deployed, published, billed, credentialed or active.** No deployment has happened and no live Firebase project has been touched. Real-phone and closed-app notification behavior is **unverified** until the emulator and device checklists below are executed under explicit authorization.

This backend is the trusted sender for the "new order" push that the mobile TPV (`mi-barrio-tpv-celular/`) will use once push is explicitly enabled. It runs in the **same Firebase project as the existing Mi Barrio app**, not a new one.

## What it provides

| Export | Kind | Purpose |
|---|---|---|
| `registerTpvDevice({ token })` | Callable, v2, `us-central1` | Registers the caller's FCM token as a TPV admin device |
| `unregisterTpvDevice({ token })` | Callable, v2, `us-central1` | Revokes the caller's FCM token (logout-safe, idempotent) |
| `notifyTpvNewOrder` | Firestore trigger `onDocumentCreated('pedidos/{id}')`, v2, `us-central1` | Fans out a generic notification to registered TPV admin devices |

Interface contract (integration contract L6): callable names, region `us-central1`, same project, server-side exact `TPV_ADMIN_UID` authorization, server-only `tpvPushDevices` collection, no Firestore rules changes (existing rules already deny all undefined collections), generic no-PII payload, stable per-order tag.

## Security model

- **Exact admin match, fail closed.** Every callable requires a verified Firebase Auth UID that **exactly equals** the server-configured `TPV_ADMIN_UID`. If `TPV_ADMIN_UID` is missing or empty, every request fails with `failed-precondition` and nothing is read or written.
- **Per-admin binding.** Registration documents store `adminUid` + `token` + `updatedAt`. Tokens are only ever sent to devices registered by the configured admin. Other users — even authenticated ones — get `permission-denied` and zero side effects.
- **Deterministic safe document IDs.** The document ID is `sha256(<adminUid>:<token>)` — deterministic, salted per admin, never reversible to the raw token, never the token itself. Re-registering the same token overwrites the same document (idempotent).
- **Server-only storage.** `tpvPushDevices` is written only by these functions via the Admin SDK. The existing Firestore rules deny all access (catch-all `allow read, write: if false`), so no rules change is required or authorized.
- **No PII, no open topics.** The notification payload contains only `type`, `orderId` and a `tag` (`tpv-new-order-<orderId>`) plus a generic title/body. Customer, item, total, payment and address data never leave Firestore in this path. No FCM topics are used, so there is no broadcast channel.
- **No exactly-once claim.** The stable tag `tpv-new-order-<orderId>` is identical on `android`, `data` and `webpush` so a redelivered event replaces rather than stacks the notification. Delivery itself remains best-effort.
- **No token leakage.** Logs record counts and the order id only — never raw tokens.
- **No secrets in this repo.** No service-account keys, no real admin UID, no `.firebaserc`, no `.env`. See `.env.example` for the placeholder shape.

## Fanout, duplicates and failure honesty

- Fanout runs in batches of at most **400** tokens per `sendEachForMulticast` call (FCM multicast hard limit is 500).
- The tag `tpv-new-order-<orderId>` bounds **visual** duplication on Android/Web when an event is redelivered. **No exactly-once delivery guarantee is claimed**: FCM is best-effort, and trigger retries (if ever enabled) can re-send.
- **Atomic compare-and-delete.** Every registration stores a random per-write `revision` (not just `updatedAt`, so same-millisecond writes cannot alias). Permanent token errors (`messaging/registration-token-not-registered`, `messaging/invalid-registration-token`) remove the document **only** through `deleteDocIfMatches`, a Firestore transaction that re-checks `adminUid`, `token` and `revision` before deleting. A freshly refreshed/replaced registration is never deleted, and `invalidRemoved` counts only actual deletions.
- **Transient** errors are counted and logged; registrations are kept. Adapter-level exceptions propagate from the trigger (no deletion happens on that path); whether to enable automatic retry for the trigger is an explicit operator decision, not a default here.
- Log lines report `{ orderId, attempted, succeeded, failed, invalidRemoved }`.

## Web payload contract (B2)

`notifyTpvNewOrder` builds one message with consistent, generic fields on every platform:

| Field | Value |
|---|---|
| `data` / `webpush.data` | string map `{ type: 'tpv-new-order', orderId, tag: 'tpv-new-order-<orderId>' }` |
| `notification` / `webpush.notification` | generic `title`/`body`, `tag`, and own-scope relative `icon: './icon-192.png'` |
| `android.notification.tag` | `tpv-new-order-<orderId>` |
| `fcmOptions` | **absent** — no configured or validated HTTPS destination exists, so no `link` is invented or hardcoded |

The receiver must treat the payload as **nested** (`notification` + `data`). The frontend service worker is being aligned by its own unit; this backend does not assume automatic display and does not ship the FCM SDK path. No test in this repository talks to a real browser — the nested-contract test verifies structure only. Icon and tag carry no project URL and no customer data.

## Cost reality — read before authorizing deploy

- **FCM send itself is not billed** by Google.
- **Cloud Functions (2nd gen), Firestore, Eventarc, Cloud Build, Cloud Storage and Artifact Registry are billed services.** Deploying these functions requires the project to be on the **Blaze (pay-as-you-go) plan**. A free-tier allowance exists for some of these services, but Google does not guarantee any deployment is free forever, and 2nd gen functions provision Cloud Run infrastructure with minimum-instance behavior if configured.
- Enabling Blaze, creating budgets/alerts, or accepting billing are **separate explicit authorizations** — none of them are done or implied by this directory.
- Local testing on the emulator, and running `node --test`, cost nothing.

## Local verification (no Firebase required, already run)

```bash
node --test tpv-push-backend/test.mjs
node --check tpv-push-backend/src/core.js
node --check tpv-push-backend/src/firestore-store.js
node --check tpv-push-backend/src/index.js
```

The test suite injects in-memory adapters through the same handler factories the deployed module uses. The Firebase SDK, network and credentials are not needed for these tests, and no test-only production path exists. **What is NOT proven by these tests**: anything about the real Firebase runtime, FCM delivery, or closed-app notifications on a phone.

## S4: Proposed Firestore rules — NOT applied, NOT verified live

`firestore.rules.proposed.txt` is a **proposal only**. It is a byte-exact copy of the current `reglas_firestore (2).txt` (hash `026A9034…`, matching the feature doc's baseline) plus exactly two additions:

1. A narrow helper `esAdminCobroHandoff()`: exact admin identity; previously unpaid order (`pagado` missing counts as unpaid); target state `en_camino` only; source `nuevo|preparacion|en_camino|entregado` (canceled/archived rejected); `pago` in `efectivo|transferencia|pos`; `cobradoEn == request.time`; changed keys limited to `estado|pago|pagado|cobradoEn|recibido|vuelto`; cash requires `recibido >= total` and `vuelto == recibido - total`; non-cash requires `recibido == null && vuelto == null`.
2. One additional `allow update: if esAdminCobroHandoff();` inside `match /pedidos/{id}`.

The original admin `allow update` still requires `estadoPermitido` — it is **not** bypassed or modified, and no other role or path gains anything. `tipo`/`origen` are untouched for every order type.

**Status and requirements before use:**

- Nothing is deployed, published or applied. `reglas_firestore (2).txt` was and remains untouched (its baseline hash is asserted in the test suite).
- `firebase.json` does **not** reference the proposal, so `firebase deploy` cannot pick it up.
- Applying it requires explicit owner authorization, manual review, and Firestore emulator verification of the rule semantics. The test suite only statically checks structure/preservation and evaluates a JS **mirror** of the helper as fixtures — **the emulator has NOT been run**, and no claim about live rules behavior is made.
- The mobile cobro flow (atomic payment write to `en_camino` for every order type) **depends on this proposal being applied**. Until then, the full paid-order handoff does not work end to end. This is a known, documented gap — not a silent failure mode.
- The atomic handoff update must write exactly the allowed keys; note the frontend currently also writes `estadoActualizado`, which this proposal does **not** allow, so the frontend unit must drop it or the write will be rejected.
- Regenerate the proposal deterministically with `node tpv-push-backend/tools/build-rules-proposal.mjs` (never hand-edit; never overwrite the original).

## Deployment — ONLY when explicitly authorized

Prerequisites checklist (all must be explicitly approved by the owner):

- [ ] Blaze plan enabled on the existing Mi Barrio Firebase project (billing decision, owner-only)
- [ ] Firebase CLI installed and authenticated against the existing project
- [ ] `TPV_ADMIN_UID` supplied via local `.env` inside `tpv-push-backend/` (never committed, never in web assets)
- [ ] Dependencies installed **inside this directory only**: `npm install` in `tpv-push-backend/` (creates `package-lock.json`; not done yet)
- [ ] Firestore rules confirmed unchanged (they already deny `tpvPushDevices` to clients)

Authorized commands (placeholders — replace `YOUR_PROJECT_ID`; never run from the repository root, never rely on a default project):

```bash
cd tpv-push-backend
npm install                                  # only with explicit authorization
firebase deploy --only functions --project YOUR_PROJECT_ID
```

There is deliberately **no `.firebaserc`** in this repository and no broad default project selection. If `firebase` ever asks which project to use, abort and pass `--project YOUR_PROJECT_ID` explicitly.

## Emulator and real-device proof — PENDING

Neither has been run. When authorized, the proof sequence is:

1. `firebase emulators:exec --only functions,firestore --project YOUR_PROJECT_ID 'npm test'` plus a manual emulator session calling `registerTpvDevice` / `unregisterTpvDevice` with a test admin user.
2. Deploy to the project (authorized step above).
3. Register a real phone via the TPV web app (push config disabled by default until then), create a test order, confirm the notification arrives **with the app closed**.
4. Revoke from the phone (logout), create another order, confirm **no** notification arrives.
5. Confirm Firestore `tpvPushDevices` contains only hashed IDs and no client-readable path (rules deny it).

Until steps 1–5 are done, any claim that closed-app notifications work is false.

## Authorization checklist before anything goes live

- [ ] Owner authorized: Blaze plan / billing on the existing project
- [ ] Owner authorized: `firebase deploy` of this codebase with `--project` explicit
- [ ] `TPV_ADMIN_UID` verified against the real admin account (not guessed)
- [ ] TPV frontend push configuration enabled (separately owned by the frontend unit)
- [ ] Emulator proof passes; real-phone proof passes
- [ ] Rollback plan agreed: `firebase functions:delete registerTpvDevice unregisterTpvDevice notifyTpvNewOrder --project YOUR_PROJECT_ID`

## Dependencies

Declared in `package.json`, **not installed** in this repository, no lockfile generated:

| Package | Version | Notes |
|---|---|---|
| `firebase-functions` | `^7.4.0` | v2 API; Node >= 18 |
| `firebase-admin` | `^14.5.1` | Requires Node >= 22; `engines` pins Node 22 |

Runtime: Node.js 22 (Cloud Functions supported runtimes). Local tooling used for tests: Node.js v26.13.0 built-in test runner.

## Files

| Path | Role |
|---|---|
| `src/core.js` | Pure dependency-injected core (validation, hashing, fanout, atomic-cleanup coordination) |
| `src/firestore-store.js` | Firestore adapter (`createFirestoreStore(db, collection)`), with transactional `deleteDocIfMatches` |
| `src/index.js` | Firebase SDK wiring and v2 function definitions |
| `test.mjs` | `node --test` suite, no network/SDK required (SDK boundary mocked with real transaction semantics) |
| `tools/build-rules-proposal.mjs` | Deterministic generator for the S4 proposal from the untouched original |
| `firestore.rules.proposed.txt` | PROPOSAL ONLY — never referenced by `firebase.json`, never applied |
| `firebase.json` | Isolated functions config for this codebase only |
| `package.json` | Manifest; dependencies declared, not installed |
| `.env.example` | Placeholder shape for `TPV_ADMIN_UID` |
| `.gitignore` | `node_modules/`, `.env*`, logs |
