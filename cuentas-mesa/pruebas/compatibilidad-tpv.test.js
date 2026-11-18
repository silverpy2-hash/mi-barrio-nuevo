/* ==========================================================================
   MI BARRIO — ETAPA 1.5
   Pruebas de compatibilidad del núcleo nuevo con el formato actual de pedidos
   del TPV (panel_nuevo.html).

   Objetivo: verificar que los pedidos/comandas/cuentas creados por el núcleo
   encajan con los campos, estados, numeración y cálculos que el TPV ya usa,
   SIN cambiar el TPV.

   Ejecutar:  cd cuentas-mesa && npm test
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODIGOS_ERROR,
  ErrorCuenta,
  estadoCuenta,
  ejecutarOperacionCuenta
} from '../core.js';

import { FirestoreEnMemoria } from './fake-firestore.js';

const MESAS = { mesas: [1, 5, 9] };

const MENU = {
  negocio: 'MI BARRIO',
  tamanos: {
    grande: {
      nombre: 'Pizza Grande + Mediana muzza gratis',
      corto: 'Grande',
      limite: 2,
      borde: 15000,
      precios: { clasico: 60000, especial: 75000, gourmet: 90000 }
    },
    mediano: {
      nombre: 'Pizza Mediana',
      corto: 'Mediana',
      limite: 2,
      borde: 12000,
      precios: { clasico: 30000, especial: 40000, gourmet: 50000 }
    }
  },
  sabores: {
    gourmet: ['Suprema'],
    especial: ['Calabresa'],
    clasico: ['Muzza', 'Napolitana']
  },
  extras: [
    { id: 'coca-15l', nombre: 'Coca Cola 1.5LT', precio: 17000 },
    { id: 'papas-med', nombre: 'Papas Medianas', precio: 15000 }
  ]
};

const ACTOR = { uid: 'uid-camarero-1', email: 'camarero1@mibarrio.test', nombre: 'Ana' };

const PIZZA_MUZZA = { tamano: 'grande', sabores: ['Muzza'] }; // 60.000
const COCA_X1 = { id: 'coca-15l', cantidad: 1 };               // 17.000

function nuevoAlmacen() {
  return new FirestoreEnMemoria()
    .sembrar('config', 'mesas', MESAS)
    .sembrar('config', 'menu', MENU);
}

function ejecutar(almacen, {
  mesa = 5,
  items,
  actor = ACTOR,
  operacionId,
  pedidoIdEsperado = null
}) {
  return almacen.transaccion(tx => ejecutarOperacionCuenta(tx, {
    mesa,
    payload: items,
    actor,
    operacionId,
    pedidoIdEsperado,
    marcaTiempo: () => 'TS'
  }));
}

async function esperarError(fn, codigo) {
  let capturado = null;
  try {
    await fn();
  } catch (err) {
    capturado = err;
  }
  assert.ok(capturado, 'Se esperaba el error ' + codigo + ' y la operación no falló.');
  assert.equal(capturado.codigo, codigo);
}

/* Valores del TPV que el núcleo debe tener en cuenta para ser legible/usable */
const ESTADOS_TPV = ['nuevo', 'preparacion', 'en_camino', 'entregado', 'cancelado'];
const ACTIVOS_TPV = ['nuevo', 'preparacion', 'en_camino'];
const TRANSICIONES_TPV = {
  nuevo: ['preparacion', 'cancelado'],
  preparacion: ['en_camino', 'entregado', 'cancelado'],
  en_camino: ['entregado', 'cancelado'],
  entregado: ['cancelado'],
  cancelado: []
};

/* ==========================================================================
   1. El pedido del núcleo cumple el contrato de campos que ya consume el TPV
   ========================================================================== */

