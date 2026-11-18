/* ==========================================================================
   MI BARRIO — ETAPA 1.5
   Pruebas de concurrencia real sobre el núcleo (dos o más dispositivos).
   Usa el Firestore en memoria con concurrencia optimista y reintentos.
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODIGOS_ERROR,
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
    }
  },
  sabores: { gourmet: ['Suprema'], especial: ['Calabresa'], clasico: ['Muzza', 'Napolitana'] },
  extras: [
    { id: 'coca-15l', nombre: 'Coca Cola 1.5LT', precio: 17000 },
    { id: 'papas-med', nombre: 'Papas Medianas', precio: 15000 }
  ]
};

const PIZZA = { tamano: 'grande', sabores: ['Muzza'] };
const COCA = { id: 'coca-15l', cantidad: 1 };
const PAPAS = { id: 'papas-med', cantidad: 1 };

function almacen() {
  return new FirestoreEnMemoria()
    .sembrar('config', 'mesas', MESAS)
    .sembrar('config', 'menu', MENU);
}

function ejecutar(store, { mesa = 5, items, actor, operacionId, pedidoIdEsperado = null }) {
  return store.transaccion(tx => ejecutarOperacionCuenta(tx, {
    mesa,
    payload: items,
    actor,
    operacionId,
    pedidoIdEsperado,
    marcaTiempo: () => 'TS'
  }));
}

const actor = (n) => ({ uid: 'uid-camarero-' + n, email: 'camarero' + n + '@test', nombre: 'C' + n });

test('8 dispositivos amplían la misma cuenta a la vez sin perder ningún producto', async () => {
  const store = almacen();

  const inicial = await ejecutar(store, {
    items: { pizzas: [PIZZA] },
    actor: actor(0),
    operacionId: 'op-conc-base'
  });

  const resultados = await Promise.all(
    Array.from({ length: 8 }, (_, i) => ejecutar(store, {
      items: { extras: [COCA] },
      actor: actor(i + 1),
      operacionId: 'op-conc-amp-' + (i + 1),
      pedidoIdEsperado: inicial.pedidoId
    }))
  );

  assert.equal(store.contar('pedidos'), 1);
  assert.equal(store.contar('cuentas_mesa'), 1);
  assert.equal(store.contar('comandas'), 9);

  const pedido = store.leer('pedidos', inicial.pedidoId);
  assert.equal(pedido.pizzas.length, 1);
  assert.deepEqual(pedido.extras, [{ item: 'Coca Cola 1.5LT', cantidad: 8 }]);
  assert.equal(pedido.total, 60000 + 8 * 17000);

  const cuenta = store.leer('cuentas_mesa', '5');
  assert.equal(cuenta.operaciones, 9);
  assert.equal(cuenta.total, 60000 + 8 * 17000);
  assert.equal(cuenta.pedidoId, inicial.pedidoId);

  for (const r of resultados) {
    assert.equal(r.pedidoId, inicial.pedidoId);
    assert.equal(r.accion, 'ampliar');
  }
});

test('6 dispositivos abren la mesa desde cero al mismo tiempo: una sola cuenta', async () => {
  const store = almacen();

  const resultados = await Promise.all(
    Array.from({ length: 6 }, (_, i) => ejecutar(store, {
      items: { extras: [COCA] },
      actor: actor(i + 1),
      operacionId: 'op-conc-abrir-' + (i + 1)
    }))
  );

  assert.equal(store.contar('pedidos'), 1);
  assert.equal(store.contar('cuentas_mesa'), 1);
  assert.equal(store.contar('comandas'), 6);

  const pedidoId = resultados[0].pedidoId;
  assert.ok(resultados.every(r => r.pedidoId === pedidoId));

  const cuenta = store.leer('cuentas_mesa', '5');
  assert.equal(cuenta.operaciones, 6);
  assert.equal(cuenta.total, 6 * 17000);
  assert.equal(store.leer('pedidos', pedidoId).extras[0].cantidad, 6);
  assert.deepEqual(resultados.map(r => r.accion).sort(), ['ampliar', 'ampliar', 'ampliar', 'ampliar', 'ampliar', 'crear']);
});

test('doble toque con el mismo operacionId en paralelo se aplica una sola vez', async () => {
  const store = almacen();
  const inicial = await ejecutar(store, {
    items: { pizzas: [PIZZA] },
    actor: actor(1),
    operacionId: 'op-doble-base'
  });

  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => ejecutar(store, {
      items: { extras: [{ id: 'papas-med', cantidad: 2 }] },
      actor: actor(1),
      operacionId: 'op-doble-toque',
      pedidoIdEsperado: inicial.pedidoId
    }))
  );

  const aplicadas = resultados.filter(r => r.accion === 'ampliar');
  const duplicadas = resultados.filter(r => r.accion === 'duplicada');
  assert.equal(aplicadas.length, 1);
  assert.equal(duplicadas.length, 4);

  assert.equal(store.contar('comandas'), 2);
  const pedido = store.leer('pedidos', inicial.pedidoId);
  assert.deepEqual(pedido.extras, [{ item: 'Papas Medianas', cantidad: 2 }]);
  assert.equal(pedido.total, 60000 + 2 * 15000);
  assert.equal(store.leer('cuentas_mesa', '5').operaciones, 2);
});

test('una operación rechazada no deja escrituras parciales', async () => {
  const store = almacen();
  const inicial = await ejecutar(store, {
    items: { pizzas: [PIZZA] },
    actor: actor(1),
    operacionId: 'op-parcial-base'
  });

  await assert.rejects(
    () => ejecutar(store, {
      items: { pizzas: [{ tamano: 'grande', sabores: ['Fantasma'] }] },
      actor: actor(2),
      operacionId: 'op-parcial-mala',
      pedidoIdEsperado: inicial.pedidoId
    }),
    (err) => err.codigo === CODIGOS_ERROR.SABOR_INVALIDO
  );

  assert.equal(store.contar('comandas'), 1);
  assert.equal(store.leer('pedidos', inicial.pedidoId).total, 60000);
  assert.equal(store.leer('cuentas_mesa', '5').operaciones, 1);
});

test('el núcleo rechaza cualquier intento de fijar total o cobro en la operación', async () => {
  const store = almacen();

  for (const payload of [
    { pizzas: [PIZZA], total: 1 },
    { pizzas: [PIZZA], pagado: true },
    { pizzas: [PIZZA], descuento: 5000 },
    { pizzas: [PIZZA], pago: 'efectivo' },
    { pizzas: [PIZZA], numero: 4 }
  ]) {
    await assert.rejects(
      () => ejecutar(store, {
        items: payload,
        actor: actor(1),
        operacionId: 'op-fijar-' + Object.keys(payload).join('-')
      }),
      (err) => err.codigo === CODIGOS_ERROR.CAMPO_NO_PERMITIDO
    );
  }

  assert.equal(store.contar('pedidos'), 0);
  assert.equal(store.contar('cuentas_mesa'), 0);
  assert.equal(store.contar('comandas'), 0);
});
