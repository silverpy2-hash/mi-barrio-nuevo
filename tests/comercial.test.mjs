import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const M = createRequire(import.meta.url)('../comercial/motor.js');
const menu = { sabores: { clasico: ['Muzza'], especial: ['Bacon'], gourmet: ['Suprema'] } };
const now = Date.parse('2026-11-28T22:00:00-03:00');
function config() {
    const c = M.defaults(); c.desde = now - 86400000; c.revision = 'v1'; c.aceiteGramosPorMl = 0.9;
    c.insumos.find(x => x.id === 'agua').precio = 0;
    c.recetas = [{ tipo: 'base', clave: 'mediano', completa: true, ingredientes: { masa: 250, muzzarella: 130, salsa: 20 } },
        { tipo: 'sabor', clave: 'Muzza', completa: true, ingredientes: {} },
        { tipo: 'envase', clave: 'retiro:mediano', completa: true, ingredientes: { 'caja-chica': 1 } }];
    return c;
}
function order(override = {}) {
    return { id: 'p1', creado: now, estado: 'entregado', tipo: 'retiro', origen: 'panel', total: 30000, descuento: 0, costoDelivery: 0,
        pagado: true, pago: 'efectivo', cliente: { celular: '595981123456' }, pizzas: [{ tamano: 'mediano', nombre: 'Mediana', categoria: 'clasico', sabores: ['Muzza'], borde: false, precio: 30000 }], extras: [], ...override };
}
const frozen = (p = order(), c = config()) => M.freeze(p, c, menu, now);

