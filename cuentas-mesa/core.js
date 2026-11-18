/* ==========================================================================
   MI BARRIO — Cuentas por mesa · núcleo (Etapa 1)
   --------------------------------------------------------------------------
   Lógica pura, sin Firebase ni DOM. La usan:
     - el adaptador de Firestore (cuentas-mesa/firebase.js)
     - las pruebas con un almacén transaccional en memoria
     - en el futuro, la App Camarero y el TPV (Etapa 2/3)

   Reglas de diseño:
     - El cliente NUNCA decide precios ni totales: se recalculan desde
       config/menu dentro de la operación.
     - El cliente NUNCA decide estado de cobro: los pedidos de camarero
       nacen con pagado:false y las ampliaciones no tocan pagado/pago.
     - Una sola cuenta activa por mesa: el documento cuentas_mesa/{mesa}
       es el candado y toda alta/ampliación pasa por una transacción.
     - Cada envío a cocina es un documento propio en comandas/{operacionId},
       con un id de operación generado por el cliente para evitar duplicados.
   ========================================================================== */

export const CODIGOS_ERROR = Object.freeze({
  MESA_INVALIDA: 'MESA_INVALIDA',
  MESA_NO_CONFIGURADA: 'MESA_NO_CONFIGURADA',
  ACTOR_INVALIDO: 'ACTOR_INVALIDO',
  OPERACION_ID_INVALIDO: 'OPERACION_ID_INVALIDO',
  OPERACION_ID_REUTILIZADO: 'OPERACION_ID_REUTILIZADO',
  MENU_NO_DISPONIBLE: 'MENU_NO_DISPONIBLE',
  MENU_INCOMPLETO: 'MENU_INCOMPLETO',
  PAYLOAD_INVALIDO: 'PAYLOAD_INVALIDO',
  CAMPO_NO_PERMITIDO: 'CAMPO_NO_PERMITIDO',
  PIZZA_INVALIDA: 'PIZZA_INVALIDA',
  TAMANO_INVALIDO: 'TAMANO_INVALIDO',
  SABOR_INVALIDO: 'SABOR_INVALIDO',
  SABOR_DUPLICADO: 'SABOR_DUPLICADO',
  SABORES_LIMITE: 'SABORES_LIMITE',
  EXTRA_INVALIDO: 'EXTRA_INVALIDO',
  EXTRA_DUPLICADO: 'EXTRA_DUPLICADO',
  CANTIDAD_INVALIDA: 'CANTIDAD_INVALIDA',
  PRECIO_MANIPULADO: 'PRECIO_MANIPULADO',
  CUENTA_CERRADA: 'CUENTA_CERRADA',
  CUENTA_CAMBIADA: 'CUENTA_CAMBIADA',
  CUENTA_INVALIDA: 'CUENTA_INVALIDA',
  LIMITE_EXCEDIDO: 'LIMITE_EXCEDIDO',
  SIN_PRODUCTOS: 'SIN_PRODUCTOS'
});

export const LIMITES = Object.freeze({
  PIZZAS_POR_PEDIDO: 30,
  EXTRAS_POR_PEDIDO: 10,
  TOTAL_MAXIMO: 5000000,
  CANTIDAD_MAXIMA_EXTRA: 99,
  MESA_MAXIMA: 9999,
  OPERACION_ID_MIN: 8,
  OPERACION_ID_MAX: 128
});

export class ErrorCuenta extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorCuenta';
    this.codigo = codigo;
  }
}

function error(codigo, mensaje) {
  return new ErrorCuenta(codigo, mensaje);
}

function esObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function numeroSeguro(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* --------------------------------------------------------------------------
   Identificadores y mesas
   -------------------------------------------------------------------------- */

export function normalizarMesa(valor) {
  const n = typeof valor === 'number' ? valor : Number(String(valor ?? '').trim());
  if (!Number.isInteger(n) || n < 1 || n > LIMITES.MESA_MAXIMA) {
    throw error(CODIGOS_ERROR.MESA_INVALIDA, 'Número de mesa inválido.');
  }
  return n;
}

export function validarOperacionId(valor) {
  const id = String(valor ?? '').trim();
  if (id.length < LIMITES.OPERACION_ID_MIN || id.length > LIMITES.OPERACION_ID_MAX || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw error(
      CODIGOS_ERROR.OPERACION_ID_INVALIDO,
      'El identificador de operación no es válido. Generá uno nuevo antes de reintentar.'
    );
  }
  return id;
}

export function generarOperacionId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return 'op-' + Date.now().toString(36) + '-' + rnd() + rnd();
}