test('el pedido que crea el núcleo trae los campos y estados que el TPV ya usa', async () => {
  const almacen = nuevoAlmacen();
  const res = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-compat-0001'
  });

  const pedido = almacen.leer('pedidos', res.pedidoId);

  // Identificación de local / tipo / mesa / origen.
  assert.equal(pedido.local, 'mi-barrio');
  assert.equal(pedido.tipo, 'local');
  assert.equal(pedido.mesa, 5);
  assert.equal(pedido.origen, 'camarero');

  // Estado: tiene que estar dentro del filtro de escucharPedidos del TPV.
  assert.ok(ESTADOS_TPV.includes(pedido.estado), 'El estado ' + pedido.estado + ' no está en el filtro del TPV.');
  assert.ok(ACTIVOS_TPV.includes(pedido.estado));

  // Cobro: nace sin pagar; el pago lo decide el TPV al cobrar.
  assert.equal(pedido.pagado, false);
  assert.equal(pedido.estado, 'nuevo');

  // Cliente: el ticket y el WhatsApp del TPV leen p.cliente.
  assert.equal(pedido.cliente.nombre, 'Mesa 5');

  // Ticket/comanda: el ticket del TPV lee pizzas[].{borde, precio, nombre},
  // extras[].{item, cantidad}, descuento, total, costoDelivery.
  assert.equal(pedido.pizzas.length, 1);
  const z = pedido.pizzas[0];
  assert.ok(['tamano', 'nombre', 'sabores', 'borde', 'precio'].every(k => k in z), 'Falta algún campo de pizza para el ticket: ' + Object.keys(z));
  assert.equal(z.nombre, 'Pizza Grande + Mediana muzza gratis');
  assert.equal(z.borde, false);
  assert.equal(z.precio, 60000);
  assert.ok(Array.isArray(pedido.extras));
  assert.equal(pedido.total, 60000);

  // El ticket calcula subtotal = total + descuento - costoDelivery (descuento 0 si no existe).
  const desc = Math.max(0, Math.round(Number(pedido.descuento) || 0));
  const envio = Math.max(0, Number(pedido.costoDelivery) || 0);
  assert.equal(Number((pedido.total + desc - envio).toFixed(0)), pedido.total);

  // El núcleo no debe escribir campos que solo el TPV (admin/cobro) o el cliente gestionan.
  for (const prohibido of ['numero', 'descuento', 'pago', 'cobradoEn', 'ticketImpreso', 'estadoActualizado']) {
    assert.equal(prohibido in pedido, false, 'El núcleo no debe escribir el campo ' + prohibido);
  }

  // El núcleo escribe exactamente los campos que el TPV necesita para la vista inicial.
  assert.deepEqual(
    Object.keys(pedido).sort(),
    [
      'actualizadoEn', 'actualizadoPor', 'cliente', 'creado', 'cuentaId', 'estado',
      'extras', 'local', 'mensaje', 'mesa', 'origen', 'pagado', 'pizzas', 'tipo', 'total',
      'ultimaOperacionId'
    ].sort()
  );
});

/* ==========================================================================
   2. Numeración y estados: el TPV asigna/valida; el núcleo no toca numero/estado
   ========================================================================== */

