/* ==========================================================================
   MI BARRIO — Order Module
   Armar payload, guardar en Firebase, enviar WhatsApp + Email
   ========================================================================== */

import { db, getPedidosCollection, serverTimestamp, normalizarCelularPY, formatearCelularPY, escaparHtml } from './firebase.js';
import { addDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getTipoPedido, getMesaActual, getDescuento, formatearParaPedido, generarMensajeWhatsApp, getPizzas, getExtrasCantidades } from './cart.js';
import { getPrecioExtra, getNombreTamano, getNombreExtra } from './menu-store.js';
import { getDeliveryState, estimarDelivery } from './delivery.js';
import { getEstadoLocal } from './config-listener.js';

// Número de WhatsApp del local (desde index.html)
const WHATSAPP_DESTINO = '595986368904';
const EMAIL_DESTINO = 'silverpy2@gmail.com';

// Tiempo máximo para guardar en Firestore: si no responde, el pedido igual sale por WhatsApp
const TIMEOUT_GUARDADO = 8000;

function conTimeout(promesa, ms, etiqueta) {
  let timer;
  const limite = new Promise((_, rechazar) => {
    timer = setTimeout(() => rechazar(new Error(`Tiempo de espera agotado (${etiqueta})`)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}

let guardando = false;

export async function crearYEnviarPedido(datosCliente, formaPago) {
  if (guardando) return { ok: false, error: 'Ya se está procesando un pedido' };
  guardando = true;

  try {
    // Igual que index.html: con el local cerrado no se toman pedidos
    if (!getEstadoLocal().abierto) {
      return { ok: false, error: 'El local está cerrado en este momento. No podemos tomar pedidos ahora.' };
    }

    // Validaciones básicas
    const tipo = getTipoPedido();
    const mesa = getMesaActual();
    const descuento = getDescuento();

    // Si el mapa todavía no calculó la distancia, se estima por ruta (igual que index.html)
    let delivery = getDeliveryState();
    if (tipo === 'delivery' && delivery.km == null && datosCliente.lat && datosCliente.lng) {
      delivery = estimarDelivery(Number(datosCliente.lat), Number(datosCliente.lng));
    }
    const { km: distanciaKm, costo: deliveryCosto, fuera: deliveryFuera } = delivery;

    // El pedido debe tener al menos una pizza (evita pedidos vacíos)
    if (!getPizzas().length) throw new Error('Agregá al menos una pizza al pedido');

    if (tipo === 'delivery') {
      if (!datosCliente.direccion) throw new Error('Falta dirección');
      if (!datosCliente.celular) throw new Error('Falta celular');
      if (!datosCliente.lat || !datosCliente.lng) throw new Error('Falta ubicación en mapa');
      if (deliveryFuera) throw new Error('Zona no cubierta por delivery');
      if (distanciaKm == null) throw new Error('No se pudo calcular el costo del delivery');
    }

    if (tipo === 'local' && !mesa) throw new Error('Falta número de mesa');

    const celularNorm = normalizarCelularPY(datosCliente.celular);
    if (datosCliente.celular && !celularNorm) throw new Error('Celular inválido');

    // Formatear pedido
    const pedidoData = formatearParaPedido(deliveryCosto, distanciaKm);
    pedidoData.pago = formaPago;
    pedidoData.cliente = {
      nombre: datosCliente.nombre || (tipo === 'retiro' ? 'Mostrador' : (tipo === 'local' ? `Mesa ${mesa}` : 'Cliente')),
      direccion: datosCliente.direccion || '',
      celular: celularNorm || '',
      notas: datosCliente.notas || '',
      lat: datosCliente.lat || null,
      lng: datosCliente.lng || null,
      mapa: (datosCliente.lat && datosCliente.lng) ? `https://maps.google.com/?q=${datosCliente.lat},${datosCliente.lng}` : ''
    };

    // Generar mensaje WhatsApp (celular formateado y forma de pago, igual que index.html)
    const celularMsg = celularNorm ? formatearCelularPY(celularNorm) : '';
    const pagoTexto = formaPago === 'transferencia' ? 'Transferencia' : 'Efectivo';
    const mensaje = generarMensajeWhatsApp(
      { ...pedidoData.cliente, celular: celularMsg },
      deliveryCosto,
      distanciaKm
    );
    const mensajeConPago = mensaje.replace(
      '*💰 TOTAL A PAGAR:*',
      `*💳 Forma de pago:* ${pagoTexto}\n*💰 TOTAL A PAGAR:*`
    );
    pedidoData.mensaje = mensajeConPago;

    // 1. Guardar en Firebase (no bloquea envío WhatsApp)
    let pedidoId = null;
    let guardadoEnPanel = false;
    const payload = { ...pedidoData, creado: serverTimestamp() };
    try {
      const docRef = await conTimeout(addDoc(getPedidosCollection(), payload), TIMEOUT_GUARDADO, 'guardar pedido');
      pedidoId = docRef.id;
      guardadoEnPanel = true;
      // Guardar datos del cliente en localStorage para autocompletado futuro
      try {
        const clienteData = { nombre: payload.cliente.nombre, celular: payload.cliente.celular, direccion: payload.cliente.direccion, lat: payload.lat, lng: payload.lng };
        localStorage.setItem('mb_cliente_v1', JSON.stringify(clienteData));
      } catch(e) {}
      console.log('[Order] Pedido guardado en Firebase:', pedidoId);
    } catch (fbErr) {
      if (fbErr && fbErr.code === 'permission-denied') {
        // Si las reglas publicadas todavía no permiten los campos nuevos, reintenta sin ellos
        console.error('[Order] Error guardando en Firebase, reintentando con payload mínimo:', fbErr);
        const { tipo, mesa, origen, pagado, descuento, ...payloadMinimo } = payload;
        try {
          const docRef = await conTimeout(addDoc(getPedidosCollection(), payloadMinimo), TIMEOUT_GUARDADO, 'guardar pedido (reintento)');
          pedidoId = docRef.id;
          guardadoEnPanel = true;
          console.log('[Order] Pedido guardado con payload mínimo:', pedidoId);
        } catch (fbErr2) {
          console.error('[Order] Error guardando pedido en el panel:', fbErr2);
        }
      } else {
        // Sin conexión, Firestore bloqueado o timeout: el pedido sigue por WhatsApp
        console.warn('[Order] No se pudo guardar en el panel:', fbErr.message || fbErr);
      }
    }

    // 2. Enviar por WhatsApp
    const urlWhatsApp = `https://wa.me/${WHATSAPP_DESTINO}?text=${encodeURIComponent(mensajeConPago)}`;
    window.open(urlWhatsApp, '_blank');

    // 3. Enviar copia por email (FormSubmit) - no bloqueante
    enviarEmail(pedidoData, mensajeConPago).catch(err => console.warn('[Order] Email falló:', err));

    return { ok: true, pedidoId, guardadoEnPanel, mensaje: mensajeConPago };
  } catch (err) {
    console.error('[Order] Error creando pedido:', err);
    return { ok: false, error: err.message };
  } finally {
    guardando = false;
  }
}

// Email via FormSubmit (igual que index.html)
async function enviarEmail(pedidoData, mensaje) {
  const { total, cliente, tipo, mesa } = pedidoData;
  const envio = tipo === 'delivery' ? pedidoData.costoDelivery : 0;

  const datosCorreo = {
    nombre: cliente.nombre,
    direccion: cliente.direccion,
    ubicacion_gps: cliente.mapa,
    celular: formatearCelularPY(cliente.celular),
    pedido: mensaje,
    total: total.toLocaleString('es-PY') + ' Gs',
    _subject: `🍕 NUEVO PEDIDO - MI BARRIO (${tipo}${mesa ? ' Mesa ' + mesa : ''})`,
    _template: 'table'
  };

  const resp = await fetch(`https://formsubmit.co/ajax/${EMAIL_DESTINO}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(datosCorreo)
  });
  if (!resp.ok) throw new Error('Email HTTP ' + resp.status);
  return resp.json();
}

// Generar resumen HTML para modal de confirmación
export function generarResumenHTML(datosCliente, formaPago) {
  const tipo = getTipoPedido();
  const mesa = getMesaActual();
  const { km: distanciaKm, costo: deliveryCosto, fuera: deliveryFuera } = getDeliveryState();
  const descuento = getDescuento();
  const { pizzas, extrasCantidades, subtotal, total } = getStateCompleto();

  const envio = tipo === 'delivery' ? deliveryCosto : 0;
  const totalFinal = total + envio;

  let html = '<div class="space-y-3">';

  // Tipo y mesa
  if (tipo === 'local') {
    html += `<div class="status-banner status-info"><strong>🍽️ Pedido en el local</strong> · Mesa ${mesa}</div>`;
  } else if (tipo === 'retiro') {
    html += `<div class="status-banner status-info"><strong>🛍️ Retiro en local</strong></div>`;
  } else {
    html += `<div class="status-banner status-info"><strong>🛵 Delivery</strong></div>`;
  }

  // Cliente
  html += '<div class="space-y-1 text-sm">';
  if (tipo === 'local') {
    html += `<div><strong>Cliente:</strong> Mesa ${mesa}</div>`;
  } else {
    html += `<div><strong>Cliente:</strong> ${escaparHtml(datosCliente.nombre)}</div>`;
    if (datosCliente.celular) html += `<div><strong>Celular:</strong> ${formatearCelularPY(normalizarCelularPY(datosCliente.celular))}</div>`;
    if (datosCliente.direccion) html += `<div><strong>Dirección:</strong> ${escaparHtml(datosCliente.direccion)}</div>`;
    if (datosCliente.notas) html += `<div><strong>Notas:</strong> ${escaparHtml(datosCliente.notas)}</div>`;
  }
  html += '</div>';

  // Pizzas
  if (pizzas.length) {
    html += '<div class="space-y-2"><strong>Pizzas:</strong>';
    pizzas.forEach((p, i) => {
      html += `<div class="bg-card-hover p-3 rounded-lg text-sm"><div class="font-bold">Pizza ${i+1} – ${escaparHtml(getNombreTamano(p.tamano))}</div><div class="text-muted">${p.sabores.join(', ')}${p.borde ? ' · Borde relleno' : ''}</div><div class="font-bold text-accent">${p.precio.toLocaleString('es-PY')} Gs</div></div>`;
    });
    html += '</div>';
  }

  // Extras
  const extrasLista = Object.entries(extrasCantidades).filter(([,c]) => c > 0);
  if (extrasLista.length) {
    html += '<div class="space-y-1"><strong>Extras:</strong>';
    extrasLista.forEach(([id, cant]) => {
      html += `<div class="text-sm">• ${escaparHtml(getNombreExtra(id))} x${cant}</div>`;
    });
    html += '</div>';
  }

  // Totales
  html += '<div class="border-t border-line pt-3 space-y-1 text-sm">';
  html += `<div class="flex justify-between"><span>Subtotal pizzas</span><span class="font-bold">${subtotal.toLocaleString('es-PY')} Gs</span></div>`;
  if (envio > 0) html += `<div class="flex justify-between text-gold"><span>🛵 Delivery</span><span class="font-bold">+ ${envio.toLocaleString('es-PY')} Gs</span></div>`;
  if (descuento > 0) html += `<div class="flex justify-between text-accent"><span>Descuento</span><span class="font-bold">− ${descuento.toLocaleString('es-PY')} Gs</span></div>`;
  html += `<div class="divider-dashed"></div>`;
  html += `<div class="flex justify-between text-lg font-black"><span>TOTAL</span><span class="text-accent font-display">${totalFinal.toLocaleString('es-PY')} Gs</span></div>`;
  html += `<div class="text-sm text-muted"><strong>Pago:</strong> ${formaPago === 'efectivo' ? '💵 Efectivo' : '🏦 Transferencia'}</div>`;
  html += '</div></div>';

  return html;
}

// Helper para obtener estado completo del carrito
function getStateCompleto() {
  const pizzas = getPizzas();
  const extrasCantidades = getExtrasCantidades();
  const subtotal = pizzas.reduce((a, p) => a + p.precio, 0) +
    Object.entries(extrasCantidades).reduce((a, [id, cant]) => a + (getPrecioExtra(id) * cant), 0);
  const total = subtotal - getDescuento();
  return { pizzas, extrasCantidades, subtotal, total };
}

console.log('[Order] Inicializado');