/* ==========================================================================
   MI BARRIO — Cart Store
   Carrito de compras en memoria + persistencia en localStorage
   ========================================================================== */

import { suscribir as suscribirMenu, getPrecioPizza, getPrecioExtra, getNombreExtra, getNombreTamano, getNombreCortoTamano, getPrecioBorde } from './menu-store.js';
import { getDeliveryCosto } from './delivery.js';

const STORAGE_KEY = 'mb_carrito_v1';

// Estado del carrito
let pizzas = [];        // Array de { tamano, sabores[], borde, precio }
let extrasCantidades = {}; // { extraId: cantidad }
let mesaActual = null;  // número de mesa si es pedido en local (QR)
let tipoPedido = 'delivery'; // 'delivery' | 'retiro' | 'local'
let descuento = 0;

// Suscriptores
const suscriptores = new Set();
function notificar() {
  const state = getState();
  suscriptores.forEach(fn => fn(state));
  // Persistir
  persistir();
}

export function suscribir(fn) {
  suscriptores.add(fn);
  fn(getState()); // Emitir estado actual inmediatamente
  return () => suscriptores.delete(fn);
}

// Persistencia en localStorage
function persistir() {
  try {
    const data = {
      pizzas,
      extrasCantidades,
      mesaActual,
      tipoPedido,
      descuento,
      timestamp: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[Cart] Error persistiendo:', e);
  }
}

function hidratar() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      // Validar estructura básica
      if (Array.isArray(data.pizzas)) pizzas = data.pizzas;
      if (data.extrasCantidades && typeof data.extrasCantidades === 'object') extrasCantidades = data.extrasCantidades;
      if (typeof data.mesaActual === 'number' || data.mesaActual === null) mesaActual = data.mesaActual;
      if (['delivery', 'retiro', 'local'].includes(data.tipoPedido)) tipoPedido = data.tipoPedido;
      if (typeof data.descuento === 'number') descuento = Math.max(0, data.descuento);
    }
  } catch (e) {
    console.warn('[Cart] Error hidratando, limpiando:', e);
    limpiar();
  }
}

// Getters
function getState() {
  const subtotalPizzas = pizzas.reduce((a, p) => a + (p.precio || 0), 0);
  const subtotalExtras = Object.entries(extrasCantidades).reduce((a, [id, cant]) => a + (getPrecioExtra(id) * (cant || 0)), 0);
  const subtotal = subtotalPizzas + subtotalExtras;
  const total = Math.max(0, subtotal - descuento);

  return {
    pizzas: [...pizzas],
    extrasCantidades: { ...extrasCantidades },
    mesaActual,
    tipoPedido,
    descuento,
    subtotalPizzas,
    subtotalExtras,
    subtotal,
    total,
    tieneItems: pizzas.length > 0 || Object.values(extrasCantidades).some(c => c > 0),
    cantidadPizzas: pizzas.length,
    cantidadExtras: Object.values(extrasCantidades).reduce((a, c) => a + c, 0)
  };
}

export function getPizzas() { return [...pizzas]; }
export function getExtrasCantidades() { return { ...extrasCantidades }; }
export function getMesaActual() { return mesaActual; }
export function getTipoPedido() { return tipoPedido; }
export function getDescuento() { return descuento; }
export function getTotales() {
  const s = getState();
  return { subtotal: s.subtotal, descuento: s.descuento, total: s.total };
}

export function getTotalesConDelivery() {
  const s = getState();
  const envio = tipoPedido === 'delivery' ? (getDeliveryCosto() || 0) : 0;
  return { subtotal: s.subtotal, descuento: s.descuento, envio, total: s.total + envio };
}

// --- ACCIONES ---

// Tipo de pedido (delivery/retiro/local)
export function setTipoPedido(tipo) {
  if (!['delivery', 'retiro', 'local'].includes(tipo)) return;
  tipoPedido = tipo;
  if (tipo !== 'local') mesaActual = null;
  notificar();
}

export function setMesaActual(numero) {
  if (tipoPedido !== 'local') return;
  mesaActual = Number(numero) || null;
  notificar();
}

// Descuento
export function setDescuento(monto) {
  descuento = Math.max(0, Number(monto) || 0);
  notificar();
}

// Pizzas
export function agregarPizza(tamano, sabores, borde) {
  if (!tamano || !sabores?.length) return false;
  const precio = getPrecioPizza(tamano, sabores, !!borde);
  pizzas.push({ tamano, sabores: [...sabores], borde: !!borde, precio });
  notificar();
  return true;
}

export function quitarPizza(index) {
  if (index >= 0 && index < pizzas.length) {
    pizzas.splice(index, 1);
    notificar();
    return true;
  }
  return false;
}

export function limpiarPizzas() {
  pizzas = [];
  notificar();
}

// Extras
export function setExtraCantidad(extraId, cantidad) {
  const c = Math.max(0, Math.floor(Number(cantidad) || 0));
  if (c === 0) delete extrasCantidades[extraId];
  else extrasCantidades[extraId] = c;
  notificar();
}