test('el núcleo no asigna número ni cambia estados; el TPV los gestiona desde su propia lógica', async () => {
  const almacen = nuevoAlmacen();
  const res = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-compat-0002'
  });

  const pedido = almacen.leer('pedidos', res.pedidoId);
  assert.equal('numero' in pedido, false, 'El núcleo no debe asignar número (lo hace el TPV con config/contador).');

  // Simula lo que hace asignarNumeros() del TPV: ordena por creado y asigna desde config/contador.
  const faltan = almacen.listar('pedidos').filter(p => !p.numero).sort((a, b) => (a.creado || 0) - (b.creado || 0));
  assert.equal(faltan.length, 1);
  const n = ((almacen.leer('config', 'contador') || {}).ultimo || 0) + 1;
  almacen.modificar('pedidos', res.pedidoId, { numero: n });
  almacen.modificar('config', 'contador', { ultimo: n });

  assert.equal(almacen.leer('pedidos', res.pedidoId).numero, 1);

  // El TPV avanza el estado con las transiciones válidas.
  assert.ok((TRANSICIONES_TPV.nuevo || []).includes('preparacion'));
  almacen.modificar('pedidos', res.pedidoId, { estado: 'preparacion' });
  assert.ok((TRANSICIONES_TPV.preparacion || []).includes('en_camino'));
  almacen.modificar('pedidos', res.pedidoId, { estado: 'en_camino' });
  assert.ok((TRANSICIONES_TPV.en_camino || []).includes('entregado'));
  almacen.modificar('pedidos', res.pedidoId, { estado: 'entregado' });

  // No hay transición hacia atrás permitida (ej: entregado -> nuevo).
  assert.equal((TRANSICIONES_TPV.entregado || []).includes('nuevo'), false);

  // El núcleo no debe pisar esos campos al ampliar: el merge de la transacción
  // solo toca pizzas/extras/total y los metadatos de la operación.
  const ampliar = await ejecutar(almacen, {
    items: { extras: [COCA_X1] },
    operacionId: 'op-compat-0003',
    pedidoIdEsperado: res.pedidoId
  });

  const pedidoAmpliado = almacen.leer('pedidos', res.pedidoId);
  assert.equal(ampliar.accion, 'ampliar');
  assert.equal(pedidoAmpliado.numero, 1, 'La ampliación no debe borrar el número asignado por el TPV.');
  assert.equal(pedidoAmpliado.estado, 'entregado');
  assert.equal(pedidoAmpliado.total, 60000 + 17000);
  assert.equal(pedidoAmpliado.creado, pedido.creado, 'La ampliación no debe tocar la fecha de creación.');
});

/* ==========================================================================
   3. Ampliación: preserva lo ya cargado y suma lo nuevo (sin perder productos)
   ========================================================================== */

test('una ampliación del núcleo conserva lo ya cargado y suma el importe nuevo', async () => {
  const almacen = nuevoAlmacen();
  const primera = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-compat-0004'
  });

  const segunda = await ejecutar(almacen, {
    items: { extras: [COCA_X1] },
    operacionId: 'op-compat-0005',
    pedidoIdEsperado: primera.pedidoId
  });

  assert.equal(segunda.accion, 'ampliar');
  assert.equal(segunda.pedidoId, primera.pedidoId);
  assert.equal(segunda.cuentaId, primera.cuentaId);
  assert.equal(segunda.operaciones, 2);

  // Sigue siendo UN solo pedido (sin duplicar la pizza).
  assert.equal(almacen.contar('pedidos'), 1);
  assert.equal(almacen.contar('comandas'), 2);

  const pedido = almacen.leer('pedidos', primera.pedidoId);
  assert.equal(pedido.pizzas.length, 1, 'La ampliación no debe duplicar la pizza.');
  assert.equal(pedido.extras.length, 1);
  assert.equal(pedido.extras[0].item, 'Coca Cola 1.5LT');
  assert.equal(pedido.extras[0].cantidad, 1);
  assert.equal(pedido.total, 60000 + 17000);

  // La comanda nueva tiene solo el ítem agregado.
  const comanda2 = almacen.leer('comandas', 'op-compat-0005');
  assert.deepEqual(comanda2.items.pizzas, []);
  assert.equal(comanda2.items.extras.length, 1);
  assert.equal(comanda2.subtotal, 17000);

  const cuenta = almacen.leer('cuentas_mesa', '5');
  assert.equal(cuenta.operaciones, 2);
  assert.equal(cuenta.total, 77000);
});

/* ==========================================================================
   4. Flujo TPV completo sobre un pedido del núcleo: preparación → entrega → cobro
   ========================================================================== */

