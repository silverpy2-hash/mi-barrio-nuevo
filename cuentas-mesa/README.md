# Cuentas por mesa — Etapas 1 a 4

Núcleo del sistema de cuentas por mesa de **Mi Barrio** y su integración con
el TPV y la App Camarero. Firebase **Spark**, sin backend.

> Estado: implementado y probado en local. **No publicado.**
> Las reglas propuestas viven en `reglas_firestore_etapa1.txt` y
> **no se subieron a Firebase**. No se hizo commit, push ni deploy.

---

## 1. Cómo ejecutar (IMPORTANTE en Windows)

**Nunca abras ni ejecutes un `.js` con doble clic.** Windows lo entrega a
Microsoft JScript y falla con *Windows Script Host*. Los `.js` de este repo
son módulos ES o scripts de Node: siempre van precedidos de `node`.

```powershell
cd "F:\proyecto nuevo mi barrrio\cuentas-mesa"

# Núcleo, compatibilidad y concurrencia (34 pruebas)
node --test pruebas/

# Reglas de Firestore en el emulador (38 pruebas)
$env:JAVA_HOME="C:\Users\david\AppData\Local\Temp\opencode\jdk21\jre\jdk-21.0.13+9-jre"
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
& ".\node_modules\.bin\firebase.cmd" emulators:exec --project demo-mi-barrio --only firestore "node --test pruebas-reglas/"
```

Notas:

- `npm test` funciona igual que `node --test pruebas/`.
- En este equipo **`npm run test:reglas` termina con código 1 y sin salida**
  (problema del wrapper `firebase.cmd` con npm 11). Usar el comando directo
  de arriba. El emulador **siempre** usa reglas sincronizadas desde
  `reglas_firestore_etapa1.txt` con `node scripts/sincronizar-reglas.js`.
- `firebase.js` no se ejecuta: se **importa** desde el TPV o desde Node.
- Las apps (`index.html`, `panel_nuevo.html`, `app-camarero/`) se sirven por
  HTTP estático (Vercel o `npx serve .`), nunca abriendo los `.js` directo.

---

## 2. Qué resuelve

- Una **cuenta única por mesa**, con ampliaciones sin crear otro pedido.
- **Precios recalculados siempre desde `config/menu`** por `core.js`.
- **Cola `solicitudes_mesa`**: el camarero solo envía; el TPV valida,
  recalcula y confirma. Si el TPV está apagado, la solicitud queda pendiente.
- **Una comanda por operación confirmada** e impresión centralizada desde el
  TPV con reclamo transaccional anti-duplicados.
- **Cierre de caja coherente**: entregado pero no cobrado no es venta ni
  desaparece; el caja se bloquea si quedan mesas abiertas.
- Idempotencia y concurrencia mediante `operacionId` y la transacción sobre
  `cuentas_mesa/{mesa}`.

---

## 3. Archivos

| Archivo | Qué es |
|---|---|
| `cuentas-mesa/core.js` | Núcleo puro: validación, precios, planificación y orquestación. Sin Firebase ni DOM. |
| `cuentas-mesa/firebase.js` | Adaptador Firestore: `crearOAmpliarCuenta`, `leerSolicitud`, `procesarSolicitud`, `rechazarSolicitud`. |
| `cuentas-mesa/pruebas/` | 34 pruebas de núcleo, concurrencia y compatibilidad TPV. |
| `cuentas-mesa/pruebas-reglas/` | 38 pruebas contra el emulador oficial de Firestore. |
| `cuentas-mesa/scripts/sincronizar-reglas.js` | Copia las reglas propuestas al directorio del emulador. |
| `panel_nuevo.html` | TPV con vistas 🪑 Mesas y 📥 Solicitudes, cobro, comandas y cierre de caja. |
| `app-camarero/` | PWA del camarero: login por rol, mesas, menú, pedidos y cuenta en vivo. |
| `reglas_firestore_etapa1.txt` | Propuesta de reglas. **No publicada.** |

---

## 4. Modelo de datos

### `solicitudes_mesa/{operacionId}` — cola camarero → TPV (nueva)

