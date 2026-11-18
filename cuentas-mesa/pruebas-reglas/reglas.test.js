/* ==========================================================================
   MI BARRIO — Pruebas de las reglas Firestore (ETAPA 1.5)
   --------------------------------------------------------------------------
   Se ejecutan contra el EMULADOR OFICIAL de Firestore, no contra producción.

     cd cuentas-mesa
     npm run test:reglas

   Requisitos: firebase-tools instalado + Java 11 o superior disponible.
   El proyecto se llama "demo-mi-barrio": cualquier id que empieza con "demo-"
   no toca ningún proyecto real ni requiere iniciar sesión.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';

import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  writeBatch,
  serverTimestamp,
  setLogLevel
} from 'firebase/firestore';

// Las pruebas de "debe fallar" generan errores gRPC esperados en consola.
setLogLevel('silent');

const UID_ADMIN = 'e8czOfuF82VqPwNUZjMpOSMHUQo2';
const UID_CAMARERO = 'uid-camarero-1';
const UID_CAMARERO_2 = 'uid-camarero-2';
const UID_CLIENTE = 'uid-cliente-1';
const UID_DELIVERY = 'uid-delivery-1';

const EMAIL_CAMARERO = 'camarero1@mibarrio.test';
const EMAIL_CAMARERO_2 = 'camarero2@mibarrio.test';
const EMAIL_DELIVERY = 'repartidor-delivery@mibarrio.test';

const MENU = {
  negocio: 'MI BARRIO',
  tamanos: {
    grande: {
      nombre: 'Pizza Grande + Mediana muzza gratis',
      corto: 'Grande',
      limite: 2,
      borde: 15000,
      precios: { clasico: 60000, especial: 75000, gourmet: 90000 }
    }
  },
  sabores: { gourmet: ['Suprema'], especial: ['Calabresa'], clasico: ['Muzza', 'Napolitana'] },
  extras: [
    { id: 'coca-15l', nombre: 'Coca Cola 1.5LT', precio: 17000 },
    { id: 'papas-med', nombre: 'Papas Medianas', precio: 15000 }
  ]
};

const MESAS = { mesas: [1, 5, 9] };

let env;

/* --------------------------------------------------------------------------
   Utilidades
   -------------------------------------------------------------------------- */

const db = (ctx) => ctx.firestore();
const admin = () => db(env.authenticatedContext(UID_ADMIN));
const camarero = (uid = UID_CAMARERO, email = EMAIL_CAMARERO) =>
  db(env.authenticatedContext(uid, { email }));
const cliente = () => db(env.authenticatedContext(UID_CLIENTE, { email: 'cliente@test.com' }));
const delivery = () => db(env.authenticatedContext(UID_DELIVERY, { email: EMAIL_DELIVERY }));
const anonimo = () => db(env.unauthenticatedContext());

function pizzaMuzza() {
  return {
    tamano: 'grande',
    nombre: 'Pizza Grande + Mediana muzza gratis',
    sabores: ['Muzza'],
    borde: false,
    precio: 60000
  };
}

function pedidoCamarero({ mesa = 5, cuentaId, pedidoId, operacionId, total = 60000, extra = {} }) {
  return {
    local: 'mi-barrio',
    estado: 'nuevo',
    creado: serverTimestamp(),
    tipo: 'local',
    mesa,
    origen: 'camarero',
    pagado: false,
    cliente: { nombre: 'Mesa ' + mesa },
    pizzas: [pizzaMuzza()],
    extras: [],
    total,
    mensaje: '',
    cuentaId,
    actualizadoPor: UID_CAMARERO,
    actualizadoEn: serverTimestamp(),
    ultimaOperacionId: operacionId,
    ...extra
  };
}

function comandaCamarero({ mesa = 5, cuentaId, pedidoId, operacionId, subtotal = 60000 }) {
  return {
    operacionId,
    cuentaId,
    pedidoId,
    mesa,
    origen: 'camarero',
    estado: 'pendiente',
    impresa: false,
    items: { pizzas: [pizzaMuzza()], extras: [] },
    subtotal,
    totalCuenta: subtotal,
    creado: serverTimestamp(),
    creadoPorUid: UID_CAMARERO,
    creadoPorEmail: EMAIL_CAMARERO,
    creadoPorNombre: 'Ana'
  };
}

