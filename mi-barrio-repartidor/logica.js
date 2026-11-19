/* Mi Barrio · Repartidor — lógica pura (sin Firebase). Testeable en node. */

export function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function gs(n) { return Number(n || 0).toLocaleString('es-PY') + ' Gs'; }

export function creadoMs(p) {
    const c = p && p.creado;
    if (!c) return 0;
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c.toDate === 'function') return c.toDate().getTime();
    const n = Number(c);
    return Number.isFinite(n) ? n : 0;
}

export function fechaCorta(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function horaCorta(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

export function numeroCorto(p) { return p && p.numero ? '#' + p.numero : '#--'; }

export const PAGOS = {
    efectivo:      { label: 'Efectivo',      icono: '💵' },
    transferencia: { label: 'Transferencia', icono: '🏦' },
    pos:           { label: 'POS',           icono: '💳' }
};

export function pagoTexto(p) {
    const t = PAGOS[p && p.pago];
    return t ? t.icono + ' ' + t.label : '💵 Pago sin definir';
}

export function cobroTexto(p) {
    return (p && p.pagado) ? '✅ Cobrado' : '💰 Por cobrar';
}

export function esPagado(p) { return !!(p && p.pagado); }

export function telNumero(celular) {
    return String(celular || '').replace(/[^\d+]/g, '');
}

// Normaliza un celular paraguayo a formato internacional (solo dígitos, con 595).
// Devuelve '' si el número no es válido (entonces se ocultan Llamar y WhatsApp).
// Ejemplos: '0981 123-456' → '595981234567' | '+595 981 234 567' → '595981234567'
//           '021 123456'  → '59521123456'  | '123'             → ''
export function waNumeroPy(celular) {
    let d = String(celular || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);          // prefijo internacional desde otra zona
    if (d.startsWith('5950')) d = '595' + d.slice(4); // '595 0...' escrito con doble cero
    if (d.startsWith('595')) {
        return (/^5959\d{8}$/.test(d) || /^595[2-6]\d{7,8}$/.test(d)) ? d : '';
    }
    if (d.startsWith('0')) d = '595' + d.slice(1);    // número local con 0 inicial
    else if (d.length === 8 || d.length === 9) d = '595' + d; // sin 0 ni código país
    else return '';
    return (/^5959\d{8}$/.test(d) || /^595[2-6]\d{7,8}$/.test(d)) ? d : '';
}

// Mensaje predefinido del repartidor (NO se envía automáticamente).
export const MENSAJE_WHATSAPP = '¡Hola! 👋🛵 Soy el repartidor de Mi Barrio 🍕. Tu pedido ya está en camino. ¡En breve estaremos llegando! Muchas gracias por elegirnos.';

// Enlace oficial wa.me con el mensaje codificado. '' si el número no es válido.
export function whatsappUrl(celular) {
    const n = waNumeroPy(celular);
    return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(MENSAJE_WHATSAPP) : '';
}

// Extrae un link de Google Maps embebido en un texto libre (misma regla que el TPV).
export function linkMaps(texto) {
    for (const palabra of String(texto || '').trim().split(/\s+/)) {
        const token = palabra.replace(/[.,;)]+$/, '');
        const m = /^(?:https?:\/\/)?([^/?#]+)([^?#]*)/i.exec(token);
        if (!m) continue;
        const host = m[1].toLowerCase(), ruta = m[2];
        if (/^maps\.google\.(?:com(?:\.[a-z]{2})?|[a-z]{2})$/.test(host) ||
            (/^(?:www\.)?google\.(?:com(?:\.[a-z]{2})?|[a-z]{2})$/.test(host) && /^\/maps(?:\/|$)/.test(ruta)) ||
            (host === 'maps.app.goo.gl' && ruta.length > 1) ||
            (host === 'goo.gl' && ruta.startsWith('/maps/'))) {
            return /^https?:\/\//i.test(token) ? token : 'https://' + token;
        }
    }
    return '';
}

export function linkDeCoords(lat, lon) {
    return 'https://maps.google.com/?q=' + Number(lat) + ',' + Number(lon);
}

export function tienePin(c) {
    const lat = Number(c && c.lat), lng = Number(c && c.lng);
    return c && c.lat != null && c.lng != null && c.lat !== '' && c.lng !== '' &&
        (lat || lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// Link de ubicación para el repartidor: URL de Maps > coordenadas > búsqueda por dirección.
export function ubicacionCliente(c) {
    if (!c) return '';
    const directo = linkMaps(c.mapa);
    if (directo) return directo;
    if (tienePin(c)) return linkDeCoords(c.lat, c.lng);
    const url = linkMaps(c.direccion);
    if (url) return url;
    const dir = String(c.direccion || '').trim();
    if (dir) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir);
    return '';
}

// Orden de entrega: por hora de creación (los más viejos primero).
export function ordenarPorCreacion(lista) {
    return [...lista].sort((a, b) => creadoMs(a) - creadoMs(b));
}

// Detalle del pedido: pizzas, sabores, borde, extras, delivery y notas.
// Solo usa los datos reales guardados por el TPV/el cliente. Nunca inventa.
export function pedidoDetalleHTML(p) {
    const c = (p && p.cliente) || {};
    const pizzas = Array.isArray(p && p.pizzas) ? p.pizzas : [];
    const extras = (Array.isArray(p && p.extras) ? p.extras : [])
        .filter(x => x && (x.item || x.nombre) && Number(x.cantidad || 1) > 0);
    const delivery = Number(p && p.costoDelivery) || 0;
    const notas = String(c.notas || '').trim();
    const partes = [];

    if (pizzas.length) {
        partes.push('<div class="detalle-titulo">Productos</div>');
        pizzas.forEach((z, i) => {
            if (!z) return;
            const nom = String(z.nombre || z.tamano || ('Pizza ' + (i + 1)));
            const sabores = Array.isArray(z.sabores) ? z.sabores.filter(Boolean).join(', ') : '';
            partes.push(`
                <div class="det-pizza">
                    <div class="det-pizza-nom">🍕 Pizza ${i + 1} – ${esc(nom)}</div>
                    ${sabores ? `<div class="det-sabores">${esc(sabores)}</div>` : ''}
                    ${z.borde ? '<div class="det-borde">✨ Con Borde relleno</div>' : ''}
                    ${z.precio != null && Number.isFinite(Number(z.precio)) ? `<div class="det-precio">${esc(gs(z.precio))}</div>` : ''}
                </div>`);
        });
    }

    if (extras.length) {
        partes.push('<div class="detalle-titulo">Extras</div>');
        partes.push('<ul class="det-extras">' + extras.map(x => {
            const cant = Number(x.cantidad || 1);
            return `<li>${esc(x.item || x.nombre)} x${cant}</li>`;
        }).join('') + '</ul>');
    }

    if (delivery > 0) {
        partes.push(`<div class="det-delivery">🛵 Costo de delivery: <strong>${esc(gs(delivery))}</strong></div>`);
    }

    if (notas) {
        partes.push(`<div class="det-notas">📝 ${esc(notas)}</div>`);
    }

    return partes.length
        ? partes.join('')
        : '<div class="detalle-vacio">Sin detalle disponible.</div>';
}

// Tarjeta de un pedido en camino (HTML listo para insertar).
export function renderTarjetaHTML(p) {
    const c = (p && p.cliente) || {};
    const ms = creadoMs(p);
    const ubicacion = ubicacionCliente(c);
    const tel = waNumeroPy(c.celular);
    const wsp = whatsappUrl(c.celular);
    const pagado = esPagado(p);
    const pago = pagoTexto(p);
    const idAttr = esc(p.id);
    const detalleId = 'detalle-' + idAttr;

    const botonDetalle = `
        <button class="btn btn-detalle" type="button" data-accion="detalle" aria-expanded="false" aria-controls="${detalleId}">
            <span>Ver detalle</span><span class="det-flecha" aria-hidden="true">▼</span>
        </button>
        <div class="detalle hidden" id="${detalleId}">
            ${pedidoDetalleHTML(p)}
        </div>`;

    return `
    <article class="entrega-card" data-id="${idAttr}">
        <div class="entrega-head">
            <span class="entrega-num">${esc(numeroCorto(p))}</span>
            <span class="entrega-tipo">🛵 DELIVERY</span>
            <span class="entrega-hora">🕒 ${esc(horaCorta(ms))}</span>
        </div>
        <h2 class="entrega-cliente">${esc(c.nombre || 'Cliente sin nombre')}</h2>
        <div class="entrega-total-row">
            <div class="entrega-total-lbl">TOTAL A COBRAR</div>
            <div class="entrega-total">${esc(gs(p.total))}</div>
        </div>
        <div class="entrega-pago-chip-row">
            <span class="entrega-chip entrega-chip-pago">${esc(pago)}</span>
            <span class="entrega-chip ${pagado ? 'entrega-chip-pagado' : 'entrega-chip-cobrar'}">${esc(cobroTexto(p))}</span>
        </div>
        <div class="entrega-lugar">${esc(c.direccion || 'Sin dirección registrada')}</div>
        <div class="entrega-acciones">
            ${tel ? `<a class="btn btn-llamar" href="tel:+${esc(tel)}">📞 Llamar<span class="btn-numero">${esc(c.celular)}</span></a>` : ''}
            ${wsp ? `<a class="btn btn-whatsapp" href="${esc(wsp)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
            ${ubicacion ? `<a class="btn btn-mapa" href="${esc(ubicacion)}" target="_blank" rel="noopener">🗺️ Ver ubicación</a>` : ''}
            <button class="btn btn-resumen" type="button" data-accion="resumen">Enviar resumen</button>
        </div>
        ${botonDetalle}
    </article>`;
}

// Lista completa + estado vacío. Devuelve { html, vacio }.
export function renderListaHTML(pedidos) {
    if (!pedidos || pedidos.length === 0) return { html: '', vacio: true };
    return { html: ordenarPorCreacion(pedidos).map(renderTarjetaHTML).join(''), vacio: false };
}