test('el flujo TPV de preparación y cobro se completa sobre el pedido del núcleo', async () => {
  const almacen = nuevoAlmacen();
  const res = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-compat-0006'
  });

  let cuenta = almacen.leer('cuentas_mesa', '5');
  let pedido = almacen.leer('pedidos', res.pedidoId);

  // TPV: nuevo -> preparacion -> en_camino -> entregado
  almacen.modificar('pedidos', res.pedidoId, { estado: 'preparacion' });
  almacen.modificar('pedidos', res.pedidoId, { estado: 'en_camino' });
  almacen.modificar('pedidos', res.pedidoId, { estado: 'entregado' });

  cuenta = almacen.leer('cuentas_mesa', '5');
  pedido = almacen.leer('pedidos', res.pedidoId);
  assert.equal(estadoCuenta(cuenta, pedido), 'pendiente_cobro', 'Pedido servido (entregado) sin cobrar = pendiente de cobro.');

  // TPV: confirmarCobro escribe pago/pagado/cobradoEn/recibido/vuelto/estado:'entregado'.
  almacen.modificar('pedidos', res.pedidoId, {
    pago: 'efectivo',
    pagado: true,
    recibido: 60000,
    vuelto: 0,
    cobradoEn: 'TS'
  });

  cuenta = almacen.leer('cuentas_mesa', '5');
  pedido = almacen.leer('pedidos', res.pedidoId);
  assert.equal(estadoCuenta(cuenta, pedido), 'cerrada', 'Pedido cobrado debe cerrar la cuenta.');

  // Tras cobrado, el TPV (según AGENTS.md) debe llevar al flujo de entregador.
  // El núcleo no decide eso: el estado real guardado es coherente.
  assert.equal(pedido.pagado, true);
  assert.equal(pedido.estado, 'entregado');
});

/* ==========================================================================
   5. Ampliación rechazada sobre una cuenta ya cobrada (coherencia con el TPV)
   ========================================================================== */

test('el núcleo rechaza ampliar una cuenta que el TPV ya cobró', async () => {
  const almacen = nuevoAlmacen();
  const res = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-compat-0007'
  });
  almacen.modificar('pedidos', res.pedidoId, { pagado: true, estado: 'entregado' });

  await esperarError(
    () => ejecutar(almacen, {
      items: { extras: [COCA_X1] },
      operacionId: 'op-compat-0008',
      pedidoIdEsperado: res.pedidoId
    }),
    CODIGOS_ERROR.CUENTA_CERRADA
  );

  // Sin pedidoIdEsperado la mesa vuelve a quedar libre y se puede reabrir.
  const nueva = await ejecutar(almacen, {
    items: { extras: [COCA_X1] },
    operacionId: 'op-compat-0009'
  });
  assert.equal(nueva.accion, 'crear');
});

/* ==========================================================================
   6. El núcleo no puede saltarse validaciones de pago/descuento/total
   ========================================================================== */

test('el núcleo rechaza cualquier intento de definir total, descuento o pago en la operación', async () => {
  const almacen = nuevoAlmacen();

  for (const payload of [
    { pizzas: [PIZZA_MUZZA], total: 1 },
    { pizzas: [PIZZA_MUZZA], subtotal: 1 },
    { pizzas: [PIZZA_MUZZA], descuento: 5000 },
    { pizzas: [PIZZA_MUZZA], pago: 'efectivo' },
    { pizzas: [PIZZA_MUZZA], pagado: true },
    { pizzas: [PIZZA_MUZZA], numero: 3 },
    { pizzas: [PIZZA_MUZZA], estado: 'entregado' }
  ]) {
    await esperarError(
      () => almacen.transaccion(tx => ejecutarOperacionCuenta(tx, {
        mesa: 5,
        payload,
        actor: ACTOR,
        operacionId: 'op-compat-campo-' + Object.keys(payload).join('-').replace(/\W/g, '_'),
        marcaTiempo: () => 'TS'
      })),
      CODIGOS_ERROR.CAMPO_NO_PERMITIDO
    );
  }

  assert.equal(almacen.contar('pedidos'), 0);
  assert.equal(almacen.contar('cuentas_mesa'), 0);
  assert.equal(almacen.contar('comandas'), 0);
});