function cuentaMesa({ mesa = 5, cuentaId, pedidoId, operacionId, total = 60000 }) {
  return {
    mesa,
    mesaId: String(mesa),
    cuentaId,
    pedidoId,
    estado: 'abierta',
    abiertaEn: serverTimestamp(),
    abiertaPorUid: UID_CAMARERO,
    abiertaPorEmail: EMAIL_CAMARERO,
    actualizadaEn: serverTimestamp(),
    actualizadaPorUid: UID_CAMARERO,
    operaciones: 1,
    total,
    ultimaOperacionId: operacionId
  };
}

/**
 * Abre una cuenta completa (pedido + comanda + cuenta) en UN solo batch,
 * igual que crearOAmpliarCuenta en la transacción real.
 */
function batchAbrirCuenta(ctx, {
  mesa = 5,
  cuentaId = 'cuenta-' + Math.random().toString(36).slice(2, 8),
  pedidoId = 'pedido-' + Math.random().toString(36).slice(2, 8),
  operacionId = 'op-' + Math.random().toString(36).slice(2, 10),
  total = 60000,
  pedidoExtra = {}
} = {}) {
  const b = writeBatch(ctx);
  b.set(doc(ctx, 'pedidos', pedidoId), pedidoCamarero({ mesa, cuentaId, pedidoId, operacionId, total, extra: pedidoExtra }));
  b.set(doc(ctx, 'comandas', operacionId), comandaCamarero({ mesa, cuentaId, pedidoId, operacionId, subtotal: total }));
  b.set(doc(ctx, 'cuentas_mesa', String(mesa)), cuentaMesa({ mesa, cuentaId, pedidoId, operacionId, total }));
  return { batch: b, ids: { mesa, cuentaId, pedidoId, operacionId } };
}

/** Amplía una cuenta: update del pedido + comanda nueva + update de la cuenta. */
function batchAmpliar(ctx, { mesa = 5, cuentaId, pedidoId, operacionId, subtotal = 34000, totalPrevio = 60000 }) {
  const nuevoTotal = totalPrevio + subtotal;
  const b = writeBatch(ctx);
  b.update(doc(ctx, 'pedidos', pedidoId), {
    pizzas: [pizzaMuzza()],
    extras: [{ item: 'Coca Cola 1.5LT', cantidad: 2 }],
    total: nuevoTotal,
    actualizadoPor: UID_CAMARERO,
    actualizadoEn: serverTimestamp(),
    ultimaOperacionId: operacionId
  });
  b.set(doc(ctx, 'comandas', operacionId), comandaCamarero({
    mesa, cuentaId, pedidoId, operacionId, subtotal
  }));
  b.update(doc(ctx, 'cuentas_mesa', String(mesa)), {
    cuentaId,
    pedidoId,
    estado: 'abierta',
    actualizadaEn: serverTimestamp(),
    actualizadaPorUid: UID_CAMARERO,
    operaciones: 2,
    total: nuevoTotal,
    ultimaOperacionId: operacionId
  });
  return b;
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-mi-barrio',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      // Copia sincronizada de reglas_firestore_etapa1.txt (ver pretest:reglas).
      rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')
    }
  });
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const dbAdmin = ctx.firestore();
    await setDoc(doc(dbAdmin, 'config', 'mesas'), MESAS);
    await setDoc(doc(dbAdmin, 'config', 'menu'), MENU);
    await setDoc(doc(dbAdmin, 'config', 'local'), { abierto: true });
    await setDoc(doc(dbAdmin, 'usuarios', UID_CAMARERO), { rol: 'camarero', activo: true, nombre: 'Ana' });
    await setDoc(doc(dbAdmin, 'usuarios', UID_CAMARERO_2), { rol: 'camarero', activo: true, nombre: 'Beto' });
    await setDoc(doc(dbAdmin, 'usuarios', 'uid-suspendido'), { rol: 'camarero', activo: false, nombre: 'Ex' });
  });
});

/* ==========================================================================
   1. Regresión: cliente anónimo / QR sigue funcionando igual
   ========================================================================== */

