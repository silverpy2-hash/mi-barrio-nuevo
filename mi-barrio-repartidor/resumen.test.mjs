import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTarjetaHTML, whatsappUrl, MENSAJE_WHATSAPP } from './logica.js';

const summary = await import('./resumen.js').catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
});

const pedido = () => ({
    id: 'pedido-a', numero: 7, estado: 'en_camino', tipo: 'delivery', origen: 'panel',
    creado: 1763300000000, total: 85000, pago: 'efectivo', pagado: true,
    recibido: 100000, vuelto: 15000, costoDelivery: 5000,
    cliente: { nombre: 'Ana & familia', celular: '0981123456', direccion: 'Calle Ejemplo 123',
        mapa: 'https://maps.app.goo.gl/ejemplo', notas: 'Portón verde' },
    pizzas: [{ nombre: 'Grande', sabores: ['Muzza', 'Calabresa'], borde: true, precio: 70000 }],
    extras: [{ item: 'Gaseosa', cantidad: 2, precio: 5000 }], mensaje: 'Sin cebolla',
});

test('each order gets an independent summary button without changing its existing WhatsApp notice', () => {
    const html = renderTarjetaHTML(pedido());
    assert.match(html, /data-accion="resumen"/);
    assert.match(html, /Enviar resumen/);
    assert.ok(html.includes(whatsappUrl(pedido().cliente.celular).replace(/&/g, '&amp;')));
    assert.equal(decodeURIComponent(new URL(whatsappUrl('0981123456')).searchParams.get('text')), MENSAJE_WHATSAPP);
    assert.match(renderTarjetaHTML({ ...pedido(), cliente: {} }), /data-accion="resumen"/);
});

test('summary includes the recorded customer, location, products, amounts, payment and notes without mutating the order', () => {
    const p = pedido();
    const before = JSON.stringify(p);
    const text = summary.resumenPedidoTexto(p);
    for (const part of ['Mi Barrio', '#7', 'Ana & familia', '0981123456', 'Calle Ejemplo 123',
        'https://maps.app.goo.gl/ejemplo', 'Grande', 'Muzza', 'Calabresa', 'Borde relleno',
        'Gaseosa x2', '5.000 Gs', '85.000 Gs', 'Efectivo', 'Cobrado', '100.000 Gs',
        '15.000 Gs', 'Portón verde', 'Sin cebolla', 'En camino']) assert.ok(text.includes(part), part);
    assert.equal(JSON.stringify(p), before);
    assert.equal(text.includes(p.id), false, 'internal document IDs are not customer-facing data');
    assert.match(summary.resumenPedidoTexto({ numero: 1, total: 0 }), /Sin productos registrados/);
});

test('destination accepts a different Paraguay number and international numbers but rejects invalid input', () => {
    for (const [input, expected] of [['0982 234-567', '595982234567'], ['982234567', '595982234567'],
        ['+54 (9) 11 1234-5678', '5491112345678'], ['0055 11 91234-5678', '5511912345678']]) {
        assert.equal(summary.destinoWhatsApp(input), expected);
    }
    for (const input of ['', '123', 'abc0981123456', 'javascript:123456789', '+1234567890123456']) {
        assert.equal(summary.destinoWhatsApp(input), '');
        assert.equal(summary.resumenWhatsAppUrl(input, pedido()), '');
    }
    const url = new URL(summary.resumenWhatsAppUrl('+54 9 11 1234 5678', pedido()));
    assert.equal(url.origin, 'https://wa.me');
    assert.equal(url.pathname, '/5491112345678');
    assert.equal(url.searchParams.get('text'), summary.resumenPedidoTexto(pedido()));
});

class Element {
    constructor() { this.listeners = new Map(); this.value = ''; this.textContent = ''; this.attrs = {}; this.open = false; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
    emit(name, event = {}) { this.listeners.get(name)?.({ preventDefault() {}, ...event }); }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
}

function fixture() {
    let current = pedido();
    const ids = ['lista', 'resumen-modal', 'resumen-form', 'resumen-numero', 'resumen-texto',
        'resumen-error', 'resumen-titulo', 'resumen-cerrar'];
    const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
    const article = { getAttribute: () => 'pedido-a' };
    const button = new Element();
    button.closest = selector => selector === '[data-accion="resumen"]' ? button : article;
    nodes.lista.contains = node => node === button;
    const opened = [];
    const controller = summary.instalarResumenPedidos({
        document: { getElementById: id => nodes[id] },
        getPedido: id => id === 'pedido-a' ? current : null,
        abrirExterno: (...args) => opened.push(args),
    });
    return { nodes, button, controller, opened, setPedido(p) { current = p; },
        open() { nodes.lista.emit('click', { target: button }); },
        submit() { nodes['resumen-form'].emit('submit'); } };
}

test('summary opens only a preview first, validates recipient, and opens one fresh draft on explicit submit', () => {
    const f = fixture();
    f.open();
    assert.equal(f.nodes['resumen-modal'].open, true);
    assert.equal(f.nodes['resumen-numero'].value, '', 'never silently reuse the customer number');
    assert.equal(f.opened.length, 0);
    f.nodes['resumen-numero'].value = '123';
    f.submit();
    assert.equal(f.opened.length, 0);
    assert.ok(f.nodes['resumen-error'].textContent);
    const changed = { ...pedido(), total: 99000 };
    f.setPedido(changed);
    f.controller.sincronizar();
    assert.match(f.nodes['resumen-texto'].value, /99\.000 Gs/);
    f.nodes['resumen-numero'].value = '+54 9 11 1234 5678';
    f.submit();
    assert.equal(f.opened.length, 1);
    const [url, target, features] = f.opened[0];
    assert.equal(new URL(url).searchParams.get('text'), summary.resumenPedidoTexto(changed));
    assert.equal(target, '_blank');
    assert.equal(features, 'noopener,noreferrer');
    assert.equal(changed.estado, 'en_camino');
});

test('cancel/logout or a removed order cannot send a retained customer draft', () => {
    const f = fixture();
    f.open();
    f.nodes['resumen-numero'].value = '0982234567';
    f.controller.cerrar();
    assert.equal(f.nodes['resumen-texto'].value, '');
    f.submit();
    assert.equal(f.opened.length, 0);
    f.open();
    f.nodes['resumen-numero'].value = '0982234567';
    f.setPedido(null);
    f.controller.sincronizar();
    f.submit();
    assert.equal(f.opened.length, 0);
    assert.equal(f.nodes['resumen-texto'].value, '');
    f.controller.destruir();
    f.open();
    assert.equal(f.nodes['resumen-modal'].open, false);
});