export function leerMesas(mesasDoc) {
  const lista = esObjeto(mesasDoc) && Array.isArray(mesasDoc.mesas) ? mesasDoc.mesas : [];
  const limpias = lista
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n > 0 && n <= LIMITES.MESA_MAXIMA);
  return [...new Set(limpias)];
}

function validarActor(actor) {
  if (!esObjeto(actor) || typeof actor.uid !== 'string' || !actor.uid.trim()) {
    throw error(CODIGOS_ERROR.ACTOR_INVALIDO, 'Falta identificar al camarero que realiza la operación.');
  }
  return {
    uid: actor.uid.trim(),
    email: String(actor.email || '').trim(),
    nombre: String(actor.nombre || '').trim()
  };
}

/* --------------------------------------------------------------------------
   Menú y precios (misma lógica que panel_nuevo.html: nuevoCat / nuevoPrecio)
   -------------------------------------------------------------------------- */

export function leerMenu(menuDoc) {
  if (!esObjeto(menuDoc)) {
    throw error(CODIGOS_ERROR.MENU_NO_DISPONIBLE, 'El menú no está disponible en este momento.');
  }
  if (!esObjeto(menuDoc.tamanos) || !Object.keys(menuDoc.tamanos).length) {
    throw error(CODIGOS_ERROR.MENU_INCOMPLETO, 'El menú no tiene tamaños configurados.');
  }
  return {
    tamanos: menuDoc.tamanos,
    sabores: esObjeto(menuDoc.sabores) ? menuDoc.sabores : {},
    extras: Array.isArray(menuDoc.extras) ? menuDoc.extras : []
  };
}

function saborExiste(menu, sabor) {
  return ['gourmet', 'especial', 'clasico'].some(cat => {
    const lista = menu.sabores[cat];
    return Array.isArray(lista) && lista.includes(sabor);
  });
}

export function categoriaPizza(menuCrudo, sabores) {
  const menu = esObjeto(menuCrudo) && esObjeto(menuCrudo.tamanos) ? menuCrudo : leerMenu(menuCrudo);
  const lista = Array.isArray(sabores) ? sabores : [];
  if (lista.some(s => Array.isArray(menu.sabores.gourmet) && menu.sabores.gourmet.includes(s))) return 'gourmet';
  if (lista.some(s => Array.isArray(menu.sabores.especial) && menu.sabores.especial.includes(s))) return 'especial';
  return 'clasico';
}

export function precioPizza(menuCrudo, tamano, sabores, borde) {
  const menu = esObjeto(menuCrudo) && esObjeto(menuCrudo.tamanos) ? menuCrudo : leerMenu(menuCrudo);
  const t = menu.tamanos[tamano];
  if (!esObjeto(t)) {
    throw error(CODIGOS_ERROR.TAMANO_INVALIDO, 'El tamaño de pizza no existe en el menú.');
  }
  const categoria = categoriaPizza(menu, sabores);
  const base = Number(t.precios && t.precios[categoria]);
  if (!Number.isFinite(base) || base < 0) {
    throw error(CODIGOS_ERROR.MENU_INCOMPLETO, 'El menú no tiene precio para ' + tamano + ' / ' + categoria + '.');
  }
  return base + (borde ? Math.max(0, Number(t.borde) || 0) : 0);
}

/* --------------------------------------------------------------------------
   Validación y normalización de lo que envía el camarero
   -------------------------------------------------------------------------- */

