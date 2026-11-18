/* ==========================================================================
   MI BARRIO — Pruebas de la Etapa 1 (cuentas por mesa)
   Ejecutar:  cd cuentas-mesa && npm test
              (o) node --test cuentas-mesa/pruebas/
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODIGOS_ERROR,
  ErrorCuenta,
  estadoCuenta,
  ejecutarOperacionCuenta,
  generarOperacionId,
  normalizarItems,
  prepararOperacion,
  validarOperacionId
} from '../core.js';

import { FirestoreEnMemoria } from './fake-firestore.js';

/* --------------------------------------------------------------------------
   Datos de prueba (misma forma que config/menu y config/mesas reales)
   -------------------------------------------------------------------------- */

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
const ACTOR2 = { uid: 'uid-camarero-2', email: 'camarero2@mibarrio.test', nombre: 'Beto' };

const PIZZA_MUZZA = { tamano: 'grande', sabores: ['Muzza'] };             // 60.000
const PIZZA_SUPREMA_BORDE = { tamano: 'grande', sabores: ['Suprema'], borde: true }; // 105.000
const COCA_X2 = { id: 'coca-15l', cantidad: 2 };                          // 34.000

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
  assert.ok(capturado instanceof ErrorCuenta, 'Debe ser ErrorCuenta, llegó: ' + capturado);
  assert.equal(
    capturado.codigo,
    codigo,
    'Código esperado ' + codigo + ', llegó ' + capturado.codigo + ': ' + capturado.message
  );
}

/* --------------------------------------------------------------------------
   1. Precios y validación del payload
   -------------------------------------------------------------------------- */

test('normalizarItems recalcula los precios desde el menú', () => {
  const items = normalizarItems(MENU, {
    pizzas: [PIZZA_MUZZA, PIZZA_SUPREMA_BORDE],
    extras: [COCA_X2]
  });

  assert.equal(items.pizzas.length, 2);
  assert.equal(items.pizzas[0].precio, 60000);
  assert.equal(items.pizzas[0].nombre, 'Pizza Grande + Mediana muzza gratis');
  assert.equal(items.pizzas[1].precio, 105000);
  assert.equal(items.extras[0].item, 'Coca Cola 1.5LT');
  assert.equal(items.extras[0].precioUnitario, 17000);
  assert.equal(items.extras[0].precioTotal, 34000);
  assert.equal(items.subtotal, 60000 + 105000 + 34000);
});

test('rechaza precios manipulados en pizzas y extras', async () => {
  await esperarError(
    () => Promise.resolve(normalizarItems(MENU, { pizzas: [{ ...PIZZA_MUZZA, precio: 1 }] })),
    CODIGOS_ERROR.PRECIO_MANIPULADO
  );
  await esperarError(
    () => Promise.resolve(normalizarItems(MENU, { extras: [{ id: 'coca-15l', cantidad: 1, precio: 1 }] })),
    CODIGOS_ERROR.PRECIO_MANIPULADO
  );
});

test('rechaza cualquier campo de cobro o total en el payload', async () => {
  const prohibidos = [
    { total: 1 },
    { subtotal: 1 },
    { pagado: true },
    { pago: 'efectivo' },
    { descuento: 5000 },
    { numero: 12 },
    { estado: 'entregado' },
    { tipo: 'delivery' },
    { mesa: 9 },
    { cliente: { nombre: 'Otra' } },
    { creado: 'TS' },
    { origen: 'panel' }
  ];

  for (const extra of prohibidos) {
    await esperarError(
      () => Promise.resolve(normalizarItems(MENU, { pizzas: [PIZZA_MUZZA], ...extra })),
      CODIGOS_ERROR.CAMPO_NO_PERMITIDO
    );
  }
});