test('integer discount allocation never loses a guaraní', () => {
    for (let n = 0; n < 1000; n++) {
        const shares = M.allocate(n, [60001, 75000, 12001, 0]);
        assert.equal(shares.reduce((a, b) => a + b, 0), n);
        assert.ok(shares.every(Number.isInteger)); assert.equal(shares[3], 0);
    }
});
test('sales reconcile pizza + extras + delivery - configured order discount', () => {
    const p = order({ total: 37000, descuento: 6000, porcentajeDescuento: 20, costoDelivery: 5000,
        extras: [{ item: 'Coca', cantidad: 1, precioUnitario: 8000 }] });
    const s = frozen(p), r = M.report([s]);
    assert.equal(s.brutoProductos, 38000); assert.equal(s.bruto, 43000);
    assert.equal(s.lineas[0].descuento, 6000); assert.equal(s.lineas[1].descuento, 0);
    assert.equal(s.lineas.reduce((n, l) => n + l.neto, 0) + s.delivery, s.total);
    assert.equal(r.brutas - r.descuentos, r.netas);
});
test('unpriced historical extras remain an explicit reconciling amount, never priced using current menu', () => {
    const p = order({ total: 38000, extras: [{ item: 'Coca', cantidad: 1 }] });
    const s = frozen(p); assert.equal(s.lineas.at(-1).bruto, 8000);
    assert.equal(s.lineas.reduce((n, l) => n + l.neto, 0), s.total);
    assert.equal(s.costosCompletos, false); assert.match(s.advertencias.join(' '), /sin precio histórico/);
});
test('gifts count as production without fictitious retail revenue', () => {
    const p = order({ total: 60000, pizzas: [{ tamano: 'grande', nombre: 'Pizza Grande + Mediana muzza gratis', sabores: ['Muzza'], precio: 60000 }] });
    const r = M.report([frozen(p)]); assert.equal(r.pizzas, 2); assert.equal(r.regalos, 1); assert.equal(r.netas, 60000);
    assert.equal(r.sabores.Muzza, 2);
});
test('payment method alone never means collected; cancelled paid orders retain the cash/refund trail', () => {
    const unpaid = frozen(order({ id: 'unpaid', pagado: false }));
    const cancelled = frozen(order({ id: 'cancel', estado: 'cancelado' })); cancelled.meta = { reembolso: 10000, medioReembolso: 'efectivo', elaborado: true };
    const r = M.report([unpaid, cancelled]); assert.equal(r.netas, 30000); assert.equal(r.cobrado, 30000); assert.equal(r.pendiente, 30000); assert.equal(r.cancelados, 1);
    assert.equal(r.pizzas, 2); assert.equal(M.cash([unpaid, cancelled], [], 5000).esperado, 25000);
});
test('cash expenses by transfer do not drain the drawer; purchases are not COGS', () => {
    const s = frozen(); const expenses = [{ monto: 5000, clase: 'variable', medio: 'efectivo' }, { monto: 12000, clase: 'compra', medio: 'transferencia' }];
    const r = M.report([s], expenses); assert.equal(r.gastosOperativos, 5000); assert.equal(r.compras, 12000);
    assert.equal(r.resultadoConocido, 30000 - s.costoConocido - 5000);
    assert.equal(r.flujo, 13000); assert.equal(M.cash([s], expenses, 10000).esperado, 35000);
});
test('a real delivery cost is accrual only unless separately paid as an expense', () => {
    const s = frozen(); s.meta.costoReparto = 6000;
    const r = M.report([s]); assert.equal(r.costoReparto, 6000); assert.equal(r.flujo, 30000); assert.equal(M.cash([s], [], 0).esperado, 30000);
});
test('new cost versions do not revalue existing lines, closed orders, recipes or business days', () => {
    const c = config(), p = order(), s = frozen(p, c), original = structuredClone(s);
    const changed = structuredClone(c); changed.insumos.forEach(i => i.precio = 999999); changed.corte = 9;
    assert.deepEqual(M.view(p, s, changed, menu).lineas, original.lineas);
    s.cierreId = 'c1'; s.gastosCertificados = true;
    assert.deepEqual(M.view({ ...p, total: 1 }, s, changed, menu), s);
    const newLine = { ...p.pizzas[0], sabores: ['Bacon'] };
    const revised = M.freeze({ ...p, total: 60000, pizzas: [...p.pizzas, newLine] }, changed, menu, now + 1, original);
    assert.deepEqual(revised.lineas[0].costos, original.lineas[0].costos);
    assert.equal(revised.jornada, original.jornada);
});
test('missing density, sauce, recipes, purchase prices or historical applicability suppress net profit', () => {
    for (const mutate of [c => c.aceiteGramosPorMl = null, c => c.recetas[0].ingredientes.salsa = null,
        c => c.insumos[0].precio = null, c => c.desde = now + 1, c => c.recetas[0].completa = false]) {
        const c = config(); mutate(c); const s = frozen(order(), c); s.gastosCertificados = true;
        assert.equal(s.costosCompletos, false); assert.equal(M.report([s]).gananciaNeta, null);
    }
});
test('confirmed complete closed costs allow net profit and break-even without double-counting purchase', () => {
    const s = frozen(); assert.equal(s.costosCompletos, true); s.gastosCertificados = true;
    const r = M.report([s], [{ clase: 'fijo', monto: 1000 }]); assert.equal(r.gananciaNeta, 30000 - s.costoConocido - 1000); assert.ok(r.equilibrio > 0);
    assert.equal(M.report([s], [], { canal: 'tpv' }).gananciaNeta, null);
});
test('Paraguay jornada uses an explicit cutoff, regardless of machine timezone and year rollover', () => {
    assert.equal(M.day(Date.parse('2026-11-28T02:30:00-03:00'), 5), '2026-11-27');
    assert.equal(M.day(Date.parse('2026-11-28T05:00:00-03:00'), 5), '2026-11-28');
    assert.equal(M.day(Date.parse('2027-01-01T00:30:00-03:00'), 5), '2026-12-31');
    assert.equal(M.day(null), null);
});
test('unknown origin remains unknown; explicit QR/web/WhatsApp are independent from modality', () => {
    assert.equal(M.channel({}), 'sin-identificar'); assert.equal(M.channel({ origen: 'web', tipo: 'retiro' }), 'web');
    assert.equal(M.channel({ origen: 'qr', mesa: 1 }), 'qr'); assert.equal(M.channel({ origen: 'panel', canalComercial: 'whatsapp' }), 'whatsapp');
});
test('deduplication prevents multiplying the same order, promotions overlap explicitly', () => {
    const s = frozen(order({ descuento: 1000, total: 29000, tipo: 'delivery' }));
    const r = M.report([s, s]); assert.equal(r.ventas, 1); assert.equal(r.netas, 29000); assert.equal(r.promociones.length, 2);
});
test('stock distinguishes physical observations, theoretical usage, signed losses and missing recipes', () => {
    const c = config(), s = frozen();
    const inv = M.stock([{ insumo: 'muzzarella', cantidad: 1000, tipo: 'compra' }, { insumo: 'muzzarella', cantidad: -20, tipo: 'merma' },
        { insumo: 'muzzarella', cantidad: 0, tipo: 'conteo', fisico: 700, creado: now }], [s], c);
    const cheese = inv.find(x => x.id === 'muzzarella'); assert.equal(cheese.movimientos, 980); assert.equal(cheese.consumo, 130); assert.equal(cheese.disponibleTeorico, 850); assert.equal(cheese.ultimoConteo.fisico, 700);
    assert.equal(M.capacity({ completo: false, consumo: [] }, inv), null);
});
test('CSV is UTF8 BOM, stable semicolon quoting, and formula-injection safe', () => {
    const csv = M.csv([{ nombre: '=HYPERLINK("evil")', total: -20, nota: 'a;b\nc' }], ['nombre', 'total', 'nota']);
    assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('"-20"')); assert.ok(csv.includes('"a;b\nc"'));
});
test('configuration validates IDs, duplicates, quantities and nullable unknown costs', () => {
    const c = config(); assert.equal(M.validateConfig(c), c); c.recetas[0].ingredientes.inventado = 3;
    assert.throws(() => M.validateConfig(c), /desconocido/);
});
test('dated cash flow uses collection date, not original sale date; unknown dates stay unknown', () => {
    const p = order({ creado: Date.parse('2026-11-26T22:00:00-03:00'), cobradoEn: Date.parse('2026-11-28T22:00:00-03:00') });
    const s = frozen(p);
    const saleDay = M.report([s], [], { desde: '2026-11-26', hasta: '2026-11-26' });
    const cashDay = M.report([s], [], { desde: '2026-11-28', hasta: '2026-11-28' });
    assert.equal(saleDay.netas, 30000); assert.equal(saleDay.cobrado, 0);
    assert.equal(cashDay.netas, 0); assert.equal(cashDay.cobrado, 30000);
    const unknown = frozen(order({ creado: p.creado }));
    const legacy = M.report([unknown], [], { desde: '2026-11-26', hasta: '2026-11-26' });
    assert.equal(legacy.cobrado, 0); assert.equal(legacy.cobrosSinFecha, 30000);
});
test('paying already assigned distribution cost changes cash, not production margin twice', () => {
    const s = frozen(); s.meta.costoReparto = 6000;
    const r = M.report([s], [{ monto: 6000, medio: 'efectivo', clase: 'pago-reparto' }]);
    assert.equal(r.costoReparto, 6000); assert.equal(r.gastosOperativos, 0); assert.equal(r.flujo, 24000);
    assert.equal(r.resultadoConocido, 30000 - s.costoConocido - 6000);
});
test('a historical expense without payment method is not silently assumed to be cash', () => {
    const cash = M.cash([frozen()], [{ monto: 4000, clase: 'variable' }], 10000);
    assert.equal(cash.gastosSinMedio, 4000); assert.equal(cash.gastosEfectivo, 0);
});
test('mixed recipes and missing historical category never claim complete costs', () => {
    const p = order(); p.pizzas[0].sabores.push('Bacon');
    const c = config(); c.recetas.push({ tipo: 'sabor', clave: 'Bacon', completa: true, ingredientes: {} });
    assert.equal(frozen(p, c).costosCompletos, false);
    const unknown = order(); delete unknown.pizzas[0].categoria;
    assert.equal(frozen(unknown).lineas[0].categoria, 'sin-identificar');
    assert.equal(frozen(unknown).costosCompletos, false);
});
test('server timestamp resolves provisional creation date without revaluing cost snapshots', () => {
    const p = order(), s = frozen(p); s.fechaPendiente = true;
    const server = { ...p, creado: p.creado + 86400000 };
    const resolved = M.view(server, s, config(), menu);
    assert.equal(resolved.fechaPendiente, false); assert.equal(resolved.jornada, M.day(server.creado, s.corte));
    assert.deepEqual(resolved.lineas[0].costos, s.lineas[0].costos);
});
test('all inline scripts and commercial scripts parse without external services', () => {
    for (const path of ['panel_nuevo.html', 'mi-barrio-tpv-celular/index.html', 'index.html']) {
        const html = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (/src=|application\/ld\+json/.test(match[1])) continue;
            new vm.Script(match[2].replace(/^\s*import\s+.*?;\s*$/gm, ''));
        }
    }
    for (const path of ['comercial/motor.js', 'comercial/panel.js']) new vm.Script(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
});
