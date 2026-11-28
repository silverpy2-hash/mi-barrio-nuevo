import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const file of ['panel_nuevo.html', 'mi-barrio-tpv-celular/index.html']) {
    const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const section = (start, end) => {
        const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
        assert.ok(a >= 0 && b > a, start);
        return html.slice(a, b);
    };
    function panel(cobrar) {
        const elements = new Map();
        const get = id => {
            if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '' });
            return elements.get(id);
        };
        const c = vm.createContext({
            localCfg: { deliveryCobrar: cobrar, delivery: [{ max: 2, costo: 5000 }, { max: 4, costo: 9000 }] },
            nuevo: { tipo: 'delivery', envio: 0, envioManual: false, pizzas: [{ precio: 50000 }], extras: {}, sabores: [] },
            MENU: { extras: [] }, $: get, gs: n => String(n), clsOn: 'on', clsOff: 'off',
            renderNuevoTotal() {}, esDelivery: false,
            linkMaps: value => value, coordsDeMaps: () => null, waNumero: value => value,
            nuevoMsg: (id, message) => { get(id).textContent = message; }
        });
        vm.runInContext(section('        function tramosDelivery()', '        function programarDeliveryNuevo()'), c);
        vm.runInContext(section('        function nuevoTotales()', '        function nuevoMsg('), c);
        // Execute the actual save validation before its first payload construction/write.
        vm.runInContext(section('        async function guardarNuevo()', '            const pizzas = n.pizzas.map') +
            '\nreturn { env, total };\n}', c);
        get('nuevo-direccion').value = 'https://maps.google.com/?q=-25.46,-56.01';
        return { c, get, run: code => vm.runInContext(code, c) };
    }
    for (const cobrar of [false, true]) {
        test(`${file}: manual delivery charges tiers and validates totals with web charge ${cobrar}`, async () => {
            const p = panel(cobrar);
            p.run('aplicarCostoDelivery(1.5)');
            assert.equal(p.c.nuevo.envio, 5000);
            assert.match(p.get('nuevo-delivery-info').textContent, /5000/);
            assert.match(p.get('nuevo-envio').innerHTML, /data-n-envio="5000"/);
            const validated = await p.run('guardarNuevo()');
            assert.equal(validated.env, 5000);
            assert.equal(validated.total, 55000);
            p.run('aplicarCostoDelivery(3)');
            assert.equal(p.c.nuevo.envio, 9000);
            assert.equal(p.run('nuevoTotales().total'), 59000);
            p.c.nuevo.envio = 0;
            assert.equal(await p.run('guardarNuevo()'), undefined);
            assert.match(p.get('nuevo-error').textContent, /todavía no tiene costo/);
        });
    }
    test(`${file}: web free delivery does not clear manual tier selection or coverage rejection`, async () => {
        const p = panel(false);
        p.c.nuevo.envioManual = true;
        p.c.nuevo.envio = 9000;
        p.run('aplicarCostoDelivery(1.5)');
        assert.equal(p.c.nuevo.envio, 9000);
        p.run('aplicarCostoDelivery(8)');
        assert.equal(p.c.nuevo.deliveryFuera, true);
        assert.match(p.get('nuevo-delivery-info').textContent, /Zona no cubierta/);
        assert.equal(await p.run('guardarNuevo()'), undefined);
        assert.match(p.get('nuevo-error').textContent, /Zona no cubierta/);
        p.c.nuevo.tipo = 'retiro';
        assert.equal(p.run('nuevoTotales().env'), 0);
    });
}