test('rechaza tamaños, sabores y extras inválidos o fuera de límite', async () => {
  const casos = [
    [{ pizzas: [{ tamano: 'gigante', sabores: ['Muzza'] }] }, CODIGOS_ERROR.TAMANO_INVALIDO],
    [{ pizzas: [{ tamano: 'grande', sabores: ['Fantasma'] }] }, CODIGOS_ERROR.SABOR_INVALIDO],
    [{ pizzas: [{ tamano: 'grande', sabores: ['Muzza', 'Napolitana', 'Suprema'] }] }, CODIGOS_ERROR.SABORES_LIMITE],
    [{ pizzas: [{ tamano: 'grande', sabores: ['Muzza', 'Muzza'] }] }, CODIGOS_ERROR.SABOR_DUPLICADO],
    [{ pizzas: [{ tamano: 'grande', sabores: [] }] }, CODIGOS_ERROR.PIZZA_INVALIDA],
    [{ extras: [{ id: 'fantasma', cantidad: 1 }] }, CODIGOS_ERROR.EXTRA_INVALIDO],
    [{ extras: [{ id: 'coca-15l', cantidad: 0 }] }, CODIGOS_ERROR.CANTIDAD_INVALIDA],
    [{ extras: [{ id: 'coca-15l', cantidad: 1 }, { id: 'coca-15l', cantidad: 1 }] }, CODIGOS_ERROR.EXTRA_DUPLICADO],
    [{}, CODIGOS_ERROR.SIN_PRODUCTOS]
  ];

  for (const [payload, codigo] of casos) {
    await esperarError(() => Promise.resolve(normalizarItems(MENU, payload)), codigo);
  }
});

test('rechaza pedidos que superan los límites de Firestore', async () => {
  const muchasPizzas = Array.from({ length: 31 }, () => PIZZA_MUZZA);
  await esperarError(
    () => Promise.resolve(normalizarItems(MENU, { pizzas: muchasPizzas })),
    CODIGOS_ERROR.LIMITE_EXCEDIDO
  );

  // 11 líneas de extras: primero se valida el tope de la lista (10).
  const muchosExtras = Array.from({ length: 11 }, (_, i) => ({
    id: i % 2 === 0 ? 'coca-15l' : 'papas-med',
    cantidad: 1
  }));
  await esperarError(
    () => Promise.resolve(normalizarItems(MENU, { extras: muchosExtras })),
    CODIGOS_ERROR.LIMITE_EXCEDIDO
  );

  // Dentro del tope de 10 líneas, un id repetido es un error de duplicado.
  await esperarError(
    () => Promise.resolve(normalizarItems(MENU, {
      extras: [
        { id: 'coca-15l', cantidad: 1 },
        { id: 'coca-15l', cantidad: 2 }
      ]
    })),
    CODIGOS_ERROR.EXTRA_DUPLICADO
  );
});

test('rechaza un importe de operación mayor al máximo permitido', async () => {
  // 8 Coca Colas de 99 unidades superan los 5.000.000 Gs.
  const payload = { extras: [{ id: 'coca-15l', cantidad: 99 }, { id: 'papas-med', cantidad: 99 }] };
  const chico = normalizarItems(MENU, payload);
  assert.ok(chico.subtotal < 5000000);

  const menuCaro = {
    ...MENU,
    extras: [
      { id: 'coca-15l', nombre: 'Coca Cola 1.5LT', precio: 1700000 },
      { id: 'papas-med', nombre: 'Papas Medianas', precio: 1700000 }
    ]
  };
  await esperarError(
    () => Promise.resolve(normalizarItems(menuCaro, { extras: [{ id: 'coca-15l', cantidad: 2 }, { id: 'papas-med', cantidad: 2 }] })),
    CODIGOS_ERROR.LIMITE_EXCEDIDO
  );
});

/* --------------------------------------------------------------------------
   2. Operación completa contra el almacén transaccional
   -------------------------------------------------------------------------- */