test('anónimo puede crear un pedido clásico (QR / app cliente)', async () => {
  const dbAnon = anonimo();
  await assertSucceeds(setDoc(doc(dbAnon, 'pedidos', 'qr-1'), {
    local: 'mi-barrio',
    estado: 'nuevo',
    creado: serverTimestamp(),
    cliente: { nombre: 'Cliente', celular: '595981123456' },
    pizzas: [pizzaMuzza()],
    extras: [],
    total: 60000,
    mensaje: 'pedido web',
    pago: 'efectivo'
  }));
});

test('anónimo NO puede crear un pedido con tipo/mesa/origen (no puede hacerse pasar por camarero)', async () => {
  const dbAnon = anonimo();
  await assertFails(setDoc(doc(dbAnon, 'pedidos', 'qr-2'), {
    local: 'mi-barrio',
    estado: 'nuevo',
    creado: serverTimestamp(),
    tipo: 'local',
    mesa: 5,
    origen: 'camarero',
    cliente: { nombre: 'Mesa 5' },
    pizzas: [pizzaMuzza()],
    extras: [],
    total: 60000,
    mensaje: ''
  }));
});

test('sin sesión no se pueden leer pedidos', async () => {
  await assertFails(getDoc(doc(anonimo(), 'pedidos', 'x')));
  await assertFails(getDoc(doc(anonimo(), 'cuentas_mesa', '5')));
  await assertFails(getDoc(doc(anonimo(), 'comandas', 'x')));
});

test('el admin y el delivery siguen leyendo pedidos', async () => {
  await assertSucceeds(getDoc(doc(admin(), 'pedidos', 'x')));
  await assertSucceeds(getDoc(doc(delivery(), 'pedidos', 'x')));
});

/* ==========================================================================
   2. Camarero: operación completa permitida
   ========================================================================== */

test('el camarero abre una cuenta en una mesa libre (pedido + comanda + cuenta en un batch)', async () => {
  const dbCam = camarero();
  const { batch, ids } = batchAbrirCuenta(dbCam, { mesa: 5, total: 94000 });

  await assertSucceeds(batch.commit());

  const pedido = await getDoc(doc(admin(), 'pedidos', ids.pedidoId));
  assert.equal(pedido.data().tipo, 'local');
  assert.equal(pedido.data().mesa, 5);
  assert.equal(pedido.data().pagado, false);

  const cuenta = await getDoc(doc(admin(), 'cuentas_mesa', '5'));
  assert.equal(cuenta.data().pedidoId, ids.pedidoId);
});

test('el camarero agrega productos a una cuenta abierta sin duplicar el pedido', async () => {
  const dbCam = camarero();
  const abrir = batchAbrirCuenta(dbCam, { mesa: 5, total: 60000 });
  await assertSucceeds(abrir.batch.commit());

  const ampliar = batchAmpliar(dbCam, {
    mesa: 5,
    cuentaId: abrir.ids.cuentaId,
    pedidoId: abrir.ids.pedidoId,
    operacionId: 'op-ampliar-0001'
  });

  await assertSucceeds(ampliar.commit());

  const pedido = await getDoc(doc(admin(), 'pedidos', abrir.ids.pedidoId));
  assert.equal(pedido.data().total, 94000);

  const cuenta = await getDoc(doc(admin(), 'cuentas_mesa', '5'));
  assert.equal(cuenta.data().operaciones, 2);
  assert.equal(cuenta.data().total, 94000);
});

test('el camarero puede reabrir una mesa cuya cuenta anterior ya fue cobrada', async () => {
  const dbCam = camarero();
  const primera = batchAbrirCuenta(dbCam, { mesa: 5, total: 60000 });
  await assertSucceeds(primera.batch.commit());

  // El TPV cobra y sirve el pedido.
  await assertSucceeds(updateDoc(doc(admin(), 'pedidos', primera.ids.pedidoId), {
    pagado: true,
    pago: 'efectivo',
    estado: 'entregado',
    cobradoEn: serverTimestamp()
  }));

  const segunda = batchAbrirCuenta(dbCam, { mesa: 5, total: 34000 });
  await assertSucceeds(segunda.batch.commit());

  const cuenta = await getDoc(doc(admin(), 'cuentas_mesa', '5'));
  assert.equal(cuenta.data().pedidoId, segunda.ids.pedidoId);
  assert.equal(cuenta.data().operaciones, 1);
});

/* ==========================================================================
   3. Camarero: lo que NO puede hacer
   ========================================================================== */