function normalizarPizzas(menu, pizzas) {
  if (pizzas === undefined || pizzas === null) return [];
  if (!Array.isArray(pizzas)) {
    throw error(CODIGOS_ERROR.PAYLOAD_INVALIDO, 'La lista de pizzas no es válida.');
  }
  if (pizzas.length > LIMITES.PIZZAS_POR_PEDIDO) {
    throw error(CODIGOS_ERROR.LIMITE_EXCEDIDO, 'El pedido supera el máximo de pizzas permitido.');
  }

  return pizzas.map((p, indice) => {
    if (!esObjeto(p)) {
      throw error(CODIGOS_ERROR.PIZZA_INVALIDA, 'La pizza ' + (indice + 1) + ' no es válida.');
    }
    for (const clave of Object.keys(p)) {
      if (!['tamano', 'sabores', 'borde', 'precio'].includes(clave)) {
        throw error(
          CODIGOS_ERROR.CAMPO_NO_PERMITIDO,
          'El campo "' + clave + '" no está permitido en una pizza. Los precios los calcula el sistema.'
        );
      }
    }

    const tamano = String(p.tamano ?? '').trim();
    const t = menu.tamanos[tamano];
    if (!esObjeto(t)) {
      throw error(CODIGOS_ERROR.TAMANO_INVALIDO, 'El tamaño "' + tamano + '" no existe en el menú.');
    }

    if (!Array.isArray(p.sabores) || !p.sabores.length) {
      throw error(CODIGOS_ERROR.PIZZA_INVALIDA, 'La pizza ' + (indice + 1) + ' no tiene sabores.');
    }

    const limite = Math.max(1, Number(t.limite) || 1);
    if (p.sabores.length > limite) {
      throw error(
        CODIGOS_ERROR.SABORES_LIMITE,
        'El tamaño ' + (t.corto || tamano) + ' admite hasta ' + limite + ' sabores.'
      );
    }

    const vistos = new Set();
    const sabores = p.sabores.map(s => String(s ?? '').trim());
    for (const sabor of sabores) {
      if (!sabor) {
        throw error(CODIGOS_ERROR.SABOR_INVALIDO, 'Hay un sabor vacío en la pizza ' + (indice + 1) + '.');
      }
      if (vistos.has(sabor)) {
        throw error(CODIGOS_ERROR.SABOR_DUPLICADO, 'El sabor "' + sabor + '" está repetido en la misma pizza.');
      }
      vistos.add(sabor);
      if (!saborExiste(menu, sabor)) {
        throw error(CODIGOS_ERROR.SABOR_INVALIDO, 'El sabor "' + sabor + '" no existe en el menú.');
      }
    }

    if (p.borde !== undefined && p.borde !== null && typeof p.borde !== 'boolean') {
      throw error(CODIGOS_ERROR.PIZZA_INVALIDA, 'El campo borde debe ser verdadero o falso.');
    }
    const borde = p.borde === true;
    const precio = precioPizza(menu, tamano, sabores, borde);

    if (p.precio !== undefined && p.precio !== null) {
      const declarado = Number(p.precio);
      if (!Number.isFinite(declarado) || declarado !== precio) {
        throw error(
          CODIGOS_ERROR.PRECIO_MANIPULADO,
          'El precio enviado para la pizza ' + (indice + 1) + ' no coincide con el menú.'
        );
      }
    }

    return {
      tamano,
      nombre: String(t.nombre || tamano),
      sabores,
      borde,
      precio
    };
  });
}

function normalizarExtras(menu, extras) {
  if (extras === undefined || extras === null) return [];
  if (!Array.isArray(extras)) {
    throw error(CODIGOS_ERROR.PAYLOAD_INVALIDO, 'La lista de extras no es válida.');
  }
  if (extras.length > LIMITES.EXTRAS_POR_PEDIDO) {
    throw error(CODIGOS_ERROR.LIMITE_EXCEDIDO, 'El pedido supera el máximo de extras permitido.');
  }

  const vistos = new Set();
  return extras.map((x, indice) => {
    if (!esObjeto(x)) {
      throw error(CODIGOS_ERROR.EXTRA_INVALIDO, 'El extra ' + (indice + 1) + ' no es válido.');
    }
    for (const clave of Object.keys(x)) {
      if (!['id', 'cantidad', 'precio'].includes(clave)) {
        throw error(
          CODIGOS_ERROR.CAMPO_NO_PERMITIDO,
          'El campo "' + clave + '" no está permitido en un extra. Los precios los calcula el sistema.'
        );
      }
    }

    const id = String(x.id ?? '').trim();
    const item = menu.extras.find(e => esObjeto(e) && String(e.id) === id);
    if (!item) {
      throw error(CODIGOS_ERROR.EXTRA_INVALIDO, 'El extra "' + id + '" no existe en el menú.');
    }
    if (vistos.has(id)) {
      throw error(CODIGOS_ERROR.EXTRA_DUPLICADO, 'El extra "' + id + '" está repetido. Sumá la cantidad en una sola línea.');
    }
    vistos.add(id);

    const cantidad = Number(x.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > LIMITES.CANTIDAD_MAXIMA_EXTRA) {
      throw error(CODIGOS_ERROR.CANTIDAD_INVALIDA, 'La cantidad del extra "' + id + '" no es válida.');
    }

    const precioUnitario = Number(item.precio);
    if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
      throw error(CODIGOS_ERROR.MENU_INCOMPLETO, 'El extra "' + id + '" no tiene precio configurado.');
    }

    if (x.precio !== undefined && x.precio !== null) {
      const declarado = Number(x.precio);
      if (!Number.isFinite(declarado) || declarado !== precioUnitario) {
        throw error(
          CODIGOS_ERROR.PRECIO_MANIPULADO,
          'El precio enviado para el extra "' + id + '" no coincide con el menú.'
        );
      }
    }

    return {
      id,
      item: String(item.nombre || id),
      cantidad,
      precioUnitario,
      precioTotal: precioUnitario * cantidad
    };
  });
}