test('crea una cuenta en una mesa libre con un pedido compatible con el TPV', async () => {
  const almacen = nuevoAlmacen();
  const res = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA], extras: [COCA_X2] },
    operacionId: 'op-crear-0001'
  });

  assert.equal(res.accion, 'crear');
  assert.equal(res.mesa, 5);
  assert.equal(res.total, 94000);
  assert.equal(res.operaciones, 1);
  assert.equal(almacen.contar('pedidos'), 1);
  assert.equal(almacen.contar('cuentas_mesa'), 1);
  assert.equal(almacen.contar('comandas'), 1);

  const pedido = almacen.leer('pedidos', res.pedidoId);
  assert.equal(pedido.local, 'mi-barrio');
  assert.equal(pedido.tipo, 'local');
  assert.equal(pedido.mesa, 5);
  assert.equal(pedido.origen, 'camarero');
  assert.equal(pedido.estado, 'nuevo');
  assert.equal(pedido.pagado, false);
  assert.equal(pedido.total, 94000);
  assert.equal(pedido.cuentaId, res.cuentaId);
  assert.equal(pedido.ultimaOperacionId, 'op-crear-0001');
  assert.equal(pedido.actualizadoPor, ACTOR.uid);
  assert.equal(pedido.pizzas.length, 1);
  assert.deepEqual(pedido.extras, [{ item: 'Coca Cola 1.5LT', cantidad: 2 }]);

  // El camarero no puede fijar estado de cobro, número ni descuento.
  assert.equal('pago' in pedido, false);
  assert.equal('descuento' in pedido, false);
  assert.equal('numero' in pedido, false);
  assert.equal('cobradoEn' in pedido, false);

  const cuenta = almacen.leer('cuentas_mesa', '5');
  assert.equal(cuenta.mesa, 5);
  assert.equal(cuenta.mesaId, '5');
  assert.equal(cuenta.pedidoId, res.pedidoId);
  assert.equal(cuenta.cuentaId, res.cuentaId);
  assert.equal(cuenta.estado, 'abierta');
  assert.equal(cuenta.abiertaPorUid, ACTOR.uid);
  assert.equal(cuenta.abiertaPorEmail, ACTOR.email);
  assert.equal(cuenta.operaciones, 1);
  assert.equal(cuenta.total, 94000);
  assert.equal(cuenta.ultimaOperacionId, 'op-crear-0001');

  const comanda = almacen.leer('comandas', 'op-crear-0001');
  assert.equal(comanda.mesa, 5);
  assert.equal(comanda.pedidoId, res.pedidoId);
  assert.equal(comanda.cuentaId, res.cuentaId);
  assert.equal(comanda.origen, 'camarero');
  assert.equal(comanda.estado, 'pendiente');
  assert.equal(comanda.impresa, false);
  assert.equal(comanda.subtotal, 94000);
  assert.equal(comanda.totalCuenta, 94000);
  assert.equal(comanda.creado, 'TS');
  assert.equal(comanda.creadoPorUid, ACTOR.uid);
  assert.equal(comanda.items.extras[0].precioUnitario, 17000);
  assert.equal(comanda.items.extras[0].precioTotal, 34000);
});

test('agrega productos dos veces a la misma cuenta sin crear otro pedido', async () => {
  const almacen = nuevoAlmacen();

  const uno = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-agregar-0001'
  });
  const dos = await ejecutar(almacen, {
    items: { extras: [COCA_X2] },
    operacionId: 'op-agregar-0002',
    pedidoIdEsperado: uno.pedidoId
  });

  assert.equal(dos.accion, 'ampliar');
  assert.equal(dos.pedidoId, uno.pedidoId);
  assert.equal(dos.cuentaId, uno.cuentaId);
  assert.equal(dos.total, 94000);
  assert.equal(dos.operaciones, 2);

  assert.equal(almacen.contar('pedidos'), 1);
  assert.equal(almacen.contar('comandas'), 2);

  const pedido = almacen.leer('pedidos', uno.pedidoId);
  assert.equal(pedido.pizzas.length, 1);
  assert.equal(pedido.total, 94000);
  assert.deepEqual(pedido.extras, [{ item: 'Coca Cola 1.5LT', cantidad: 2 }]);

  const cuenta = almacen.leer('cuentas_mesa', '5');
  assert.equal(cuenta.operaciones, 2);
  assert.equal(cuenta.total, 94000);
  assert.equal(cuenta.ultimaOperacionId, 'op-agregar-0002');

  const comanda2 = almacen.leer('comandas', 'op-agregar-0002');
  assert.deepEqual(comanda2.items.pizzas, []);
  assert.equal(comanda2.items.extras.length, 1);
  assert.equal(comanda2.subtotal, 34000);
  assert.equal(comanda2.totalCuenta, 94000);
});