test('el camarero no puede crear pedidos delivery ni retiro', async () => {
  const dbCam = camarero();

  await assertFails(batchAbrirCuenta(dbCam, { mesa: 5, pedidoExtra: { tipo: 'delivery' } }).batch.commit());
  await assertFails(batchAbrirCuenta(dbCam, { mesa: 5, pedidoExtra: { tipo: 'retiro' } }).batch.commit());
});

test('el camarero no puede crear un pedido ya cobrado (pagado: true)', async () => {
  const dbCam = camarero();
  await assertFails(batchAbrirCuenta(dbCam, { mesa: 5, pedidoExtra: { pagado: true } }).batch.commit());
});

test('el camarero no puede inyectar descuento, pago, numero ni estado en el pedido', async () => {
  const dbCam = camarero();
  for (const extra of [
    { descuento: 5000 },
    { pago: 'efectivo' },
    { numero: 12 },
    { estado: 'entregado' },
    { cobradoEn: 'ahora' },
    { ticketImpreso: true }
  ]) {
    await assertFails(batchAbrirCuenta(dbCam, { mesa: 5, pedidoExtra: extra }).batch.commit());
  }
});

test('el camarero no puede crear el pedido sin la cuenta y la comanda del mismo lote', async () => {
  const dbCam = camarero();
  await assertFails(setDoc(doc(dbCam, 'pedidos', 'pedido-solo'), pedidoCamarero({
    cuentaId: 'cuenta-x',
    pedidoId: 'pedido-solo',
    operacionId: 'op-sin-comanda'
  })));
});

test('el camarero no puede bajar el total de un pedido', async () => {
  const dbCam = camarero();
  const abrir = batchAbrirCuenta(dbCam, { mesa: 5, total: 60000 });
  await assertSucceeds(abrir.batch.commit());

  const b = writeBatch(dbCam);
  b.update(doc(dbCam, 'pedidos', abrir.ids.pedidoId), {
    total: 1000,
    actualizadoPor: UID_CAMARERO,
    actualizadoEn: serverTimestamp(),
    ultimaOperacionId: 'op-bajar-total'
  });
  b.set(doc(dbCam, 'comandas', 'op-bajar-total'), comandaCamarero({
    cuentaId: abrir.ids.cuentaId,
    pedidoId: abrir.ids.pedidoId,
    operacionId: 'op-bajar-total',
    subtotal: 1000
  }));
  b.update(doc(dbCam, 'cuentas_mesa', '5'), {
    cuentaId: abrir.ids.cuentaId,
    pedidoId: abrir.ids.pedidoId,
    estado: 'abierta',
    actualizadaEn: serverTimestamp(),
    actualizadaPorUid: UID_CAMARERO,
    operaciones: 2,
    total: 1000,
    ultimaOperacionId: 'op-bajar-total'
  });
  await assertFails(b.commit());
});

test('el camarero no puede marcar un pedido como pagado, cobrado ni cambiar su estado', async () => {
  const dbCam = camarero();
  const abrir = batchAbrirCuenta(dbCam, { mesa: 5 });
  await assertSucceeds(abrir.batch.commit());

  for (const upd of [
    { pagado: true },
    { pago: 'efectivo' },
    { descuento: 5000 },
    { numero: 7 },
    { estado: 'entregado' },
    { ticketImpreso: true }
  ]) {
    await assertFails(updateDoc(doc(dbCam, 'pedidos', abrir.ids.pedidoId), upd));
  }
});

test('el camarero no puede cambiar de mesa ni el tipo de un pedido', async () => {
  const dbCam = camarero();
  const abrir = batchAbrirCuenta(dbCam, { mesa: 5 });
  await assertSucceeds(abrir.batch.commit());

  await assertFails(updateDoc(doc(dbCam, 'pedidos', abrir.ids.pedidoId), {
    mesa: 9,
    total: 60000,
    actualizadoPor: UID_CAMARERO,
    actualizadoEn: serverTimestamp(),
    ultimaOperacionId: 'op-cambiar-mesa'
  }));

  await assertFails(updateDoc(doc(dbCam, 'pedidos', abrir.ids.pedidoId), {
    tipo: 'delivery',
    total: 60000,
    actualizadoPor: UID_CAMARERO,
    actualizadoEn: serverTimestamp(),
    ultimaOperacionId: 'op-cambiar-tipo'
  }));
});

