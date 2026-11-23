import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const web = read('index.html');
const panels = ['panel_nuevo.html', 'mi-barrio-tpv-celular/index.html'];
function between(source, start, end) {
    const a = source.indexOf(start);
    assert.notEqual(a, -1, start);
    const b = source.indexOf(end, a + start.length);
    assert.notEqual(b, -1, end);
    return source.slice(a, b);
}
function cart({ percent = 0, selected = true, category = 'clasico', size = 'grande', border = false, saved = [], mesa = false } = {}) {
    const nodes = new Map();
    const element = id => {
        if (!nodes.has(id)) nodes.set(id, { innerText: '', textContent: '', hidden: true, style: {}, focus() {} });
        return nodes.get(id);
    };
    const context = vm.createContext({
        window: { DESCUENTO_WEB: percent, DESCUENTO_WEB_LISTO: true, MESA_ACTUAL: mesa, MODALIDAD_PEDIDO: 'delivery' },
        deliveryPendiente: false,
        actualizarInterfaz() {}, actualizarBotonEnviar() {}, setTimeout: () => 0, clearTimeout() {}, confirm: () => true,
        document: { getElementById: element, querySelectorAll: () => selected ? [{ getAttribute: () => category }] : [] },
        obtenerTamanoSeleccionado: () => size,
        matrizPrecios: { [size]: { clasico: 60000, especial: 75000, gourmet: 90000 } },
        adicionales: { 'borde-piz': border ? 1 : 0, papas: 1, bebida: 2 },
        preciosAdicionales: { papas: 15000, bebida: 8000 },
        precioBorde: () => 15000,
        pedido: saved, deliveryCosto: 7000,
    });
    vm.runInContext(between(web, 'function calcularTotal()', '// Celular de Paraguay'), context);
    return { context, element, total: () => vm.runInContext('calcularTotal()', context) };
}

