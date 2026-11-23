# Reliable customer confirmation and WhatsApp handoff
Objective: keep TPV-first order storage and manual WhatsApp sending, while preventing accidental duplicate confirmation and providing safe recovery. Baseline: aebd71ae16c2f19aa887df57ab61b4447d502a70; parent implements inline; no commit/push or deployment authorized.
One coherent confirmation-flow delivery (roughly 500 authored lines including shared test fixtures/docs). Runner: Node built-in isolated tests; independent high-risk verification after own checks. No prices, discounts, delivery/pickup rules or panel changes.

## Specs
### S1 — Preserve TPV first, WhatsApp manual
User: "si ese siempre leugo enl cliente tiene que enviar manualmente ese sin poblemas"; "eso de guardar en el tpv creo que eso es la mejor forma primero el tpv y despues el whasap".
Save successfully before offering the WhatsApp message. After storage show a clear receipt/reference and a real user-click WhatsApp link, not a delayed blank-popup redirect. Do not claim a URL opening means the message was sent or delivered. Keep the complete original order detail, totals, payment and modality.
### S2 — Prevent accidental duplicates and recover the same attempt
User: "solo vamos a ver uan foram de evitar que no halla fallos al gennerar ese mesnajes con los pedidos". Prior incident: "un cleine envio dos veces su pedido y elelgo al tpv pero no me lelgo ami su mensaje de confirmacon".
Repeated confirmation/opening the same message must not create another order. Keep a stable attempt document ID and original snapshot across retries in the same tab, with best-effort sessionStorage recovery. Only explicit confirmation of a new order clears a successfully stored attempt. Never create a fresh document automatically on an uncertain failure. Storage failures do not pretend TPV success or offer WhatsApp prematurely.
### S3 — Clear feedback and bounded scope
User: "pulir esa parte osea vos sabras que hacer y como dejar"; "cooreguir".
Show saving/saved/error state, reference, safe retry and reopen controls plus copyable message. Handle failures without leaving the in-flight flag stuck. Keep copies/receipts in the current tab only, no credentials. Existing discounts/prices/manual orders/Retiro/Delivery/QR behavior remain; only confirmation/handoff UX changes. No new Firestore fields, rules changes, automated WhatsApp service or server credentials.

## Tasks
- T1 | S1-S3 | inline main implementation; focused tests inline; independent high-risk verifier (items1,3,4) | pending RED; no commit authorization.

## Log
- L1 — Investigation request: "tenesmo aun nuestra ventanna de chat gtp una hora mas para usar verificame conmo esa trabajando index exclusivamente la confirmacion y el envio op wuasap busca alfun fallo o alguna medda que podrais imnplementnar para mejorar porque un cleine envio dos veces su pedido y elelgo al tpv pero no me lelgo ami su mensaje de confirmacon y tambine me comento que tuvo poblemas nose en el que y tambien otro cliente me lelgo su pedido en el tpv y no me lelgo su mensaje dos ya no son casualidad porque no pasaba esto".
- L2 — Read-only audit reproduced two sequential confirmations creating distinct IDs with identical payloads. Simulated post-save navigation exception escaped the save catch and left the guard true; exact real-phone cause remains unproven. Recent pickup change expanded waiting-before-navigation to all normal web orders, versus discounted orders only before it.
- L3 — User implementation authorization: "si ese siempre leugo enl cliente tiene que enviar manualmente ese sin poblemas solo vamos a ver uan foram de evitar que no halla fallos al gennerar ese mesnajes con los pedidos y eso de guardar en el tpv creo que eso es la mejor forma primero el tpv y despues el whasap y pulir esa parte osea vos sabras que hacer y como dejar"; reinforced "cooreguir".
- L4 — Plan: same-tab attempt receipt and stable custom Firestore document ID; retry via setDoc at the same ID (no auto-overwrite/new fallback); native click-to-chat link after acknowledgement, safe receipt retry/reopen/new-order actions. Existing public rules create-only behavior may reject an ambiguous retry of an already-created ID: preserve reference and ask customer to contact the store rather than create a duplicate. Session storage is best effort and not cross-device deduplication. No real orders/messages, tests use fake data only. Pre-existing .atl/, opencode.json and odd/tasks/android-tools.md remain untouched.