test('el camarero no puede borrar pedidos, cuentas ni comandas', async () => {
  const dbCam = camarero();
  const abrir = batchAbrirCuenta(dbCam, { mesa: 5 });
  await assertSucceeds(abrir.batch.commit());

  await assertFails(deleteDoc(doc(dbCam, 'pedidos', abrir.ids.pedidoId)));
  await assertFails(deleteDoc(doc(dbCam, 'cuentas_mesa', '5')));
  await assertFails(deleteDoc(doc(dbCam, 'comandas', abrir.ids.operacionId)));
});

test('el camarero no puede apropiarse de una cuenta abierta cambiando el pedidoId', async () => {
  const dbCam = camarero();
  const abrir = batchAbrirCuenta(dbCam, { mesa: 5 });
  await assertSucceeds(abrir.batch.commit());

  const b = writeBatch(dbCam);
  b.set(doc(dbCam, 'pedidos', 'pedido-intruso'), pedidoCamarero({
    mesa: 5, cuentaId: 'cuenta-intrusa', pedidoId: 'pedido-intruso', operacionId: 'op-intruso'
  }));
  b.set(doc(dbCam, 'comandas', 'op-intruso'), comandaCamarero({
    mesa: 5, cuentaId: 'cuenta-intrusa', pedidoId: 'pedido-intruso', operacionId: 'op-intruso'
  }));
  b.set(doc(dbCam, 'cuentas_mesa', '5'), cuentaMesa({
    mesa: 5, cuentaId: 'cuenta-intrusa', pedidoId: 'pedido-intruso', operacionId: 'op-intruso'
  }));
  await assertFails(b.commit());
});

test('el camarero no puede escribir una cuenta sin su pedido y su comanda', async () => {
  const dbCam = camarero();
  await assertFails(setDoc(doc(dbCam, 'cuentas_mesa', '9'), cuentaMesa({
    mesa: 9, cuentaId: 'cuenta-suelta', pedidoId: 'pedido-inexistente', operacionId: 'op-suelta'
  })));
});

test('el camarero no puede escribir una comanda suelta sin pedido/cuenta', async () => {
  const dbCam = camarero();
  await assertFails(setDoc(doc(dbCam, 'comandas', 'op-suelta'), comandaCamarero({
    mesa: 5, cuentaId: 'cuenta-suelta', pedidoId: 'pedido-inexistente', operacionId: 'op-suelta'
  })));
});

test('la comanda debe usar como id el mismo operacionId del documento', async () => {
  const dbCam = camarero();
  const b = writeBatch(dbCam);
  b.set(doc(dbCam, 'pedidos', 'pedido-id-op'), pedidoCamarero({
    mesa: 5, cuentaId: 'cuenta-id-op', pedidoId: 'pedido-id-op', operacionId: 'op-distinto'
  }));
  b.set(doc(dbCam, 'comandas', 'op-documento'), comandaCamarero({
    mesa: 5, cuentaId: 'cuenta-id-op', pedidoId: 'pedido-id-op', operacionId: 'op-distinto'
  }));
  b.set(doc(dbCam, 'cuentas_mesa', '5'), cuentaMesa({
    mesa: 5, cuentaId: 'cuenta-id-op', pedidoId: 'pedido-id-op', operacionId: 'op-distinto'
  }));
  await assertFails(b.commit());
});

test('un camarero suspendido (activo: false) no puede operar', async () => {
  const dbEx = db(env.authenticatedContext('uid-suspendido', { email: 'ex@mibarrio.test' }));
  await assertFails(batchAbrirCuenta(dbEx, { mesa: 5 }).batch.commit());
});

test('un usuario sin documento de rol no puede operar como camarero', async () => {
  const dbSinRol = db(env.authenticatedContext('uid-nuevo', { email: 'camarero@mibarrio.test' }));
  await assertFails(batchAbrirCuenta(dbSinRol, { mesa: 5 }).batch.commit());
});

/* ==========================================================================
   4. Roles: configuración, clientes, caja
   ========================================================================== */