for (const percent of [10, 15, 20, 25]) {
    test(`${percent}% discounts all pizza sizes/categories and stuffed borders, not extras or delivery`, () => {
        for (const size of ['grande', 'mediano', 'chico', 'tren-grande']) {
            for (const [category, base] of Object.entries({ clasico: 60000, especial: 75000, gourmet: 90000 })) {
                const c = cart({ percent, size, category, border: true, saved: [{ precio: 55000 }] });
                const t = c.total();
                assert.equal(t.descuento, Math.round((base + 15000 + 55000) * percent / 100));
                assert.equal(t.totalGeneral, base + 15000 + 55000 + 31000 + 7000 - t.descuento);
                assert.equal(t.porcentajeDescuento, percent);
                assert.match(c.element('detalle-descuento-web').textContent, new RegExp(`${percent}%`));
            }
        }
    });
}
test('off preserves previous amounts, saved-pizza-only cart discounts correctly, mesa excludes delivery', () => {
    assert.equal(cart().total().totalGeneral, 98000);
    assert.equal(cart({ percent: 20, selected: false, saved: [{ precio: 75000 }] }).total().totalGeneral, 98000);
    assert.equal(cart({ percent: 20, mesa: true }).total().totalGeneral, 79000);
    assert.equal(cart({ percent: 20, selected: false }).total().descuento, 0);
});
test('live promotion normalizes configuration, advertises it and recalculates immediately', () => {
    const c = cart();
    vm.runInContext(between(web, 'window.aplicarDescuentoCliente =', 'function calcularTotal()'), c.context);
    vm.runInContext('window.aplicarDescuentoCliente({ activo: true, porcentaje: 25 })', c.context);
    assert.equal(c.total().totalGeneral, 83000);
    assert.equal(c.element('aviso-descuento-web').hidden, false);
    vm.runInContext('window.aplicarDescuentoCliente({ activo: false, porcentaje: 25 })', c.context);
    assert.equal(c.total().totalGeneral, 98000);
    assert.equal(c.element('aviso-descuento-web').hidden, true);
    vm.runInContext('window.aplicarDescuentoCliente({ activo: true, porcentaje: 99 })', c.context);
    assert.equal(c.total().descuento, 0);
});
test('web order with promotion but config unavailable shows alert and does not save or open WhatsApp', async () => {
    const c = cart({ percent: 20 });
    c.context.window.DESCUENTO_WEB_LISTO = false;
    c.context.window.PEDIDO_WEB_ENVIANDO = false;
    const fields = { nombre: 'Test', direccion: 'Test street', celular: '0981123456', latitud: '1', longitud: '2', 'ubicacion-recogida': '1' };
    for (const [id, value] of Object.entries(fields)) c.element(id).value = value;
    const alerts = [];
    Object.assign(c.context, {
        alert: msg => alerts.push(msg),
        normalizarCelularPY: () => '595981123456', formatearCelularPY: s => s,
        cerrarModalPago() {}, deliveryKm: 2, deliveryFuera: false,
        nombresTamano: { grande: 'Grande' }, nombresExtras: { papas: 'Papas', bebida: 'Gaseosa' },
        PAGOS_TXT: { efectivo: 'Efectivo' }, encodeURIComponent,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        console: { log() {}, error() {} },
    });
    const selected = [{ value: 'Muzza', getAttribute: () => 'clasico' }];
    c.context.document.querySelectorAll = () => selected;
    const calls = [];
    c.context.window.open = () => ({ document: { body: {} }, location: { set href(url) { calls.push(url); } }, close() {} });
    c.context.window.guardarPedidoFirebase = async data => { throw new Error('should not be called'); };
    vm.runInContext(between(web, 'async function enviarPedido(', '// Botones de cantidad'), c.context);
    await vm.runInContext("enviarPedido('efectivo')", c.context);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /verificando los precios/);
    assert.equal(c.context.window.PEDIDO_WEB_ENVIANDO, false);
});
test('Firebase writer never strips promotion when rules reject it; old-order fallback stays available', async () => {
    const calls = [];
    const ctx = vm.createContext({ window: {}, db: {}, serverTimestamp: () => 'now', collection: () => 'pedidos',
        addDoc: async (_, data) => { calls.push(data); throw { code: 'permission-denied' }; } });
    vm.runInContext(between(web, 'window.guardarPedidoFirebase =', '    </script>'), ctx);
    await assert.rejects(() => ctx.window.guardarPedidoFirebase({ total: 86000, descuento: 12000, porcentajeDescuento: 20 }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].descuento, 12000);
    assert.equal(calls[0].porcentajeDescuento, 20);
    calls.length = 0;
    await assert.rejects(() => ctx.window.guardarPedidoFirebase({ total: 98000, pago: 'efectivo', costoDelivery: 7000 }));
    assert.equal(calls.length, 3);
    assert.equal('descuento' in calls[0], false);
});
test('legacy order still saves and sends when no promotion is known and config is unavailable', async () => {
    const c = cart();
    c.context.window.DESCUENTO_WEB_LISTO = false;
    for (const [id, value] of Object.entries({ nombre: 'Test', direccion: 'Test street', celular: '0981123456', latitud: '1', longitud: '2', 'ubicacion-recogida': '1' })) c.element(id).value = value;
    const calls = { stored: [], messages: [], emails: [], alerts: [] };
    Object.assign(c.context, {
        alert: m => calls.alerts.push(m),
        normalizarCelularPY: () => '595981123456', formatearCelularPY: s => s,
        deliveryKm: 2, deliveryFuera: false,
        nombresTamano: { grande: 'Grande' }, nombresExtras: { papas: 'Papas', bebida: 'Gaseosa' },
        PAGOS_TXT: { efectivo: 'Efectivo' }, encodeURIComponent,
        fetch: (url, options) => { calls.emails.push(JSON.parse(options.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
        console: { log() {}, error() {} },
    });
    c.context.document.querySelectorAll = () => [{ value: 'Muzza', getAttribute: () => 'clasico' }];
    c.context.window.guardarPedidoFirebase = async data => { calls.stored.push(data); };
    c.context.window.open = () => ({ document: { body: {} }, location: { set href(url) { calls.messages.push(url); } }, close() {} });
    c.context.window.location = { assign: url => calls.messages.push(url) };
    vm.runInContext(between(web, 'async function enviarPedido(', '// Botones de cantidad'), c.context);
    await vm.runInContext("enviarPedido('efectivo')", c.context);
    assert.equal(calls.stored.length, 1);
    assert.equal(calls.stored[0].total, 98000);
    assert.equal('descuento' in calls.stored[0], false);
    assert.equal(calls.messages.length, 1);
    assert.match(calls.messages[0], /^https:\/\/wa\.me\//);
    assert.equal(calls.emails.length, 1);
    assert.equal(calls.alerts.length, 0);
    await vm.runInContext("enviarPedido('efectivo')", c.context);
    assert.equal(calls.stored.length, 2, 'a newly selected cart creates an independent order');
    assert.equal(calls.messages.length, 2);
    c.context.window.DESCUENTO_WEB = 20;
    await vm.runInContext("enviarPedido('efectivo')", c.context);
    assert.equal(calls.stored.length, 2, 'a known promotion with failed config must still fail closed');
    assert.equal(calls.messages.length, 2);
    assert.equal(calls.emails.length, 2);
    assert.equal(calls.alerts.length, 1);
});
for (const path of panels) {
    test(`${path}: promotion configuration is admin-only, merged, and receipt uses stored percentage`, async () => {
        const source = read(path);
        assert.match(source, /\['descuento', 'Descuento web'\]/);
        const calls = [];
        const ctx = vm.createContext({ adminActivo: () => true, doc: (...x) => x, db: {}, serverTimestamp: () => 'now',
            setDoc: async (...args) => calls.push(args), toast() {}, vistaDescuento() {} });
        vm.runInContext("let descuentoGuardando = false; let tab = 'descuento';", ctx);
        vm.runInContext(between(source, 'async function guardarDescuentoWeb(', '// ===== End web promotion'), ctx);
        await ctx.guardarDescuentoWeb(20);
        assert.equal(calls[0][1].descuentoWeb.porcentaje, 20);
        assert.equal(calls[0][2].merge, true);
        ctx.adminActivo = () => false;
        await ctx.guardarDescuentoWeb(25);
        assert.equal(calls.length, 1);
        ctx.adminActivo = () => true;
        await ctx.guardarDescuentoWeb(0);
        assert.equal(calls[1][1].descuentoWeb.activo, false);
        const ticket = between(source, 'function htmlTicket(', 'function imprimirTicket(');
        const ticketCtx = vm.createContext({ creadoMs: () => 0, gs: n => `${n} Gs`, esc: String,
            numeroCorto: () => '1', fechaCorta: () => 'today', NOMBRE_LOCAL: 'Mi Barrio', TIPOS: {}, PAGOS: {} });
        vm.runInContext(ticket, ticketCtx);
        const html = ticketCtx.htmlTicket({ total: 86000, descuento: 12000, porcentajeDescuento: 20, costoDelivery: 7000 }, false);
        assert.match(html, /DESCUENTO WEB 20%/);
        assert.match(html, /SUBTOTAL/);
        assert.match(html, /- 12000 Gs/);
        assert.doesNotMatch(ticketCtx.htmlTicket({ total: 98000 }, false), /DESCUENTO WEB/);
    });
}
test('rules allow bounded optional discount metadata without widening config access', () => {
    const rules = read('reglas_firestore (2).txt');
    assert.match(rules, /function descuentoWebValido\(\)/);
    assert.match(rules, /&& descuentoWebValido\(\)/);
    assert.match(rules, /'descuento', 'porcentajeDescuento'/);
    assert.match(rules, /allow write: if esAdmin\(\);/);
});