```js
{
  operacionId: "op-...",   // id del documento; reintento sin duplicados
  mesa: 5,
  origen: "camarero",
  actorUid, actorEmail, actorNombre,   // quién la envió (auditoría)
  items: {
    pizzas: [{ tamano, sabores, borde }],   // SIN precios
    extras: [{ id, cantidad }]
  },
  estado: "pendiente",     // pendiente | confirmada | rechazada
  creado: serverTimestamp()
}
```

El camarero **solo crea** este documento. No puede actualizarlo ni borrarlo:
no puede aprobar su propia solicitud, cobrar ni descontar. Solo el admin
(TPV) cambia `estado`.

### `cuentas_mesa/{mesa}` — puntero y candado de la mesa

```js
{
  mesa: 5, mesaId: "5", cuentaId, pedidoId,
  estado: "abierta",       // abierta | pendiente_cobro | cerrada
  abiertaEn, abiertaPorUid, actualizadaEn, actualizadaPorUid,
  operaciones: 2, total: 94000, ultimaOperacionId: "op-..."
}
```

Es el punto de serialización: toda alta o ampliación se hace dentro de una
transacción. El TPV cierra la cuenta (`estado: 'cerrada'`) en el mismo *batch*
del cobro, así que la mesa se libera solo cuando se cobró realmente.

### `pedidos/{pedidoId}` y `comandas/{operacionId}`

Se mantienen compatibles con el TPV. El pedido de mesa nace con
`origen: 'camarero'`, `pagado: false` y sin `pago`/`descuento`/`numero`.
Cada confirmación genera su propia comanda con solo los productos nuevos.

---

## 5. Flujo

```
App Camarero
  └─ enviarSolicitud()  →  solicitudes_mesa/{operacionId}  (estado: pendiente)
                                      │
TPV administrador (abierto)  ← onSnapshot de pendientes
  └─ procesarSolicitud()
       1. lee la solicitud y config/menu + config/mesas
       2. crearOAmpliarCuenta() dentro de runTransaction
          → pedido + comanda + cuenta (precios recalculados)
       3. marca la solicitud como confirmada
                                      │
App Camarero  ← ve el cambio en vivo: "Enviada" → "Confirmada"
Cocina        ← imprime desde comandas con reclamo transaccional
```

Si el TPV está desconectado, las solicitudes quedan `pendiente`: la app
muestra **«Solicitud enviada»**, nunca **«Pedido confirmado»**.

---

## 6. Seguridad (propuesta, no publicada)

- `esCamarero()` = `usuarios/{uid}` con `rol: 'camarero'` y `activo: true`.
  **No** se decide por email.
- `solicitudes_mesa`: el camarero crea solo con `actorUid == request.auth.uid`
  y campos permitidos (sin precios ni totales); `update`/`delete` solo admin.
- `pedidos`, `cuentas_mesa` y `comandas`: el camarero tiene permisos acotados
  con `existsAfter`/`getAfter`; el **admin** puede confirmar, ampliar y cerrar
  porque es el componente de confianza del sistema.
- `config/mesas` legible por camareros; roles solo los escribe el admin.
- La creación anónima de pedidos (web/QR) y el delivery por email quedan igual.

### Limitación known

Sin backend, las reglas **no pueden recalcular precios** contra `config/menu`
(la prueba `HUECO CONOCIDO` lo demuestra). El TPV es el único que valida y
recalcula, pero un camarero con credenciales podría llamar directo a la API
antigua. Cerrar ese hueco requiere Cloud Functions o una API, fuera de Spark.

---

## 7. Pruebas

- **34/34** en `node --test pruebas/`: núcleo, concurrencia, idempotencia y
  compatibilidad con el TPV.
- **38/38** en el emulador de Firestore: reglas heredadas + 8 de
  `solicitudes_mesa` + 3 de operaciones del TPV (confirmar, ampliar, cerrar).

Todas pasaron en local. El comando exacto está en la sección 1.

---

## 8. Pendiente antes de publicar

1. Publicar `reglas_firestore_etapa1.txt` en Firebase (sin autorización
   todavía).
2. Subir `app-camarero/` y `cuentas-mesa/` junto con el TPV.
3. Crear usuarios con `usuarios/{uid} = { rol:'camarero', activo:true, nombre }`.
4. Verificar en producción con el TPV abierto, sin tocar datos reales de ventas.
5. El QR completo queda para la fase siguiente.