/**
 * Devuelve pizzas/extras normalizados con precios recalculados desde config/menu.
 * Cualquier campo extra en el payload (total, pagado, pago, descuento, numero...)
 * se rechaza: el cliente no puede fijar precios ni estado de cobro.
 */
export function normalizarItems(menuDoc, payload) {
  if (!esObjeto(payload)) {
    throw error(CODIGOS_ERROR.PAYLOAD_INVALIDO, 'La operación no tiene productos válidos.');
  }
  for (const clave of Object.keys(payload)) {
    if (!['pizzas', 'extras'].includes(clave)) {
      throw error(
        CODIGOS_ERROR.CAMPO_NO_PERMITIDO,
        'El campo "' + clave + '" no está permitido. Los totales, precios y estados los calcula el sistema.'
      );
    }
  }

  const menu = leerMenu(menuDoc);
  const pizzas = normalizarPizzas(menu, payload.pizzas);
  const extras = normalizarExtras(menu, payload.extras);

  if (!pizzas.length && !extras.length) {
    throw error(CODIGOS_ERROR.SIN_PRODUCTOS, 'Agregá al menos una pizza o un extra.');
  }

  const subtotal = pizzas.reduce((a, p) => a + p.precio, 0) +
    extras.reduce((a, x) => a + x.precioTotal, 0);

  if (!Number.isFinite(subtotal) || subtotal < 0 || subtotal >= LIMITES.TOTAL_MAXIMO) {
    throw error(CODIGOS_ERROR.LIMITE_EXCEDIDO, 'El importe de la operación no es válido.');
  }

  return { pizzas, extras, subtotal };
}

/* --------------------------------------------------------------------------
   Estado de la cuenta
   -------------------------------------------------------------------------- */

/**
 * Estado visible de la mesa. Se deriva del puntero y del pedido:
 *   libre            -> no hay cuenta activa
 *   ocupada          -> pedido local abierto, todavía no servido
 *   pendiente_cobro  -> pedido servido (entregado) y sin cobrar
 *   cerrada          -> pedido cobrado/cancelado/archivado o cuenta cerrada
 */
export function estadoCuenta(cuenta, pedido) {
  if (!esObjeto(cuenta) || !cuenta.pedidoId) return 'libre';
  if (cuenta.estado === 'cerrada') return 'cerrada';
  if (!esObjeto(pedido)) return 'libre';
  if (pedido.pagado === true) return 'cerrada';
  if (pedido.estado === 'cancelado' || pedido.estado === 'archivado') return 'cerrada';
  if (pedido.estado === 'entregado') return 'pendiente_cobro';
  return 'ocupada';
}

function fusionarExtras(existentes, nuevos) {
  const salida = (Array.isArray(existentes) ? existentes : []).map(x => ({
    item: String(x && x.item !== undefined ? x.item : ''),
    cantidad: Math.max(0, Number(x && x.cantidad) || 0)
  })).filter(x => x.item && x.cantidad > 0);

  for (const x of nuevos) {
    const encontrado = salida.find(y => y.item === x.item);
    if (encontrado) encontrado.cantidad += x.cantidad;
    else salida.push({ item: x.item, cantidad: x.cantidad });
  }
  return salida;
}

/* --------------------------------------------------------------------------
   Planificación pura de una operación
   -------------------------------------------------------------------------- */