test('reintentar la misma operación no duplica productos ni comandas', async () => {
  const almacen = nuevoAlmacen();

  const uno = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-idempotente-01'
  });

  // Aunque el menú cambie entre el primer envío y el reintento, el reintento
  // devuelve la comanda original sin volver a validar ni escribir.
  almacen.sembrar('config', 'menu', { ...MENU, sabores: { gourmet: [], especial: [], clasico: [] } });

  const dos = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-idempotente-01'
  });

  assert.equal(dos.accion, 'duplicada');
  assert.equal(dos.duplicada, true);
  assert.equal(dos.pedidoId, uno.pedidoId);
  assert.equal(dos.total, 60000);
  assert.equal(almacen.contar('comandas'), 1);
  assert.equal(almacen.leer('pedidos', uno.pedidoId).total, 60000);
  assert.equal(almacen.leer('cuentas_mesa', '5').operaciones, 1);
});

test('reutilizar un operacionId en otra mesa u otro camarero se rechaza', async () => {
  const almacen = nuevoAlmacen();
  await ejecutar(almacen, {
    mesa: 5,
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-reuso-0001'
  });

  await esperarError(
    () => ejecutar(almacen, {
      mesa: 9,
      items: { pizzas: [PIZZA_MUZZA] },
      operacionId: 'op-reuso-0001'
    }),
    CODIGOS_ERROR.OPERACION_ID_REUTILIZADO
  );

  await esperarError(
    () => ejecutar(almacen, {
      mesa: 5,
      items: { pizzas: [PIZZA_MUZZA] },
      actor: ACTOR2,
      operacionId: 'op-reuso-0001'
    }),
    CODIGOS_ERROR.OPERACION_ID_REUTILIZADO
  );
});

test('rechaza una mesa que no está en config/mesas', async () => {
  const almacen = nuevoAlmacen();
  await esperarError(
    () => ejecutar(almacen, {
      mesa: 7,
      items: { pizzas: [PIZZA_MUZZA] },
      operacionId: 'op-mesa-inexistente'
    }),
    CODIGOS_ERROR.MESA_NO_CONFIGURADA
  );
  assert.equal(almacen.contar('pedidos'), 0);
});

test('dos camareros simultáneos no crean dos cuentas para la misma mesa', async () => {
  const almacen = nuevoAlmacen();

  const [a, b] = await Promise.all([
    ejecutar(almacen, {
      items: { pizzas: [PIZZA_MUZZA] },
      actor: ACTOR,
      operacionId: 'op-simultanea-a'
    }),
    ejecutar(almacen, {
      items: { extras: [COCA_X2] },
      actor: ACTOR2,
      operacionId: 'op-simultanea-b'
    })
  ]);

  assert.equal(a.pedidoId, b.pedidoId, 'Ambos deben terminar en el mismo pedido');
  assert.equal(almacen.contar('pedidos'), 1);
  assert.equal(almacen.contar('cuentas_mesa'), 1);
  assert.equal(almacen.contar('comandas'), 2);

  const pedido = almacen.leer('pedidos', a.pedidoId);
  assert.equal(pedido.total, 94000);
  assert.equal(pedido.pizzas.length, 1);
  assert.deepEqual(pedido.extras, [{ item: 'Coca Cola 1.5LT', cantidad: 2 }]);

  const cuenta = almacen.leer('cuentas_mesa', '5');
  assert.equal(cuenta.operaciones, 2);
  assert.equal(cuenta.total, 94000);

  const acciones = [a.accion, b.accion].sort();
  assert.deepEqual(acciones, ['ampliar', 'crear']);
});

/* --------------------------------------------------------------------------
   3. Cuenta cerrada / cobrada / punteros inválidos
   -------------------------------------------------------------------------- */

