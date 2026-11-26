import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { page } from './helpers/pagina-cliente.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
test('WhatsApp uses same-tab navigation without retaining a successful order', async () => {
    const p = page();
    p.context.window.open = () => { throw new Error('Popups blocked'); };
    p.run("seleccionarModalidad('retiro')");
    await p.run("enviarPedido('efectivo')");
    const first = p.urls[0];
    assert.match(first, /^https:\/\/wa\.me\//);
    assert.ok(decodeURIComponent(first).includes(p.sent[0].mensaje));
    const reload = page({ storage: p.storage });
    await reload.run('enviarPedido()');
    assert.equal(reload.urls.length, 0);
    assert.equal(reload.sent.length, 0);
    assert.equal(reload.emails.length, 0);
});
test('transfer details appear only for bank transfer and public summaries omit order references', async () => {
    for (const payment of ['efectivo', 'transferencia']) {
        const p = page();
        p.run("seleccionarModalidad('retiro')");
        await p.run(`enviarPedido('${payment}')`);
        const message = p.sent[0].mensaje;
        assert.doesNotMatch(message, /Referencia del pedido:/);
        assert.ok(p.sent[0].intentoId);
        if (payment === 'transferencia') {
            assert.match(message, /Alias:\* 5714284/);
            assert.match(message, /Silver Escobar/);
            assert.ok(message.endsWith('Esperamos su comprobante de pago.'));
        } else {
            assert.doesNotMatch(message, /5714284|Silver Escobar|comprobante de pago/);
        }
    }
});
test('uncertain save retries the immutable snapshot with the same ID after reload', async () => {
    const p = page();
    p.run("seleccionarModalidad('retiro')");
    let attempted;
    p.context.window.guardarPedidoFirebase = async data => { attempted = JSON.parse(JSON.stringify(data)); throw new Error('Lost acknowledgement'); };
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.urls.length, 0);
    assert.equal(p.emails.length, 0);
    assert.equal(p.get('btn-enviar').textContent, 'Reintentar el mismo pedido');
    const reload = page({ storage: p.storage });
    reload.get('nombre').value = 'Changed after failed save';
    await reload.run("enviarPedido('transferencia')");
    assert.equal(reload.sent.length, 1);
    assert.deepEqual(reload.sent[0], attempted);
    assert.ok(reload.sent[0].intentoId);
});
test('retry writer always targets the original document and never falls back to addDoc', async () => {
    const calls = [];
    const c = vm.createContext({ window: {}, db: {}, serverTimestamp: () => 'now',
        doc: (_, collection, id) => ({ id, collection }),
        setDoc: async (ref, data) => { calls.push({ ref, data }); throw { code: 'permission-denied' }; },
        addDoc: () => { throw new Error('A retry must not allocate another document'); } });
    vm.runInContext(section('        window.guardarPedidoFirebase =', '    </script>'), c);
    const data = { intentoId: 'web-retry-original-123', tipo: 'retiro', total: 10000, costoDelivery: 0 };
    await assert.rejects(() => c.window.guardarPedidoFirebase(data));
    await assert.rejects(() => c.window.guardarPedidoFirebase(data));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].ref.id, calls[1].ref.id);
});
test('a successful checkout clears the cart to prevent accidental repeated submission', async () => {
    const p = page();
    p.run("seleccionarModalidad('retiro')");
    await p.run("enviarPedido('efectivo')");
    p.context.document.querySelectorAll = () => [];
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
    assert.notEqual(p.get('btn-enviar').textContent, 'Ver pedido registrado');
    const reload = page({ storage: p.storage });
    await reload.run("enviarPedido('efectivo')");
    assert.equal(reload.sent.length, 0);
});
test('three visits can register three independent orders without releasing prior orders', async () => {
    const p = page();
    p.run("seleccionarModalidad('retiro')");
    await p.run("enviarPedido('efectivo')");
    const first = p.sent[0];
    const next = page({ storage: p.storage });
    next.get('nombre').value = 'Otro cliente';
    next.run("seleccionarModalidad('retiro')");
    await next.run("enviarPedido('transferencia')");
    assert.equal(next.sent.length, 1);
    assert.equal(next.sent[0].cliente.nombre, 'Otro cliente');
    assert.notEqual(next.sent[0].mensaje, first.mensaje);
    const third = page({ storage: next.storage });
    third.get('nombre').value = 'Tercer pedido';
    third.run("seleccionarModalidad('retiro')");
    await third.run("enviarPedido('efectivo')");
    assert.equal(third.sent.length, 1);
    assert.equal(third.sent[0].cliente.nombre, 'Tercer pedido');
});
test('legacy successful-order memory is discarded on page load', async () => {
    const p = page();
    p.run("seleccionarModalidad('retiro')");
    await p.run("enviarPedido('efectivo')");
    p.context.window.sessionStorage.setItem('mi-barrio.pedido-registrado', JSON.stringify({ id: 'old', mensaje: 'Old summary' }));
    const next = page({ storage: p.storage });
    next.run("seleccionarModalidad('retiro')");
    await next.run("enviarPedido('efectivo')");
    assert.equal(next.sent.length, 1);
    assert.notEqual(next.urls[0], 'Old summary');
});
function section(start, end) {
    const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return html.slice(a, b);
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
        }
        assert.equal(p.urls.length, 1);
        assert.match(p.urls[0], /^https:\/\/wa\.me\//);
    });
}
test('S4: disabling delivery charge keeps the coverage limit but charges zero', async () => {
    const p = page();
    p.context.window.DELIVERY_COBRAR = false;
    p.run("seleccionarModalidad('delivery')");
    p.gps[0].ok({ coords: { latitude: -25.46, longitude: -56.01 } });
    await p.run('calcularDelivery()');
    assert.equal(p.run('calcularTotal().totalGeneral'), 83000);
    assert.match(p.get('delivery-info').textContent, /sin cargo/);
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent[0].costoDelivery, 0);
    assert.equal(p.sent[0].total, 83000);
});
test('S4: disabled delivery charge still rejects addresses outside the coverage limit', async () => {
    const p = page();
    p.context.window.DELIVERY_COBRAR = false;
    p.setRoute(async () => ({ json: async () => ({ routes: [{ distance: 8000 }] }) }));
    p.run("seleccionarModalidad('delivery')");
    p.gps[0].ok({ coords: { latitude: -25.46, longitude: -56.01 } });
    await p.run('calcularDelivery()');
    assert.equal(p.get('btn-enviar').disabled, true);
    assert.match(p.get('delivery-info').textContent, /Zona no cubierta/);
});
test('S4: applying config with deliveryCobrar false zeroes the cost immediately', async () => {
    const p = page();
    p.run("seleccionarModalidad('delivery')");
    p.gps[0].ok({ coords: { latitude: -25.46, longitude: -56.01 } });
    await p.run('calcularDelivery()');
    assert.equal(p.run('calcularTotal().totalGeneral'), 88000);
    p.run('window.aplicarDeliveryCliente({ deliveryCobrar: false, delivery: [{ max: 2, costo: 6000 }] })');
    assert.equal(p.run('calcularTotal().totalGeneral'), 83000);
    p.run('window.aplicarDeliveryCliente({ deliveryCobrar: true, delivery: [{ max: 2, costo: 6000 }] })');
    assert.equal(p.run('calcularTotal().totalGeneral'), 89000);
});
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
    assert.equal(p.opened.length, 0);
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
    assert.equal(p.opened.length, 0);
    assert.equal(p.emails.length, 0);
    p.context.window.guardarPedidoFirebase = save;
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
    assert.equal(p.urls.length, 1);
    assert.match(p.urls[0], /^https:\/\/wa\.me\//);
    assert.equal(p.emails.length, 1);
});
test('S1-S4: QR tables retain their existing no-modality/no-GPS flow and discount', async () => {
    const p = page();
    p.context.window.MESA_ACTUAL = 3;
    p.run('actualizarBotonEnviar()');
    assert.equal(p.get('btn-enviar').disabled === true, false);
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
    assert.equal('tipo' in p.sent[0], false);
    assert.equal(p.sent[0].costoDelivery, 0);
    assert.equal(p.sent[0].descuento, 15000);
    assert.match(p.sent[0].mensaje, /Mesa 3/);
    assert.equal(p.gps.length, 0);
    assert.equal(p.mapCount(), 0);
});