/**
 * Calcula todas las escrituras de una operación sin tocar Firestore.
 *
 * @param {object} opciones
 * @param {number|string} opciones.mesa
 * @param {object} opciones.payload        { pizzas, extras } sin precios
 * @param {object|null} opciones.mesaDoc   config/mesas
 * @param {object|null} opciones.menuDoc   config/menu
 * @param {object|null} opciones.cuenta    cuentas_mesa/{mesa}
 * @param {object|null} opciones.pedido    pedidos/{pedidoId}
 * @param {object|null} opciones.operacionExistente  comandas/{operacionId}
 * @param {object} opciones.actor          { uid, email, nombre }
 * @param {string} opciones.operacionId
 * @param {string} [opciones.pedidoIdEsperado]  si el camarero cree estar ampliando
 * @param {string} [opciones.cuentaId]     id a usar si hay que crear cuenta
 * @param {string} [opciones.pedidoId]     id a usar si hay que crear pedido
 * @param {Function} [opciones.marcaTiempo]
 */
export function prepararOperacion({
  mesa,
  payload,
  mesaDoc,
  menuDoc,
  cuenta,
  pedido,
  operacionExistente,
  actor,
  operacionId,
  pedidoIdEsperado = null,
  cuentaId = null,
  pedidoId = null,
  marcaTiempo = () => null
}) {
  const mesaN = normalizarMesa(mesa);
  const actorN = validarActor(actor);
  const opId = validarOperacionId(operacionId);

  if (!leerMesas(mesaDoc).includes(mesaN)) {
    throw error(
      CODIGOS_ERROR.MESA_NO_CONFIGURADA,
      'La mesa ' + mesaN + ' no está configurada en el TPV. Agregala en Configuración → Mesas.'
    );
  }

  // Reintento de la misma operación: no se vuelve a escribir nada.
  if (operacionExistente) {
    if (Number(operacionExistente.mesa) !== mesaN || String(operacionExistente.creadoPorUid) !== actorN.uid) {
      throw error(
        CODIGOS_ERROR.OPERACION_ID_REUTILIZADO,
        'Ese identificador de operación ya fue usado para otra mesa o por otro usuario.'
      );
    }
    return {
      accion: 'duplicada',
      mesa: mesaN,
      cuentaId: operacionExistente.cuentaId,
      pedidoId: operacionExistente.pedidoId,
      comanda: operacionExistente
    };
  }

  const esperado = pedidoIdEsperado === undefined || pedidoIdEsperado === null
    ? null
    : String(pedidoIdEsperado).trim();
  if (esperado !== null && (!esperado || esperado.length > 128 || !/^[A-Za-z0-9_-]+$/.test(esperado))) {
    throw error(CODIGOS_ERROR.PAYLOAD_INVALIDO, 'El identificador del pedido esperado no es válido.');
  }

  const items = normalizarItems(menuDoc, payload);

  const hayPuntero = esObjeto(cuenta) && Boolean(cuenta.pedidoId);
  if (hayPuntero && esObjeto(pedido)) {
    if (pedido.tipo && pedido.tipo !== 'local') {
      throw error(CODIGOS_ERROR.CUENTA_INVALIDA, 'La cuenta de esta mesa apunta a un pedido que no es local.');
    }
    if (pedido.mesa !== undefined && pedido.mesa !== null && Number(pedido.mesa) !== mesaN) {
      throw error(CODIGOS_ERROR.CUENTA_INVALIDA, 'La cuenta de esta mesa apunta a un pedido de otra mesa.');
    }
  }

  const pedidoActivo = hayPuntero && esObjeto(pedido) &&
    pedido.pagado !== true &&
    pedido.estado !== 'cancelado' &&
    pedido.estado !== 'archivado';

  if (esperado !== null) {
    if (!hayPuntero) {
      throw error(CODIGOS_ERROR.CUENTA_CERRADA, 'La cuenta ya no está abierta. Volvé a abrir la mesa.');
    }
    if (String(cuenta.pedidoId) !== esperado) {
      throw error(CODIGOS_ERROR.CUENTA_CAMBIADA, 'La mesa cambió de cuenta. Actualizá la pantalla y volvé a intentar.');
    }
    if (!pedidoActivo) {
      throw error(CODIGOS_ERROR.CUENTA_CERRADA, 'La cuenta ya fue cobrada o cerrada. No se pueden agregar productos.');
    }
  }

  if (pedidoActivo) {
    const cuentaIdFinal = String(cuenta.cuentaId || '').trim();
    const pedidoIdFinal = String(cuenta.pedidoId || '').trim();
    if (!cuentaIdFinal || !pedidoIdFinal) {
      throw error(CODIGOS_ERROR.CUENTA_INVALIDA, 'La cuenta de la mesa está incompleta.');
    }

    const pizzasPrevias = Array.isArray(pedido.pizzas) ? pedido.pizzas : [];
    const pizzas = [...pizzasPrevias, ...items.pizzas];
    const extras = fusionarExtras(pedido.extras, items.extras);

    if (pizzas.length > LIMITES.PIZZAS_POR_PEDIDO) {
      throw error(CODIGOS_ERROR.LIMITE_EXCEDIDO, 'La cuenta supera el máximo de pizzas permitido.');
    }
    if (extras.length > LIMITES.EXTRAS_POR_PEDIDO) {
      throw error(CODIGOS_ERROR.LIMITE_EXCEDIDO, 'La cuenta supera el máximo de extras permitido.');
    }

    const totalPrevio = numeroSeguro(pedido.total);
    const total = totalPrevio + items.subtotal;
    if (total >= LIMITES.TOTAL_MAXIMO) {
      throw error(CODIGOS_ERROR.LIMITE_EXCEDIDO, 'La cuenta supera el importe máximo permitido.');
    }

    const operaciones = Math.max(0, Number(cuenta.operaciones) || 0) + 1;

    return {
      accion: 'ampliar',
      mesa: mesaN,
      cuentaId: cuentaIdFinal,
      pedidoId: pedidoIdFinal,
      pedido: {
        actualizar: {
          pizzas,
          extras,
          total,
          actualizadoPor: actorN.uid,
          actualizadoEn: marcaTiempo(),
          ultimaOperacionId: opId
        }
      },
      cuenta: {
        actualizar: {
          cuentaId: cuentaIdFinal,
          pedidoId: pedidoIdFinal,
          estado: pedido.estado === 'entregado' ? 'pendiente_cobro' : 'abierta',
          actualizadaEn: marcaTiempo(),
          actualizadaPorUid: actorN.uid,
          operaciones,
          total,
          ultimaOperacionId: opId
        }
      },
      comanda: {
        operacionId: opId,
        cuentaId: cuentaIdFinal,
        pedidoId: pedidoIdFinal,
        mesa: mesaN,
        origen: 'camarero',
        estado: 'pendiente',
        impresa: false,
        items: { pizzas: items.pizzas, extras: items.extras },
        subtotal: items.subtotal,
        totalCuenta: total,
        creado: marcaTiempo(),
        creadoPorUid: actorN.uid,
        creadoPorEmail: actorN.email,
        creadoPorNombre: actorN.nombre
      }
    };
  }

  // Mesa libre, cuenta cerrada o puntero huérfano: se abre una cuenta nueva.
  const cuentaIdFinal = String(cuentaId || '').trim();
  const pedidoIdFinal = String(pedidoId || '').trim();
  if (!cuentaIdFinal || !pedidoIdFinal) {
    throw error(CODIGOS_ERROR.PAYLOAD_INVALIDO, 'Faltan los identificadores para abrir la cuenta.');
  }

  const total = items.subtotal;
  const comanda = {
    operacionId: opId,
    cuentaId: cuentaIdFinal,
    pedidoId: pedidoIdFinal,
    mesa: mesaN,
    origen: 'camarero',
    estado: 'pendiente',
    impresa: false,
    items: { pizzas: items.pizzas, extras: items.extras },
    subtotal: items.subtotal,
    totalCuenta: total,
    creado: marcaTiempo(),
    creadoPorUid: actorN.uid,
    creadoPorEmail: actorN.email,
    creadoPorNombre: actorN.nombre
  };

  return {
    accion: 'crear',
    mesa: mesaN,
    cuentaId: cuentaIdFinal,
    pedidoId: pedidoIdFinal,
    pedido: {
      crear: {
        local: 'mi-barrio',
        estado: 'nuevo',
        creado: marcaTiempo(),
        tipo: 'local',
        mesa: mesaN,
        origen: 'camarero',
        pagado: false,
        cliente: { nombre: 'Mesa ' + mesaN },
        pizzas: items.pizzas,
        extras: items.extras.map(x => ({ item: x.item, cantidad: x.cantidad })),
        total,
        mensaje: '',
        cuentaId: cuentaIdFinal,
        actualizadoPor: actorN.uid,
        actualizadoEn: marcaTiempo(),
        ultimaOperacionId: opId
      }
    },
    cuenta: {
      crear: {
        mesa: mesaN,
        mesaId: String(mesaN),
        cuentaId: cuentaIdFinal,
        pedidoId: pedidoIdFinal,
        estado: 'abierta',
        abiertaEn: marcaTiempo(),
        abiertaPorUid: actorN.uid,
        abiertaPorEmail: actorN.email,
        actualizadaEn: marcaTiempo(),
        actualizadaPorUid: actorN.uid,
        operaciones: 1,
        total,
        ultimaOperacionId: opId
      }
    },
    comanda
  };
}

