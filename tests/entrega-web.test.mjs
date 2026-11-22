import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
function section(start, end) {
    const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return html.slice(a, b);
}
function page() {
    const nodes = new Map(), gps = [], sent = [], urls = [], emails = [], alerts = [];
    const get = id => {
        if (!nodes.has(id)) {
            const classes = new Set(['hidden']);
            nodes.set(id, { value: '', textContent: '', innerText: '', innerHTML: '', disabled: false,
                classList: { add: (...x) => x.forEach(v => classes.add(v)), remove: (...x) => x.forEach(v => classes.delete(v)), contains: x => classes.has(x), toggle(x, on) { const yes = on ?? !classes.has(x); yes ? classes.add(x) : classes.delete(x); } },
                setAttribute(k, v) { this[k] = v; }, scrollIntoView() {} });
        }
        return nodes.get(id);
    };
    for (const [id, value] of Object.entries({ nombre: 'Cliente prueba', celular: '0981123456', direccion: 'Dirección de prueba' })) get(id).value = value;
    let mapCount = 0, route = async () => ({ json: async () => ({ routes: [{ distance: 1000 }] }) });
    const events = {}, markerEvents = {};
    const map = { setView() { return this; }, invalidateSize() { return this; }, on(name, fn) { events[name] = fn; return this; } };
    let markerCoords = { lat: -25.46, lng: -56.01 };
    const marker = { addTo() { return this; }, setLatLng(v) { markerCoords = Array.isArray(v) ? { lat: v[0], lng: v[1] } : v; return this; }, on(name, fn) { markerEvents[name] = fn; return this; }, getLatLng: () => markerCoords };
    const timers = new Map(); let timer = 0;
    const context = vm.createContext({
        window: { MESA_ACTUAL: null, DESCUENTO_WEB: 20, DESCUENTO_WEB_LISTO: true,
            guardarPedidoFirebase: async d => { sent.push(JSON.parse(JSON.stringify(d))); },
            open: () => ({ document: { body: {} }, location: { set href(u) { urls.push(u); } }, close() {} }) },
        document: { getElementById: get, querySelectorAll: () => [{ value: 'Muzza', getAttribute: () => 'clasico' }] },
        navigator: { geolocation: { getCurrentPosition: (ok, fail) => gps.push({ ok, fail }) } },
        L: { map: () => { mapCount++; return map; }, tileLayer: () => ({ addTo() {} }), marker: () => marker },
        AbortController, setTimeout: (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; }, clearTimeout: id => timers.delete(id),
        fetch: (url, options) => url.includes('router.project-osrm.org') ? route() : (emails.push(JSON.parse(options.body)), Promise.resolve({ ok: true, json: async () => ({}) })),
        alert: x => alerts.push(x), console: { log() {}, error() {} },
        obtenerTamanoSeleccionado: () => 'grande', matrizPrecios: { grande: { clasico: 60000 } },
        adicionales: { 'borde-piz': 1, papas: 1, bebida: 1 }, preciosAdicionales: { papas: 15000, bebida: 8000 },
        precioBorde: () => 15000, pedido: [], nombresTamano: { grande: 'Grande' }, nombresExtras: { papas: 'Papas', bebida: 'Gaseosa' },
        PAGOS_TXT: { efectivo: 'Efectivo', transferencia: 'Transferencia' }, encodeURIComponent,
    });
    vm.runInContext(section('        let map;', '        // ===== Ingredientes'), context);
    vm.runInContext(section('        function calcularTotal()', '        // Celular de Paraguay'), context);
    vm.runInContext(section('        function normalizarCelularPY(', '        // Botones de cantidad'), context);
    return { context, get, gps, sent, urls, emails, alerts, events, marker, markerEvents, mapCount: () => mapCount,
        run: s => vm.runInContext(s, context), setRoute: fn => { route = fn; } };
}