test('una cuenta cobrada rechaza la ampliación estricta y permite abrir otra mesa', async () => {
  const almacen = nuevoAlmacen();
  const primera = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-cobrada-0001'
  });

  // Simula el cobro desde el TPV: pagado:true (el camarero nunca lo escribe).
  almacen.modificar('pedidos', primera.pedidoId, { pagado: true, estado: 'entregado' });

  await esperarError(
    () => ejecutar(almacen, {
      items: { extras: [COCA_X2] },
      operacionId: 'op-cobrada-0002',
      pedidoIdEsperado: primera.pedidoId
    }),
    CODIGOS_ERROR.CUENTA_CERRADA
  );

  // Sin pedidoIdEsperado, la mesa se considera libre y se abre una cuenta nueva.
  const segunda = await ejecutar(almacen, {
    items: { extras: [COCA_X2] },
    operacionId: 'op-cobrada-0003'
  });

  assert.equal(segunda.accion, 'crear');
  assert.notEqual(segunda.pedidoId, primera.pedidoId);
  assert.equal(almacen.contar('pedidos'), 2);
  assert.equal(almacen.contar('comandas'), 2);

  const viejo = almacen.leer('pedidos', primera.pedidoId);
  assert.equal(viejo.pagado, true);
  assert.equal(viejo.total, 60000);

  const puntero = almacen.leer('cuentas_mesa', '5');
  assert.equal(puntero.pedidoId, segunda.pedidoId);
  assert.equal(puntero.total, 34000);
  assert.equal(puntero.operaciones, 1);
});

test('una cuenta cancelada o archivada también se considera cerrada', async () => {
  for (const estado of ['cancelado', 'archivado']) {
    const almacen = nuevoAlmacen();
    const primera = await ejecutar(almacen, {
      items: { pizzas: [PIZZA_MUZZA] },
      operacionId: 'op-estado-' + estado
    });
    almacen.modificar('pedidos', primera.pedidoId, { estado });

    await esperarError(
      () => ejecutar(almacen, {
        items: { extras: [COCA_X2] },
        operacionId: 'op-estado-2-' + estado,
        pedidoIdEsperado: primera.pedidoId
      }),
      CODIGOS_ERROR.CUENTA_CERRADA
    );

    const nueva = await ejecutar(almacen, {
      items: { extras: [COCA_X2] },
      operacionId: 'op-estado-3-' + estado
    });
    assert.equal(nueva.accion, 'crear');
  }
});

test('rechaza punteros que apuntan a pedidos que no son locales o de otra mesa', async () => {
  // Pedido delivery apuntado por la cuenta de la mesa 5
  const almacen = nuevoAlmacen();
  almacen
    .sembrar('pedidos', 'pedido-delivery', {
      tipo: 'delivery', mesa: null, estado: 'nuevo', pagado: false, total: 1000, pizzas: [], extras: []
    })
    .sembrar('cuentas_mesa', '5', {
      mesa: 5, mesaId: '5', cuentaId: 'cuenta-x', pedidoId: 'pedido-delivery',
      estado: 'abierta', abiertaPorUid: ACTOR.uid, operaciones: 1, total: 1000
    });

  await esperarError(
    () => ejecutar(almacen, {
      items: { pizzas: [PIZZA_MUZZA] },
      operacionId: 'op-puntero-0001'
    }),
    CODIGOS_ERROR.CUENTA_INVALIDA
  );

  // Pedido local pero de la mesa 9 apuntado por la mesa 5
  const almacen2 = nuevoAlmacen();
  almacen2
    .sembrar('pedidos', 'pedido-mesa-9', {
      tipo: 'local', mesa: 9, estado: 'nuevo', pagado: false, total: 1000, pizzas: [], extras: []
    })
    .sembrar('cuentas_mesa', '5', {
      mesa: 5, mesaId: '5', cuentaId: 'cuenta-y', pedidoId: 'pedido-mesa-9',
      estado: 'abierta', abiertaPorUid: ACTOR.uid, operaciones: 1, total: 1000
    });

  await esperarError(
    () => ejecutar(almacen2, {
      items: { pizzas: [PIZZA_MUZZA] },
      operacionId: 'op-puntero-0002'
    }),
    CODIGOS_ERROR.CUENTA_INVALIDA
  );
});

