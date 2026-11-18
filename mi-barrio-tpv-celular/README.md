# Mi Barrio - TPV Celular

Administración completa de Mi Barrio desde el celular, como PWA instalable, **exclusiva del administrador** y sin tocar `panel_nuevo.html`. Push preparado pero **desactivado por defecto**. Sin APK todavía: la APK vendrá como contenedor de esta misma web.

## Quick path

1. Serví esta carpeta por HTTPS (o `localhost` en tu PC): `python -m http.server` dentro de `mi-barrio-tpv-celular/`.
2. Entrá con el correo del **administrador** (el uid `e8czOfuF82VqPwNUZjMpOSMHUQo2`, igual que las reglas de Firestore).
3. En el celular (Android/iPhone), instalala desde el navegador: menú → *Agregar a pantalla de inicio*.

## Qué incluye (paridad con el panel completo)

Pedidos en vivo, alta manual y venta rápida, cocina, cobro con vuelto, cierres de caja y reportes, menú/agotados/local, clientes, gastos, respaldo, configuración, temas (Clásico/Simple/Moderno/Avanzado) y confirmaciones destructivas. Se reutilizó el panel completo adaptado a móvil; no hay iframe ni framework.

**Diferencias explícitas con el panel:**

| Tema | TPV Celular |
|------|-------------|
| Acceso | Solo admin (uid de las reglas). Cualquier otro uid se desloguea y **no inicia listeners**. El frontend complementa las reglas; no las reemplaza. |
| Cobro de pedidos | Al confirmar cobro, **cualquier** pedido (`delivery`, `retiro` o `local`) pasa a `en_camino` — invariante del proyecto: un pedido cobrado entra al flujo del repartidor, desde cualquier etapa. Una **sola** transacción atómica escribe pago+estado leyendo el dato fresco del servidor (si ya estaba cobrado, o cancelado/archivado, no se escribe nada). Retiro/local conservan `tipo`/`origen`; no se reinterpreta el invariante. |
| Reglas de Firestore | Las reglas actuales **aún no publicadas** rechazan el pase directo a `en_camino` desde etapas como `nuevo`. El cobro depende de `tpv-push-backend/firestore.rules.proposed.txt` (solo seis campos de pago: `pago`, `pagado`, `cobradoEn`, `recibido`, `vuelto`, `estado`; admin exacto; `pagado: true`; servidor timestamp; método válido; previo sin pagar; sin cambio de `tipo`). Hasta aplicarla tras autorización y verificación en emulador, confirmar cobro puede ser **rechazado**: no hay toast de éxito, no se marca pagado y se informa honestamente. |
| Impresión automática | Desactivada: los snapshots nunca imprimen en el celular. La impresión explícita (🖨️ Ticket / Comanda) sigue disponible. |
| Camarero/delivery en esta app | No. El rol camarero y el modo repartidor viven en sus propias apps. |

## Notificaciones push (estado actual: DESACTIVADO)

- `push-config.js` trae `enabled: false` y `vapidKey: ''` (solo datos públicos; ningún secreto).
- El botón **🔔 Notif.** muestra "Notif.: falta configurar" y **nunca pide permiso** hasta que completes la configuración.
- Flujo al activar: botón 🔔 → permiso → token FCM → callable `registerTpvDevice({token})` (región `us-central1`, mismo proyecto Firebase) → queda "Notif. activas". Si el backend no responde, se revierte y **no** se afirma "activas".
- Desactivar: mismo botón. **Salir** revoca el token en el servidor **antes** de borrar el token del navegador y **antes** de cerrar sesión. Si la revocación falla, la sesión NO se cierra (no hay logout silencioso con suscripción activa).
- El service worker (`sw.js`, alcance acotado a esta carpeta) muestra una notificación genérica ("Nuevo pedido recibido", sin datos del cliente) con tag estable `tpv-new-order-<id>` para acotar duplicados visuales (mismo namespace que el backend). Tags ajenos/hostiles se rechazan y se derivan del orderId. No hay entrega garantizada ni "exactly-once": el sistema no lo promete y esta app tampoco.
- Nunca se cachean respuestas de Firebase ni se encolan escrituras de dinero/pedidos sin conexión. La caché offline es solo del shell estático.

### Para activar push (cuando decidas)

1. Desplegar el backend (unidad T2 `tpv-push-backend/`): callables `registerTpvDevice` / `unregisterTpvDevice` con autorización exacta por `TPV_ADMIN_UID`, y el trigger `notifyTpvNewOrder` (mensaje genérico, sin PII, tag por pedido). Colección `tpvPushDevices` solo servidor.
2. Firebase Console → Cloud Messaging → Web → generar el par de claves VAPID. Copiar la **clave pública** en `push-config.js` (`vapidKey`) y poner `enabled: true`.
3. Servir por **HTTPS** (GitHub Pages, Firebase Hosting, etc.). En iPhone hace falta iOS 16.4+ e instalar la app desde Safari; las notificaciones web en iOS en segundo plano dependen del sistema.
4. Verificar en un teléfono real: pedido de prueba → notificación con la app cerrada → clic abre la app. Sin esa prueba, no afirmar que funciona cerrada.

### Coste y honestidad operativa

- FCM es gratuito; el coste posible está en **Cloud Functions** (plan Blaze, datos salientes y ejecuciones; Google da una capa gratuita generosa). Nada se activa sin tu cuenta y tu despliegue explícito.
- Esta preparación **no** activa servicios remotos, no despliega, no crea cuentas ni factura nada. No se puede garantizar entrega con la app cerrada ni tras *force-stop* en Android; nadie puede.

## Futura APK

La instalable Android/iOS se derivará de esta misma carpeta (p. ej. contenedor WebView sobre Firebase Hosting, o "TWA"). **No se generó APK en esta unidad.** Para TWA hará falta dominio HTTPS, `assetlinks.json` y PWA con id estable.

## Verificación local

```
node --test mi-barrio-tpv-celular/test.mjs
```

Cubre: compuerta de admin, plan de cobro transaccional (`en_camino` para todo tipo; cancelado/archivado/ya cobrado = sin escritura), parser del service worker contra envelopes FCM anidados (tests VM), orquestación de push en orden (revoca-servidor → token-navegador → signOut; logout aborta ante fallo), config/permiso/estados UI de push, registro y revocación, y huellas SHA256 de `panel_nuevo.html` (`940A51D4…`), `index.html` (`9E9A2D29…`) y reglas. Cero llamadas de red en los tests.

## Archivos

`index.html` (app completa) · `push-helpers.js` (lógica testeable) · `push-config.js` (settings públicas, disabled) · `sw.js` · `manifest.json` · `icon*.svg|png` (regenerar: `node mi-barrio-tpv-celular/tools/generate-icons.mjs`) · `test.mjs` · `tools/` (generador y vista previa de iconos).

## Límites honestos

- No desplegado, no probado en teléfono real, no probado contra Firebase en vivo (los tests usan mocks).
- La impresión en móvil depende del sistema de impresión del teléfono; por eso está desactivada la automática.
- El cobrado a `en_camino` depende de que el backend del repartidor filtre `en_camino` (así es hoy, con cualquier tipo de pedido), y de aplicar `tpv-push-backend/firestore.rules.proposed.txt` tras autorización y verificación en emulador: **sin ella, el cobro muy probablemente será rechazado por las reglas actuales (no se escribe nada)**.
