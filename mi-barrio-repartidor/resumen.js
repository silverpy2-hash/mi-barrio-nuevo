import { creadoMs, fechaCorta, gs, numeroCorto, PAGOS, ubicacionCliente, waNumeroPy } from './logica.js';

// Accept local Paraguay phones or an international number, never a URL or free text.
export function destinoWhatsApp(value) {
    const raw = String(value || '').trim();
    if (!/^\+?[\d\s().-]+$/.test(raw)) return '';
    let digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+') || digits.startsWith('00')) {
        if (!raw.startsWith('+')) digits = digits.slice(2);
        return /^[1-9]\d{6,14}$/.test(digits) ? digits : '';
    }
    if (digits.startsWith('0') || digits.startsWith('595') || /^9\d{8}$/.test(digits)) {
        return waNumeroPy(digits);
    }
    return /^[1-9]\d{6,14}$/.test(digits) ? digits : '';
}

export function resumenPedidoTexto(p = {}) {
    const c = p.cliente || {};
    const estados = { nuevo: 'Nuevo', preparacion: 'En preparación', en_camino: 'En camino',
        entregado: 'Entregado', cancelado: 'Cancelado', archivado: 'Archivado' };
    const tipos = { delivery: 'Delivery', retiro: 'Retiro', local: 'En el local' };
    const lines = ['Mi Barrio - Resumen del pedido ' + numeroCorto(p)];
    const add = (label, value) => {
        if (value != null && String(value).trim() !== '') lines.push(label + ': ' + String(value).trim());
    };
    const money = (label, value) => {
        if (value != null && value !== '' && Number.isFinite(Number(value))) add(label, gs(value));
    };
    const created = creadoMs(p);
    if (Number.isFinite(created) && created > 0) add('Fecha', fechaCorta(created));
    add('Estado', estados[p.estado] || p.estado);
    add('Modalidad', tipos[p.tipo] || p.tipo);
    add('Mesa', p.mesa);
    add('Origen', p.origen);
    lines.push('', 'CLIENTE');
    add('Nombre', c.nombre || 'Sin nombre registrado');
    add('Celular', c.celular);
    add('Dirección', c.direccion || 'Sin dirección registrada');
    add('Ubicación', ubicacionCliente(c));
    lines.push('', 'PRODUCTOS');
    const pizzas = Array.isArray(p.pizzas) ? p.pizzas.filter(Boolean) : [];
    const extras = Array.isArray(p.extras) ? p.extras.filter(x => x && (x.item || x.nombre)) : [];
    for (const [i, z] of pizzas.entries()) {
        const qty = Number(z.cantidad);
        lines.push(`${i + 1}. ${z.nombre || z.tamano || 'Pizza'}${qty > 0 ? ' x' + qty : ''}`);
        if (Array.isArray(z.sabores) && z.sabores.filter(Boolean).length) add('   Sabores', z.sabores.filter(Boolean).join(', '));
        if (z.borde) lines.push('   Borde relleno');
        money('   Precio registrado', z.precio);
    }
    if (extras.length) {
        lines.push('Extras:');
        for (const x of extras) {
            lines.push(`- ${x.item || x.nombre} x${Number(x.cantidad || 1)}`);
            money('   Precio registrado', x.precio);
        }
    }
    if (!pizzas.length && !extras.length) lines.push('Sin productos registrados');
    lines.push('', 'IMPORTE Y PAGO');
    money('Subtotal registrado', p.subtotal);
    money('Delivery', p.costoDelivery);
    add('Descuento registrado', p.descuento);
    money('TOTAL', p.total);
    add('Método de pago', PAGOS[p.pago]?.label || p.pago || 'Sin definir');
    add('Cobro', p.pagado ? 'Cobrado' : 'Por cobrar');
    money('Recibido', p.recibido);
    money('Vuelto', p.vuelto);
    const charged = creadoMs({ creado: p.cobradoEn });
    if (Number.isFinite(charged) && charged > 0) add('Fecha de cobro', fechaCorta(charged));
    if (c.notas || p.mensaje) {
        lines.push('', 'NOTAS');
        add('Cliente', c.notas);
        add('Pedido', p.mensaje);
    }
    return lines.join('\n');
}

export function resumenWhatsAppUrl(destino, pedido) {
    const phone = destinoWhatsApp(destino);
    return phone && pedido ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(resumenPedidoTexto(pedido)) : '';
}

// The controller only reads the current snapshot. Opening a draft never sends it.
export function instalarResumenPedidos({ document, getPedido,
    abrirExterno = (...args) => globalThis.open(...args) }) {
    const $ = id => document.getElementById(id);
    const lista = $('lista'), modal = $('resumen-modal'), form = $('resumen-form');
    const numero = $('resumen-numero'), texto = $('resumen-texto'), error = $('resumen-error');
    const titulo = $('resumen-titulo'), closeButton = $('resumen-cerrar');
    let currentId = null;
    const limpiar = () => {
        currentId = null;
        numero.value = '';
        texto.value = '';
        error.textContent = '';
        error.hidden = true;
    };
    const cerrar = () => {
        limpiar();
        if (modal.open) modal.close();
    };
    const sincronizar = () => {
        if (currentId === null) return;
        const p = getPedido(currentId);
        if (!p) { cerrar(); return; }
        titulo.textContent = 'Resumen del pedido ' + numeroCorto(p);
        texto.value = resumenPedidoTexto(p);
    };
    const onClick = event => {
        const button = event.target.closest?.('[data-accion="resumen"]');
        if (!button || !lista.contains(button)) return;
        const article = button.closest('article[data-id]');
        const id = article?.getAttribute('data-id');
        if (!id || !getPedido(id)) return;
        limpiar();
        currentId = id;
        sincronizar();
        if (!modal.open) modal.showModal();
        numero.focus();
    };
    const onSubmit = event => {
        event.preventDefault();
        if (currentId === null) return;
        const p = getPedido(currentId);
        if (!p) { cerrar(); return; }
        const url = resumenWhatsAppUrl(numero.value, p);
        if (!url) {
            error.textContent = 'Ingresá un número válido: 0981 123456 o +código de país y número.';
            error.hidden = false;
            numero.focus();
            return;
        }
        sincronizar();
        error.textContent = '';
        error.hidden = true;
        abrirExterno(url, '_blank', 'noopener,noreferrer');
    };
    const onClose = () => { if (!modal.open) limpiar(); };
    const onBackdrop = event => { if (event.target === modal) cerrar(); };
    lista.addEventListener('click', onClick);
    form.addEventListener('submit', onSubmit);
    closeButton.addEventListener('click', cerrar);
    modal.addEventListener('close', onClose);
    modal.addEventListener('click', onBackdrop);
    return { cerrar, sincronizar, destruir() {
        cerrar();
        lista.removeEventListener('click', onClick);
        form.removeEventListener('submit', onSubmit);
        closeButton.removeEventListener('click', cerrar);
        modal.removeEventListener('close', onClose);
        modal.removeEventListener('click', onBackdrop);
    } };
}
