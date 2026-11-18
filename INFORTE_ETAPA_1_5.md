# INFORTE TÉCNICO — ETAPA 1.5: SEGURIDAD Y PRUEBAS REALES

**Mi Barrio — App Camarero / Cuentas por mesa**
Fecha: 2026-11-18 · **Solo local. No publicó, no desplegó, no commit.**

---

## 1. Objetivo de la etapa

1. Comparar **Firebase Cloud Functions** vs **API de Vercel** para validar
   pedidos/precios desde un servidor confiable.
2. Recomendar la alternativa más sencilla, segura y económica.
3. Comprobar requisitos técnicos y de facturación (**sin activar servicios de pago**).
4. Preparar pruebas de reglas Firestore con el **emulador oficial**.
5. Verificar que el camarero no pueda modificar precios, descuentos, pagos ni totales.
6. Verificar que dos dispositivos puedan ampliar una cuenta simultáneamente sin perder productos.
7. Revisar compatibilidad del núcleo con el formato actual del TPV.
8. Comprobar que no se puedan saltar validaciones mediante escrituras directas a Firestore.

---

## 2. Backend: Cloud Functions vs Vercel — resultado de la comparación

### 2.1 Firebase Cloud Functions
- **Ventajas**: integración nativa con Firebase Auth + Firestore (tokens de admin),
  misma base de datos, despliegue con `firebase deploy --only functions`,
  escalado automático.
- **Desventajas**: requiere **plan Blaze** (empresarial/pago por uso).
- **Coste real estimado**: con uso típico de local pequeño (decenas de pedidos/día),
  las **2.000.000 invocaciones/mes, 400.000 GB-s, 200.000 CPU-s y 5 GB egreso** del plan
  Blaze quedan muy por encima del consumo esperado → coste aprox. **USD 0–5/mes**.

### 2.2 API de Vercel
- **Hobby** (`$0/mes`): solo uso personal/no comercial según sus Términos (§4,
  actualizados 2026-10-19). Un negocio requeriría **Pro a USD 20/usuario/mes**.
- Funciona, pero el plan gratuito no es viable para un negocio real.

### 2.3 Recomendación
- **Recomendada: Cloud Functions en plan Blaze** para Mi Barrio.
- Es la más sencilla y segura: reutiliza `core.js` (`prepararOperacion`) para
  recalcular precios contra `config/menu` y revalidar el payload server-side;
  el adaptador admin de Firestore maneja Auth/Firestore.
- No se implementó nada: queda como **deuda técnica explícita** pendiente de
  autorización del usuario para pasar al plan Blaze y desplegar.

---

## 3. Requisitos técnicos y de facturación

| Tema | Estado |
|---|---|
| Firebase Blaze (para Cloud Functions) | Requerido; gratuito hasta 2M invocaciones/mes, 400K GB-s, 200K CPU-s, 5 GB egreso. |
| Firebase Spark (plan gratuito) | NO sirve para Cloud Functions. |
| Vercel Hobby | Gratis, pero solo uso personal/no comercial → no apto para negocio. |
| Vercel Pro | USD 20/usuario/mes → viable solo si se descarta Cloud Functions. |
| Emulador oficial de Firestore | Instalado y operativo (firebase-tools 15.36.0, Java 21 portátil, `@firebase/rules-unit-testing` 6.0.0, `firebase` 13.4.0). Sin tocar PATH del sistema. |
| Proyecto de pruebas | `demo-mi-barrio` (emulador; sin acceso a proyecto real ni login). |

---

## 4. Pruebas de reglas con el emulador oficial — resultado: **27/27 en verde**

- Archivo de reglas probado: `reglas_firestore_etapa1.txt` → copia en
  `cuentas-mesa/pruebas-reglas/firestore.rules` (generada por
  `cuentas-mesa/scripts/sincronizar-reglas.js`; el original no se tocó).
- Configuración: `cuentas-mesa/firebase.json` (emulador Firestore, host
  127.0.0.1, puerto 8080, `singleProjectMode`).
- Comando: `cd cuentas-mesa && npm run test:reglas`.
- Cero escrituras en proyecto real (demo-*).

### 4.1 Cobertura verificada (27 pruebas)
- El camarero **no** puede crear delivery/retiro, ni `pagado: true`, ni inyectar
  `descuento`, `pago`, `numero`, `estado`, `cobradoEn` o `ticketImpreso`.
- No puede bajar `total`, cambiar mesa/tipo, borrar documentos, apropiarse de una
  cuenta abierta, escribir cuenta/comanda sueltas, reutilizar `operacionId`.
