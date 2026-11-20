# Web pizza discount

Both administrator TPVs expose **Config → Descuento web**. Choose 10%, 15%, 20%, 25%, or **Desactivar**. One shared setting in `config/local.descuentoWeb` updates the customer page without changing manual orders.

## Amounts and receipts

- Every web pizza size and variety is eligible, including its stuffed border. Extras and delivery remain full price.
- Round the percentage discount once to whole guaraníes across the ordered pizzas. Example: pizzas/borders 100,000 Gs + extras 15,000 Gs + delivery 7,000 Gs at 20% means a 20,000 Gs discount and **102,000 Gs total**.
- Store `descuento` and `porcentajeDescuento` on the order. The original item amounts, final total, WhatsApp message, email copy and both ticket renderers use that same snapshot. Later activation/deactivation never changes existing orders.
- A discounted order waits for the database write before opening its WhatsApp message. If saving fails, the reserved window closes and the customer sees an error; promotion fields are never discarded by the legacy permission fallback.
- The automatic confirmation is the existing customer-generated WhatsApp draft and email copy, not a new bot or automatic send.

## Before operational use

The updated `reglas_firestore (2).txt` must be reviewed and published to the existing Firebase project together with the changed pages. Publishing/deployment was **not performed**. With old rules, discounted order writes are rejected safely rather than silently saved without the discount.

The same promotion validation is mirrored in `tpv-push-backend/firestore.rules.proposed.txt` so that applying the separate administrator payment proposal later cannot remove discount support. This feature does not deploy or alter that proposal's administrator payment permissions.

The existing application trusts client-provided prices. This feature validates the new fields' types and bounds but does not introduce a server-side pricing engine or claim tamper-proof totals. No production records or real customer messages are needed for local tests.

## Checks

Run `node --test tests/descuento-web.test.mjs` for the isolated calculations, configuration writes, stored order, failure handling and receipt checks. Real Firestore rules-engine/emulator and phone/printing proof remain separate from those mocked checks.