test('estadoCuenta distingue libre, ocupada, pendiente de cobro y cerrada', () => {
  assert.equal(estadoCuenta(null, null), 'libre');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'abierta' }, { estado: 'nuevo', pagado: false }), 'ocupada');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'abierta' }, { estado: 'preparacion', pagado: false }), 'ocupada');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'pendiente_cobro' }, { estado: 'entregado', pagado: false }), 'pendiente_cobro');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'abierta' }, { estado: 'entregado', pagado: true }), 'cerrada');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'abierta' }, { estado: 'cancelado', pagado: false }), 'cerrada');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'abierta' }, { estado: 'archivado', pagado: false }), 'cerrada');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'cerrada' }, { estado: 'nuevo', pagado: false }), 'cerrada');
  assert.equal(estadoCuenta({ pedidoId: 'p1', estado: 'abierta' }, null), 'libre');
});

/* --------------------------------------------------------------------------
   4. Seguridad: el camarero no puede cobrar ni tocar precios
   -------------------------------------------------------------------------- */

test('las escrituras del camarero no incluyen cobro, descuento ni numeración', () => {
  const opId = 'op-escrituras-01';

  const crear = prepararOperacion({
    mesa: 5,
    payload: { pizzas: [PIZZA_MUZZA] },
    mesaDoc: MESAS,
    menuDoc: MENU,
    cuenta: null,
    pedido: null,
    operacionExistente: null,
    actor: ACTOR,
    operacionId: opId,
    cuentaId: 'cuenta-nueva',
    pedidoId: 'pedido-nuevo',
    marcaTiempo: () => 'TS'
  });

  assert.deepEqual(
    Object.keys(crear.pedido.crear).sort(),
    [
      'actualizadoEn', 'actualizadoPor', 'cliente', 'creado', 'cuentaId', 'estado',
      'extras', 'local', 'mensaje', 'mesa', 'origen', 'pagado', 'pizzas',
      'tipo', 'total', 'ultimaOperacionId'
    ].sort()
  );
  assert.equal(crear.pedido.crear.pagado, false);
  assert.equal('pago' in crear.pedido.crear, false);
  assert.equal('descuento' in crear.pedido.crear, false);
  assert.equal('numero' in crear.pedido.crear, false);

  const ampliar = prepararOperacion({
    mesa: 5,
    payload: { extras: [COCA_X2] },
    mesaDoc: MESAS,
    menuDoc: MENU,
    cuenta: {
      mesa: 5, mesaId: '5', cuentaId: 'cuenta-nueva', pedidoId: 'pedido-nuevo',
      estado: 'abierta', abiertaPorUid: ACTOR.uid, abiertaPorEn: 'TS',
      operaciones: 1, total: 60000
    },
    pedido: {
      tipo: 'local', mesa: 5, estado: 'nuevo', pagado: false, total: 60000,
      pizzas: [{ tamano: 'grande', nombre: 'Pizza Grande', sabores: ['Muzza'], borde: false, precio: 60000 }],
      extras: []
    },
    operacionExistente: null,
    actor: ACTOR,
    operacionId: 'op-escrituras-02',
    pedidoIdEsperado: 'pedido-nuevo',
    marcaTiempo: () => 'TS'
  });

  assert.deepEqual(
    Object.keys(ampliar.pedido.actualizar).sort(),
    ['actualizadoEn', 'actualizadoPor', 'extras', 'pizzas', 'total', 'ultimaOperacionId'].sort()
  );
  for (const prohibido of ['pagado', 'pago', 'descuento', 'numero', 'estado', 'mesa', 'tipo', 'cliente']) {
    assert.equal(prohibido in ampliar.pedido.actualizar, false, 'No debe escribir ' + prohibido);
  }
  assert.equal(ampliar.cuenta.actualizar.estado, 'abierta');
});

test('la operación solo escribe en pedidos, cuentas_mesa y comandas', async () => {
  const almacen = nuevoAlmacen();
  almacen
    .sembrar('pedidos', 'delivery-1', {
      tipo: 'delivery', estado: 'nuevo', pagado: false, total: 50000, pizzas: [], extras: []
    })
    .sembrar('pedidos', 'retiro-1', {
      tipo: 'retiro', estado: 'nuevo', pagado: false, total: 30000, pizzas: [], extras: []
    });

  const deliveryAntes = almacen.leer('pedidos', 'delivery-1');
  const retiroAntes = almacen.leer('pedidos', 'retiro-1');

  await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-colecciones-01'
  });

  for (const clave of almacen.claves()) {
    const permitida = clave === 'config/mesas' ||
      clave === 'config/menu' ||
      clave.startsWith('pedidos/') ||
      clave.startsWith('cuentas_mesa/') ||
      clave.startsWith('comandas/');
    assert.ok(permitida, 'Colección inesperada: ' + clave);
  }

  assert.deepEqual(almacen.leer('pedidos', 'delivery-1'), deliveryAntes);
  assert.deepEqual(almacen.leer('pedidos', 'retiro-1'), retiroAntes);
});