test('S1: nothing selected initially; pickup neither initializes map nor asks for GPS', () => {
    const p = page();
    assert.equal(p.context.window.MODALIDAD_PEDIDO, null);
    assert.equal(p.mapCount(), 0);
    p.run('actualizarBotonEnviar()');
    assert.equal(p.get('btn-enviar').disabled, true);
    p.run("seleccionarModalidad('retiro')");
    assert.equal(p.mapCount(), 0);
    assert.equal(p.gps.length, 0);
    assert.equal(p.get('datos-delivery').classList.contains('hidden'), true);
    assert.equal(p.get('btn-enviar').disabled, false);
    assert.equal(p.get('modalidad-retiro')['aria-pressed'], 'true');
});
test('S2: delivery opens map/GPS; manual placement survives late GPS; current route enables send', async () => {
    const p = page();
    p.run("seleccionarModalidad('delivery')");
    assert.equal(p.mapCount(), 1);
    assert.equal(p.gps.length, 1);
    assert.equal(p.get('datos-delivery').classList.contains('hidden'), false);
    p.events.click({ latlng: { lat: -25.46, lng: -56.01 } });
    assert.equal(p.get('btn-enviar').disabled, true);
    p.gps[0].ok({ coords: { latitude: 20, longitude: 30 } });
    assert.equal(Number(p.get('latitud').value), -25.46);
    await p.run('calcularDelivery()');
    assert.equal(p.get('btn-enviar').disabled, false);
    p.run('recogerUbicacionObligatoria()');
    assert.equal(p.gps.length, 2);
    p.gps[1].fail({ code: 1 });
    assert.equal(p.get('btn-recoger-ubicacion').disabled, false);
    p.events.click({ latlng: { lat: -25.47, lng: -56.02 } });
    await p.run('calcularDelivery()');
    assert.equal(p.get('btn-enviar').disabled, false);
});
test('S2-S4: pending delivery callbacks cannot add cost/location after switching to pickup', async () => {
    const p = page();
    p.run("seleccionarModalidad('delivery')");
    p.gps[0].ok({ coords: { latitude: -25.46, longitude: -56.01 } });
    let resolve;
    p.setRoute(() => new Promise(r => { resolve = r; }));
    const pending = p.run('calcularDelivery()');
    p.run("seleccionarModalidad('retiro')");
    resolve({ json: async () => ({ routes: [{ distance: 4000 }] }) });
    await pending;
    p.gps[0].ok({ coords: { latitude: 30, longitude: 40 } });
    assert.equal(p.get('latitud').value, '');
    assert.equal(p.run('calcularTotal().totalGeneral'), 83000);
    assert.equal(p.get('btn-enviar').disabled, false);
});
for (const tipo of ['retiro', 'delivery']) {
    test(`S3-S4: ${tipo} persists its type and identical pizza-only discount in total/message/email`, async () => {
        const p = page();
        p.run(`seleccionarModalidad('${tipo}')`);
        if (tipo === 'delivery') {
            p.gps[0].ok({ coords: { latitude: -25.46, longitude: -56.01 } });
            await p.run('calcularDelivery()');
        }
        await p.run("enviarPedido('efectivo')");
        assert.equal(p.sent.length, 1);
        const d = p.sent[0];
        assert.equal(d.tipo, tipo);
        assert.equal(d.descuento, 15000);
        assert.equal(d.porcentajeDescuento, 20);
        assert.equal(d.costoDelivery, tipo === 'retiro' ? 0 : 5000);
        assert.equal(d.total, tipo === 'retiro' ? 83000 : 88000);
        assert.match(d.mensaje, tipo === 'retiro' ? /Retiro en el local/ : /Delivery/);
        if (tipo === 'retiro') {
            assert.equal(d.cliente.lat, null);
            assert.equal(d.cliente.mapa, '');
            assert.equal(d.cliente.direccion, '');
            assert.equal(d.distanciaKm, null);
            assert.doesNotMatch(d.mensaje, /maps\.google|Dirección:/);
            assert.equal(p.emails[0].ubicacion_gps, '');
        }
        assert.equal(p.urls.length, 1);
        assert.equal(p.emails[0].pedido, d.mensaje);
        assert.equal(p.run('window.PEDIDO_WEB_ENVIANDO'), false);
    });
}
test('S3: typed web writes never lose modality on permission failure; legacy writer is preserved', async () => {
    const attempts = [];
    const c = vm.createContext({ window: {}, db: {}, serverTimestamp: () => 'now', collection: () => 'pedidos',
        addDoc: async (_, d) => { attempts.push(d); throw { code: 'permission-denied' }; } });
    vm.runInContext(section('        window.guardarPedidoFirebase =', '    </script>'), c);
    await assert.rejects(() => c.window.guardarPedidoFirebase({ tipo: 'retiro', total: 10000, costoDelivery: 0 }));
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].tipo, 'retiro');
    attempts.length = 0;
    await assert.rejects(() => c.window.guardarPedidoFirebase({ total: 10000, pago: 'efectivo' }));
    assert.equal(attempts.length, 3);
});
test('S2-S3: pending save freezes map selection as well as coordinates and duplicate submission', async () => {
    const p = page();
    p.run("seleccionarModalidad('delivery')");
    p.gps[0].ok({ coords: { latitude: -25.46, longitude: -56.01 } });
    await p.run('calcularDelivery()');
    let release;
    p.context.window.guardarPedidoFirebase = d => { p.sent.push(d); return new Promise(r => { release = r; }); };
    const pending = p.run("enviarPedido('efectivo')");
    try {
        await p.run("enviarPedido('efectivo')");
        assert.equal(p.sent.length, 1);
        p.run('recogerUbicacionObligatoria()');
        assert.equal(p.gps.length, 1);
        p.events.click({ latlng: { lat: -25.48, lng: -56.03 } });
        assert.equal(p.marker.getLatLng().lat, -25.46);
        p.marker.setLatLng([-25.49, -56.04]);
        p.markerEvents.dragend();
        assert.equal(p.marker.getLatLng().lat, Number(p.get('latitud').value));
        assert.equal(p.marker.getLatLng().lng, Number(p.get('longitud').value));
    } finally {
        release();
        await pending;
    }
});
test('S3: rules admit only public delivery/pickup types, never waiter-local orders', () => {
    for (const path of ['reglas_firestore (2).txt', 'tpv-push-backend/firestore.rules.proposed.txt']) {
        const rules = read(path);
        assert.match(rules, /function tipoWebValido\(\)/);
        assert.match(rules, /d\.tipo in \['delivery', 'retiro'\]/);
        assert.match(rules, /d\.costoDelivery == 0/);
        assert.match(rules, /&& tipoWebValido\(\)/);
    }
});
test('S1: unselected order is rejected without stored data or messages', async () => {
    const p = page();
    const before = JSON.stringify(p.sent);
    await p.run("enviarPedido('efectivo')");
    assert.equal(JSON.stringify(p.sent), before);
    assert.equal(p.urls.length, 0);
    assert.equal(p.emails.length, 0);
    assert.equal(p.alerts.length, 1);
    assert.equal(p.context.window.MODALIDAD_PEDIDO, null);
});
test('S3: denied pickup save sends nothing and allows a successful retry', async () => {
    const p = page();
    p.run("seleccionarModalidad('retiro')");
    const save = p.context.window.guardarPedidoFirebase;
    p.context.window.guardarPedidoFirebase = async () => { throw { code: 'permission-denied' }; };
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 0);
    assert.equal(p.urls.length, 0);
    assert.equal(p.emails.length, 0);
    assert.equal(p.context.window.PEDIDO_WEB_ENVIANDO, false);
    p.context.window.guardarPedidoFirebase = save;
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
    assert.equal(p.urls.length, 1);
    assert.equal(p.emails.length, 1);
});
test('S1-S4: QR tables retain their existing no-modality/no-GPS flow and discount', async () => {
    const p = page();
    p.context.window.MESA_ACTUAL = 3;
    p.run('actualizarBotonEnviar()');
    assert.equal(p.get('btn-enviar').disabled, false);
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
    assert.equal('tipo' in p.sent[0], false);
    assert.equal(p.sent[0].costoDelivery, 0);
    assert.equal(p.sent[0].descuento, 15000);
    assert.match(p.sent[0].mensaje, /Mesa 3/);
    assert.equal(p.gps.length, 0);
    assert.equal(p.mapCount(), 0);
});