/**
 * Orquestación transaccional, independiente de Firestore.
 *
 * `tx` debe exponer:
 *   leer(coleccion, id)              -> Promise<{ existe, datos }>
 *   nuevoId(coleccion)               -> string
 *   guardar(coleccion, id, datos)    -> void  (set: reemplaza el documento)
 *   actualizar(coleccion, id, datos) -> void  (set merge: mezcla campos)
 *
 * Las lecturas se hacen todas antes de las escrituras, como exige
 * runTransaction de Firestore.
 */
export async function ejecutarOperacionCuenta(tx, {
  mesa,
  payload,
  actor,
  operacionId,
  pedidoIdEsperado = null,
  marcaTiempo = () => null
}) {
  const mesaN = normalizarMesa(mesa);
  const opId = validarOperacionId(operacionId);
  validarActor(actor);

  const mesasDoc = await tx.leer('config', 'mesas');
  const menuDoc = await tx.leer('config', 'menu');
  const cuentaDoc = await tx.leer('cuentas_mesa', String(mesaN));
  const comandaDoc = await tx.leer('comandas', opId);

  const cuenta = cuentaDoc && cuentaDoc.existe ? cuentaDoc.datos : null;
  const pedidoId = cuenta && cuenta.pedidoId ? String(cuenta.pedidoId) : null;
  let pedido = null;
  if (pedidoId) {
    const pedidoDoc = await tx.leer('pedidos', pedidoId);
    pedido = pedidoDoc && pedidoDoc.existe ? pedidoDoc.datos : null;
  }

  const cuentaIdNueva = tx.nuevoId('cuentas_mesa');
  const pedidoIdNuevo = tx.nuevoId('pedidos');

  const plan = prepararOperacion({
    mesa: mesaN,
    payload,
    mesaDoc: mesasDoc && mesasDoc.existe ? mesasDoc.datos : null,
    menuDoc: menuDoc && menuDoc.existe ? menuDoc.datos : null,
    cuenta,
    pedido,
    operacionExistente: comandaDoc && comandaDoc.existe ? comandaDoc.datos : null,
    actor,
    operacionId: opId,
    pedidoIdEsperado,
    cuentaId: cuentaIdNueva,
    pedidoId: pedidoIdNuevo,
    marcaTiempo
  });

  if (plan.accion === 'duplicada') {
    return {
      accion: 'duplicada',
      duplicada: true,
      mesa: plan.mesa,
      cuentaId: plan.cuentaId,
      pedidoId: plan.pedidoId,
      comandaId: opId,
      comanda: plan.comanda,
      subtotal: Number(plan.comanda.subtotal) || 0,
      total: Number(plan.comanda.totalCuenta) || 0
    };
  }

  if (plan.pedido.crear) tx.guardar('pedidos', plan.pedidoId, plan.pedido.crear);
  else tx.actualizar('pedidos', plan.pedidoId, plan.pedido.actualizar);

  tx.guardar('comandas', opId, plan.comanda);

  if (plan.cuenta.crear) tx.guardar('cuentas_mesa', String(plan.mesa), plan.cuenta.crear);
  else tx.actualizar('cuentas_mesa', String(plan.mesa), plan.cuenta.actualizar);

  return {
    accion: plan.accion,
    duplicada: false,
    mesa: plan.mesa,
    cuentaId: plan.cuentaId,
    pedidoId: plan.pedidoId,
    comandaId: opId,
    comanda: plan.comanda,
    subtotal: plan.comanda.subtotal,
    total: plan.comanda.totalCuenta,
    operaciones: plan.cuenta.crear ? 1 : plan.cuenta.actualizar.operaciones
  };
}