test('valida el identificador de operación y el actor', async () => {
  await esperarError(() => Promise.resolve(validarOperacionId('../pedidos/x')), CODIGOS_ERROR.OPERACION_ID_INVALIDO);
  await esperarError(() => Promise.resolve(validarOperacionId('corto')), CODIGOS_ERROR.OPERACION_ID_INVALIDO);

  const almacen = nuevoAlmacen();
  await esperarError(
    () => ejecutar(almacen, {
      items: { pizzas: [PIZZA_MUZZA] },
      actor: { uid: '', email: '', nombre: '' },
      operacionId: 'op-actor-invalido'
    }),
    CODIGOS_ERROR.ACTOR_INVALIDO
  );
});

test('generarOperacionId produce ids válidos y distintos', () => {
  const a = generarOperacionId();
  const b = generarOperacionId();
  assert.notEqual(a, b);
  assert.equal(validarOperacionId(a), a);
  assert.equal(validarOperacionId(b), b);
});

/* --------------------------------------------------------------------------
   5. Límites acumulados de la cuenta
   -------------------------------------------------------------------------- */

test('rechaza ampliaciones que superan el máximo de pizzas de la cuenta', async () => {
  const almacen = nuevoAlmacen();
  const pizza = { tamano: 'grande', sabores: ['Muzza'] };

  const primera = await ejecutar(almacen, {
    items: { pizzas: Array.from({ length: 20 }, () => pizza) },
    operacionId: 'op-limite-0001'
  });

  await esperarError(
    () => ejecutar(almacen, {
      items: { pizzas: Array.from({ length: 11 }, () => pizza) },
      operacionId: 'op-limite-0002',
      pedidoIdEsperado: primera.pedidoId
    }),
    CODIGOS_ERROR.LIMITE_EXCEDIDO
  );
});

test('mezcla extras existentes por nombre y acumula cantidades', async () => {
  const almacen = nuevoAlmacen();
  const uno = await ejecutar(almacen, {
    items: { extras: [{ id: 'coca-15l', cantidad: 1 }] },
    operacionId: 'op-extras-0001'
  });

  await ejecutar(almacen, {
    items: { extras: [{ id: 'coca-15l', cantidad: 2 }, { id: 'papas-med', cantidad: 1 }] },
    operacionId: 'op-extras-0002',
    pedidoIdEsperado: uno.pedidoId
  });

  const pedido = almacen.leer('pedidos', uno.pedidoId);
  assert.deepEqual(pedido.extras, [
    { item: 'Coca Cola 1.5LT', cantidad: 3 },
    { item: 'Papas Medianas', cantidad: 1 }
  ]);
  assert.equal(pedido.total, 3 * 17000 + 15000);
});

test('la comanda guarda solo los productos nuevos de cada envío', async () => {
  const almacen = nuevoAlmacen();
  const uno = await ejecutar(almacen, {
    items: { pizzas: [PIZZA_MUZZA] },
    operacionId: 'op-comanda-0001'
  });
  await ejecutar(almacen, {
    items: { extras: [COCA_X2] },
    operacionId: 'op-comanda-0002',
    pedidoIdEsperado: uno.pedidoId
  });

  const comanda1 = almacen.leer('comandas', 'op-comanda-0001');
  const comanda2 = almacen.leer('comandas', 'op-comanda-0002');

  assert.equal(comanda1.items.pizzas.length, 1);
  assert.equal(comanda1.items.extras.length, 0);
  assert.equal(comanda2.items.pizzas.length, 0);
  assert.equal(comanda2.items.extras.length, 1);
  assert.equal(comanda1.pedidoId, comanda2.pedidoId);
});