test('el camarero lee config/mesas, config/menu y config/local', async () => {
  const dbCam = camarero();
  await assertSucceeds(getDoc(doc(dbCam, 'config', 'mesas')));
  await assertSucceeds(getDoc(doc(dbCam, 'config', 'menu')));
  await assertSucceeds(getDoc(doc(dbCam, 'config', 'local')));
});

test('el camarero no puede escribir configuración', async () => {
  const dbCam = camarero();
  await assertFails(setDoc(doc(dbCam, 'config', 'menu'), { ...MENU, negocio: 'OTRO' }));
  await assertFails(setDoc(doc(dbCam, 'config', 'mesas'), { mesas: [1] }));
});

test('el camarero no puede leer clientes, cierres, gastos ni pedidos privados de delivery', async () => {
  const dbCam = camarero();
  await assertFails(getDoc(doc(dbCam, 'clientes', '595981123456')));
  await assertFails(getDoc(doc(dbCam, 'cierres', 'c1')));
  await assertFails(getDoc(doc(dbCam, 'gastos', 'g1')));
});

test('el camarero no puede leer ni escribir usuarios ajenos', async () => {
  const dbCam = camarero();
  await assertSucceeds(getDoc(doc(dbCam, 'usuarios', UID_CAMARERO)));
  await assertFails(getDoc(doc(dbCam, 'usuarios', UID_CAMARERO_2)));
  await assertFails(setDoc(doc(dbCam, 'usuarios', UID_CAMARERO), {
    rol: 'camarero', activo: true, nombre: 'Ana', admin: true
  }));
  await assertFails(setDoc(doc(dbCam, 'usuarios', UID_CAMARERO_2), {
    rol: 'admin', activo: true
  }));
});

test('el admin conserva el cobro y las transiciones válidas; no puede retroceder estados', async () => {
  const dbAdm = admin();
  // La cuenta la abre el camarero (es el único rol habilitado para eso).
  const abrir = batchAbrirCuenta(camarero(), { mesa: 5 });
  await assertSucceeds(abrir.batch.commit());

  await assertSucceeds(updateDoc(doc(dbAdm, 'pedidos', abrir.ids.pedidoId), {
    estado: 'entregado',
    pagado: true,
    pago: 'efectivo',
    descuento: 0,
    numero: 1,
    cobradoEn: serverTimestamp()
  }));

  await assertFails(updateDoc(doc(dbAdm, 'pedidos', abrir.ids.pedidoId), {
    estado: 'nuevo'
  }));
});

/* ==========================================================================
   5. Límites conocidos de las reglas (documentados, no "aprobados")
   ========================================================================== */

test('HUECO CONOCIDO: las reglas no recalculan precios, un camarero puede mandar un total que no coincide con el menú', async () => {
  const dbCam = camarero();
  // Misma forma permitida, pero el total es inventado. Las reglas no pueden
  // sumar config/menu, así que esto PASA. Es la razón por la que hace falta
  // validación del lado servidor (Cloud Functions / API) antes de producción.
  const abrir = batchAbrirCuenta(dbCam, { mesa: 5, total: 1 });
  await assertSucceeds(abrir.batch.commit());

  const pedido = await getDoc(doc(admin(), 'pedidos', abrir.ids.pedidoId));
  assert.equal(pedido.data().total, 1);
});

/* ==========================================================================
   6. ETAPA 2 — cola solicitudes_mesa (App Camarero -> TPV)
   ========================================================================== */

function solicitudValida({
  id = 'sol-' + Math.random().toString(36).slice(2, 10),
  mesa = 5,
  actorUid = UID_CAMARERO,
  estado = 'pendiente',
  extra = {}
} = {}) {
  return {
    operacionId: id,
    mesa,
    origen: 'camarero',
    actorUid,
    actorEmail: EMAIL_CAMARERO,
    actorNombre: 'Ana',
    items: {
      pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false }],
      extras: [{ id: 'coca-15l', cantidad: 2 }]
    },
    estado,
    creado: serverTimestamp(),
    ...extra
  };
}

test('ETAPA 2: el camarero crea una solicitud pendiente con campos permitidos', async () => {
  const s = solicitudValida();
  await assertSucceeds(setDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), s));
  const guardada = await getDoc(doc(admin(), 'solicitudes_mesa', s.operacionId));
  assert.equal(guardada.data().estado, 'pendiente');
});

