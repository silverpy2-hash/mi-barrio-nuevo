# Customer pickup or delivery

The customer chooses **Retiro en el local** or **Delivery** below name and phone. Neither is selected initially; the order cannot be confirmed without a choice. The rest of the existing design and administrator/manual-order flow is unchanged.

## Pickup

Requires name and phone only. No address or map is displayed. Shipping is zero, and the saved order contains tipo retiro without stale GPS, distance or address. Existing TPV cards and printed tickets already recognize this type.

## Delivery

Selecting Delivery displays the address and map and requests browser geolocation. **Actualizar mi ubicación** retries the request. If permission/GPS fails, choose the location manually on the map. Confirmation waits for the current shipping calculation; late GPS/route results cannot overwrite a newer location or a pickup choice. Browser location requires permission and normally HTTPS.

## Charging the delivery fee

The administrator can turn the fee on or off in **Configuración → 🛵 Delivery**. The setting is stored as `config/local.delivery.cobrar`; when it is missing, delivery is charged (backward compatible). With **Sin cobro**, the customer page and manual panel orders charge zero, while the configured distance tiers still act as the coverage limit: addresses beyond the last tier remain rejected. Turning it back to **Cobrando** restores the configured tier prices immediately.

## Discounts and saved orders

Each modality uses its own configured promotion exactly once: pizza price plus stuffed border only. Extras and the delivery fee remain full price. With 20% for delivery and 10% for pickup, pizza/border 75,000 Gs + extras 23,000 Gs gives pickup 90,500 Gs; adding 5,000 Gs delivery gives 88,000 Gs.

The order stores its type, amount and percentage before WhatsApp/email are opened. If saving fails, no message is sent and the modality is never discarded to bypass permissions. Previously stored orders, manual orders and QR-table choices retain their existing workflows.

## Deployment and checks

Updated reglas_firestore (2).txt must be applied separately before the new typed web orders are used. Its narrow public rule permits only delivery/retiro, with zero shipping for pickup; local/waiter permissions and administrator payment rules are unchanged. The same additions are mirrored in the existing proposed rules file. No rules were deployed and no Git publication is implied.

Regression commands use Node's built-in runner: node --test tests/entrega-web.test.mjs tests/descuento-web.test.mjs. They use isolated mocks, never real customer orders, GPS or messages. A real browser/phone and the Firestore rules engine require separate proof; do not infer those from mocks.