- Camarero suspendido o sin documento de rol no opera.
- No lee clientes/cierres/gastos ni usuarios ajenos; no escribe `config`.
- Admin conserva el cobro y las transiciones válidas; no puede retroceder estados.

### 4.2 Reapertura de mesa con cuenta cobrada — validada en reglas.
### 4.3 Hueco conocido demostrado en reglas — las reglas NO pueden recalcular
    precios; un camarero autenticado puede enviar un `total` que no coincide con
    el menú. **Justifica la validación server-side (backend).**

---

## 5. Pruebas del núcleo y concurrencia — resultado: **28/28 en verde**

- Suite completa: `cd cuentas-mesa && node --test pruebas/` → **28/28**.
- **Concurrencia (ETAPA 1.5, nueva)**: 5 pruebas sobre `FirestoreEnMemoria` con
  versiones/reintentos:
  - 8 dispositivos amplían la misma cuenta a la vez sin perder productos.
  - 6 dispositivos abren la mesa desde cero al mismo tiempo: una sola cuenta.
  - Doble toque con el mismo `operacionId` en paralelo: se aplica una sola vez.
  - Operación rechazada sin escrituras parciales.
  - El núcleo rechaza fijar `total`/`pagado`/`descuento`/`pago`/`numero`.

---

## 6. Compatibilidad con el TPV — resultado: **6/6 nuevas pruebas en verde**

Archivo nuevo: `cuentas-mesa/pruebas/compatibilidad-tpv.test.js`.

Verificó que el formato que crea el núcleo encaja con lo que el TPV ya lee/escribe:

1. El pedido creado trae los campos y estados que el TPV consume
   (`escucharPedidos`, `imprimirTicket`, `asignarNumeros`, `recordarCliente`).
2. El núcleo **no asigna número** ni cambia estados: el TPV lo hace
   (`config/contador` + `asignarNumeros`).
3. Una ampliación **conserva** lo ya cargado y suma lo nuevo (sin duplicar pizzas,
   sin perder productos).
4. El flujo TPV (preparación → en camino → entregado → cobro) se completa sobre el
   pedido del núcleo y deja la cuenta en `cerrada` vía `estadoCuenta`.
5. El núcleo rechaza ampliar una cuenta que el TPV ya cobró.
6. El núcleo rechaza cualquier intento de definir `total`, `descuento` o `pago`.

---

## 7. Resumen de resultados de pruebas

| Suite | Tests | Estado |
|---|---:|---|
| Núcleo (`cuentas-mesa/pruebas/etapa1.test.js`) | 23 | ✅ 23/23 |
| Concurrencia (`cuentas-mesa/pruebas/concurrencia.test.js`) | 5 | ✅ 5/5 |
| Compatibilidad TPV (`cuentas-mesa/pruebas/compatibilidad-tpv.test.js`) | 6 | ✅ 6/6 |
| Reglas (`cuentas-mesa/pruebas-reglas/`, emulador) | 27 | ✅ 27/27 |

**Total: 61 pruebas en verde** (fuera del entorno de reglas, que usan el emulador).

---

## 8. Huecos conocidos (ETAPA 2 pendiente de análisis/correction)

1. **Hueco de precios**: las reglas no pueden recalcular precios → necesita backend.
2. **Bug preexistente del TPV** (no tocado, ETAPA 2 debe decidir): `cerrarCaja`
   archiva entregados/cancelados sin comprobar `pagado`; un pedido servido pero
   impago se contaría como venta y se archivaría.
3. **Impresión**: ampliaciones no se autoimprimen (`comandaImpresa` solo para pedidos
   nuevos) → ETAPA 2 debe imprimir desde `comandas`.
4. **App Cliente**: reintenta con `payloadMinimo` quitando `tipo/mesa/origen/...` si las
   reglas publicadas niegan el payload completo → sigue funcionando sin mesa en Firestore.

---

## 9. Decisiones tomadas en ETAPA 1.5

- Se instalaron herramientas de desarrollo solo locales y de prueba
  (`firebase-tools`, `@firebase/rules-unit-testing`, `firebase`, JRE 21 portátil).
- No se publicaron reglas, no se desplegó nada, no se hizo commit/push.
- No se activó ningún servicio de pago.

---

## 10. Próximo paso

**ETAPA 2** (implementar Cloud Functions / API) queda pendiente de autorización
expresa del usuario. No se avanzó a ella en esta etapa.