test('ETAPA 2: el camarero no puede crear una solicitud ya confirmada', async () => {
  const s = solicitudValida({ estado: 'confirmada' });
  await assertFails(setDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), s));
});

test('ETAPA 2: el camarero no puede firmar la solicitud con el uid de otro', async () => {
  const s = solicitudValida({ actorUid: UID_CAMARERO_2 });
  await assertFails(setDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), s));
});

test('ETAPA 2: el camarero no puede meter totales ni precios en la solicitud', async () => {
  const s = solicitudValida({ extra: { total: 1 } });
  await assertFails(setDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), s));
});

test('ETAPA 2: el camarero no puede aprobar su propia solicitud (update directo)', async () => {
  const s = solicitudValida();
  await assertSucceeds(setDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), s));
  await assertFails(updateDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), {
    estado: 'confirmada', procesadaEn: serverTimestamp()
  }));
});

test('ETAPA 2: el camarero no puede borrar solicitudes', async () => {
  const s = solicitudValida();
  await assertSucceeds(setDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), s));
  await assertFails(deleteDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId)));
});

test('ETAPA 2: solo el admin confirma o rechaza la solicitud', async () => {
  const s = solicitudValida();
  await assertSucceeds(setDoc(doc(camarero(), 'solicitudes_mesa', s.operacionId), s));
  await assertSucceeds(updateDoc(doc(admin(), 'solicitudes_mesa', s.operacionId), {
    estado: 'confirmada', procesadaEn: serverTimestamp()
  }));
  const s2 = solicitudValida();
  await assertSucceeds(setDoc(doc(camarero(), 'solicitudes_mesa', s2.operacionId), s2));
  await assertSucceeds(updateDoc(doc(admin(), 'solicitudes_mesa', s2.operacionId), {
    estado: 'rechazada', motivo: 'Producto inválido', procesadaEn: serverTimestamp()
  }));
});

test('ETAPA 2: un usuario sin rol de camarero no crea solicitudes', async () => {
  const s = solicitudValida({ actorUid: 'uid-suspendido' });
  await assertFails(setDoc(doc(db(env.authenticatedContext('uid-suspendido', { email: 'ex@test.com' })), 'solicitudes_mesa', s.operacionId), s));
});

/* ==========================================================================
   7. ETAPA 4 — operaciones del TPV administrador sobre mesas
   El admin es el componente de confianza: confirma, amplía y cierra cuentas.
   ========================================================================== */

test('ETAPA 4: el TPV confirma una solicitud y abre pedido + comanda + cuenta', async () => {
  // Equivale a procesarSolicitud(): misma transacción, pero request.auth = admin.
  const abrir = batchAbrirCuenta(admin(), { mesa: 9 });
  await assertSucceeds(abrir.batch.commit());
  const pedido = await getDoc(doc(admin(), 'pedidos', abrir.ids.pedidoId));
  assert.equal(pedido.data().origen, 'camarero');
  assert.equal(pedido.data().pagado, false);
});

test('ETAPA 4: el TPV amplía una cuenta abierta con una comanda nueva', async () => {
  const abrir = batchAbrirCuenta(admin(), { mesa: 5 });
  await assertSucceeds(abrir.batch.commit());
  const ampliar = batchAmpliar(admin(), {
    mesa: abrir.ids.mesa,
    cuentaId: abrir.ids.cuentaId,
    pedidoId: abrir.ids.pedidoId,
    operacionId: 'op-tpv-' + Math.random().toString(36).slice(2, 8)
  });
  await assertSucceeds(ampliar.commit());
});

test('ETAPA 4: el TPV cierra la cuenta al cobrar; el camarero no puede cerrarla', async () => {
  const abrir = batchAbrirCuenta(admin(), { mesa: 5 });
  await assertSucceeds(abrir.batch.commit());
  await assertFails(updateDoc(doc(camarero(), 'cuentas_mesa', '5'), {
    estado: 'cerrada', cerradaEn: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(admin(), 'cuentas_mesa', '5'), {
    estado: 'cerrada', cerradaEn: serverTimestamp(), cerradaPorUid: UID_ADMIN
  }));
  const cuenta = await getDoc(doc(admin(), 'cuentas_mesa', '5'));
  assert.equal(cuenta.data().estado, 'cerrada');
});