export function cambiarExtraCantidad(extraId, delta) {
  const actual = extrasCantidades[extraId] || 0;
  setExtraCantidad(extraId, actual + delta);
}

export function limpiarExtras() {
  extrasCantidades = {};
  notificar();
}

// Limpiar todo
export function limpiar() {
  pizzas = [];
  extrasCantidades = {};
  mesaActual = null;
  tipoPedido = 'delivery';
  descuento = 0;
  notificar();
}

// Formatear para envío a Firebase / WhatsApp
export function formatearParaPedido(deliveryCosto = 0, distanciaKm = null) {
  const state = getState();
  const pizzasFormateadas = pizzas.map(p => ({
    tamano: p.tamano,
    nombre: getNombreTamano(p.tamano),
    sabores: [...p.sabores],
    borde: !!p.borde,
    precio: p.precio
  }));

  const extrasFormateados = Object.entries(extrasCantidades)
    .filter(([, cant]) => cant > 0)
    .map(([id, cantidad]) => ({ item: getNombreExtra(id), cantidad }));

  const clienteBase = {
    nombre: '', // Se llena en checkout
    direccion: '',
    celular: '',
    notas: '',
    lat: null,
    lng: null,
    mapa: ''
  };

  const envio = tipoPedido === 'delivery' ? deliveryCosto : 0;
  const totalConDelivery = state.total + envio;

  return {
    local: 'mi-barrio',
    estado: 'nuevo',
    tipo: tipoPedido,
    mesa: tipoPedido === 'local' ? mesaActual : null,
    origen: 'cliente',
    pago: null, // Se define en checkout
    pagado: false,
    descuento,
    costoDelivery: envio,
    distanciaKm: distanciaKm ? Number(distanciaKm.toFixed(2)) : null,
    cliente: clienteBase,
    pizzas: pizzasFormateadas,
    extras: extrasFormateados,
    total: totalConDelivery,
    mensaje: '' // Se genera en order.js
  };
}

// Generar mensaje WhatsApp (igual que index.html)
export function generarMensajeWhatsApp(datosCliente, deliveryCosto = 0, distanciaKm = null) {
  const { nombre, direccion, celular, notas, lat, lng } = datosCliente;
  const state = getState();
  const envio = tipoPedido === 'delivery' ? deliveryCosto : 0;
  const totalConDelivery = state.total + envio;
  const enlaceMaps = (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : '';

  let msg = `*🍕 NUEVO PEDIDO - MI BARRIO 🍕*\n\n`;
  if (tipoPedido === 'local' && mesaActual) {
    msg += `*👤 Cliente:* Mesa ${mesaActual}\n`;
  } else {
    msg += `*👤 Cliente:* ${nombre}\n`;
  }
  if (celular) msg += `*📞 Celular:* ${celular}\n`;
  if (direccion) msg += `*📍 Dirección:* ${direccion}\n`;
  if (enlaceMaps) msg += `*🗺️ Ubicación GPS:* ${enlaceMaps}\n`;
  msg += `\n---------------------------------\n\n`;

  if (tipoPedido === 'local' && mesaActual) msg += `*🪑 Mesa: ${mesaActual}*\n`;
  if (tipoPedido === 'retiro') msg += `*🛍️ Retiro en local*\n`;
  msg += `*📦 DETALLE DE LA ORDEN:*\n`;

  pizzas.forEach((p, i) => {
    msg += `🍕 *Pizza ${i + 1}* – ${getNombreTamano(p.tamano)}\n`;
    msg += `• *Sabores:* ${p.sabores.join(', ')}\n`;
    if (p.borde) msg += `• Con Borde Relleno (+${getPrecioBorde(p.tamano).toLocaleString('es-PY')} Gs)\n`;
    msg += `• Precio: ${p.precio.toLocaleString('es-PY')} Gs\n\n`;
  });

  Object.entries(extrasCantidades).forEach(([id, cant]) => {
    if (cant > 0) msg += `• ${getNombreExtra(id)} x${cant}\n`;
  });

  if (tipoPedido === 'delivery' && envio > 0) {
    msg += `\n*🛵 Delivery:* ${envio.toLocaleString('es-PY')} Gs${distanciaKm ? ` (${distanciaKm.toFixed(1)} km)` : ''}\n`;
  }
  if (descuento > 0) {
    msg += `*🎁 Descuento:* ${descuento.toLocaleString('es-PY')} Gs\n`;
  }
  msg += `*💰 TOTAL A PAGAR:* ${totalConDelivery.toLocaleString('es-PY')} Gs\n`;
  // Pago se agrega en checkout
  msg += `\n¡Muchas gracias! Quedo a la espera de la confirmación de mi pedido.`;

  return msg;
}

// Inicializar al cargar
hidratar();

// Escuchar cambios de menú para recalcular precios de pizzas existentes
suscribirMenu(() => {
  // Recalcular precios de pizzas en carrito
  pizzas = pizzas.map(p => ({
    ...p,
    precio: getPrecioPizza(p.tamano, p.sabores, p.borde)
  }));
  notificar();
});

// Helper para getPrecioBorde (importado de menu-store al inicio del módulo)

console.log('[Cart] Inicializado');