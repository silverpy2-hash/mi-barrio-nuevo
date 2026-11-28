import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('../comercial/motor.js');
globalThis.window = { MBComercial: M };
const source = readFileSync(new URL('../comercial/firebase.js', import.meta.url), 'utf8');
const { commercialStore } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const now = Date.now();
const order = (id = 'p1', extra = {}) => ({ id, creado: now, estado: 'entregado', pagado: true, pago: 'efectivo', tipo: 'retiro', origen: 'panel', total: 30000,
    pizzas: [{ tamano: 'mediano', nombre: 'Mediana', precio: 30000, sabores: ['Muzza'] }], extras: [], ...extra });
function store(initial = {}, authorized = true) {
    const docs = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)])), versions = new Map(); let counter = 0;
    const api = { db: {}, collection: (_, path) => ({ path }),
        doc: (db, ...parts) => { const path = parts.length ? parts.join('/') : db.path + '/auto-' + ++counter; return { path, id: path.split('/').at(-1) }; },
        serverTimestamp: () => now, query() {}, orderBy() {}, documentId() {}, startAfter() {}, limit() {}, getDocs() {}, onSnapshot() {},
        runTransaction: async (_, callback) => {
            for (let attempt = 0; attempt < 5; attempt++) {
                const reads = new Map(), writes = []; let writing = false;
                const tx = {
                    async get(ref) {
                        assert.equal(writing, false, 'all reads must precede all writes'); reads.set(ref.path, versions.get(ref.path) || 0);
                        const value = docs.has(ref.path) ? structuredClone(docs.get(ref.path)) : null;
                        return { exists: () => value !== null, data: () => structuredClone(value), ref, id: ref.id };
                    },
                    set(ref, data, opts) { writing = true; writes.push([ref.path, structuredClone(data), opts?.merge]); },
                    update(ref, data) { writing = true; assert.ok(docs.has(ref.path)); writes.push([ref.path, structuredClone(data), true]); }
                };
                const result = await callback(tx);
                if ([...reads].some(([path, v]) => v !== (versions.get(path) || 0))) continue;
                for (const [path, value, merge] of writes) { docs.set(path, merge ? { ...docs.get(path), ...value } : value); versions.set(path, (versions.get(path) || 0) + 1); }
                return result;
            }
            throw Error('Too much contention');
        }
    };
    const adapter = commercialStore(api, { admin: () => authorized, uid: () => 'admin', email: () => 'admin@example.test', menu: () => ({ sabores: { clasico: ['Muzza'] } }) });
    return { adapter, api, docs };
}
function initial() { return { 'pedidos/p1': order(), 'config/contador': { ultimo: 42, cierres: 0, fondo: 10000 } }; }
const closeArgs = () => ({ ids: ['p1'], expenseIds: [], counted: 40000, opening: 10000, expectedOrders: [order()] });
test('atomic close stores immutable economics, links orders and keeps numbering monotonic', async () => {
    const { adapter, docs } = store(initial());
    const result = await adapter.close(closeArgs());
    assert.equal(docs.get('pedidos/p1').estado, 'archivado'); assert.equal(docs.get('pedidos/p1').cierreId, result.id);
    assert.equal(docs.get('comercial_pedidos/p1').cierreId, result.id); assert.equal(result.close.total, 30000);
    assert.equal(result.close.efectivoEsperado, 40000); assert.equal(result.close.diferencia, 0);
    assert.equal(docs.get('config/contador').ultimo, 42); assert.equal(docs.get('config/contador').fondo, 0);
    const before = JSON.stringify(docs.get('comercial_pedidos/p1'));
    await assert.rejects(adapter.meta('p1', { costoReparto: 1 }), /no se puede reescribir/);
    assert.equal(JSON.stringify(docs.get('comercial_pedidos/p1')), before);
});
test('two concurrent terminals cannot account for one order in two closes', async () => {
    const { adapter, docs } = store(initial());
    const outcomes = await Promise.allSettled([adapter.close(closeArgs()), adapter.close(closeArgs())]);
    assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal([...docs.keys()].filter(k => k.startsWith('cierres/')).length, 1);
    assert.equal(docs.get('config/contador').cierres, 1);
});
test('stale total, payment, fund, duplicate close or unpaid delivery fails before any write', async () => {
    for (const mutate of [
        x => x['pedidos/p1'].total = 50000, x => x['pedidos/p1'].pagado = false,
        x => x['pedidos/p1'].cierreId = 'other', x => x['config/contador'].fondo = 15000,
        x => x['pedidos/p1'].estado = 'en_camino', x => x['pedidos/p1'].pago = null
    ]) {
        const data = initial(); mutate(data); const { adapter, docs } = store(data); const before = JSON.stringify([...docs]);
        await assert.rejects(adapter.close(closeArgs())); assert.equal(JSON.stringify([...docs]), before);
    }
});
test('expenses close exactly once and transfers leave drawer intact', async () => {
    const data = initial(); data['gastos/g1'] = { monto: 5000, concepto: 'Luz', clase: 'fijo', medio: 'transferencia', cierreId: null, creado: now };
    const { adapter, docs } = store(data); const result = await adapter.close({ ...closeArgs(), expenseIds: ['g1'] });
    assert.equal(result.close.totalGastos, 5000); assert.equal(result.close.efectivoEsperado, 40000);
    assert.equal(docs.get('gastos/g1').cierreId, result.id);
});
test('configuration version CAS prevents overwriting changes from another terminal', async () => {
    const { adapter, docs } = store(); const c = M.defaults(); const saved = await adapter.saveConfig(c, '');
    assert.equal(docs.get('comercial_config/' + saved.revision).revision, saved.revision);
    await assert.rejects(adapter.saveConfig(c, ''), /Otra terminal/);
    const changedUnit = structuredClone(saved); changedUnit.insumos[0].unidad = 'unidad';
    await assert.rejects(adapter.saveConfig(changedUnit, saved.revision), /cambiar unidad/);
});
test('purchase and inventory entry are committed together, not double-counted as consumption', async () => {
    const { adapter, docs } = store(); const c = await adapter.saveConfig(M.defaults(), '');
    const movement = await adapter.movement({ insumo: 'muzzarella', cantidad: 1000, tipo: 'compra', monto: 38000, medio: 'transferencia', motivo: 'Factura' }, c);
    assert.ok(movement.gasto); assert.equal(docs.get('gastos/' + movement.gasto.id).clase, 'compra');
    assert.equal(docs.get('comercial_stock/' + movement.id).gastoId, movement.gasto.id);
});
test('all private storage operations require admin access', async () => {
    const { adapter } = store({}, false);
    await assert.rejects(adapter.capture('p1'), /administrativo/);
    await assert.rejects(adapter.close(closeArgs()), /administrativo/);
    await assert.rejects(adapter.saveConfig(M.defaults(), ''), /administrativo/);
});
test('waste freezes a non-cash cost, affects results but not drawer or paid purchases', async () => {
    const { adapter, docs } = store(initial()); const c = await adapter.saveConfig(M.defaults(), '');
    const movement = await adapter.movement({ insumo: 'muzzarella', cantidad: 20, tipo: 'merma', monto: 0, motivo: 'Desperdicio' }, c);
    const loss = docs.get('gastos/' + movement.gasto.id);
    assert.equal(loss.monto, 760); assert.equal(loss.medio, 'no-monetario'); assert.equal(loss.clase, 'merma');
    const result = await adapter.close({ ...closeArgs(), expenseIds: [movement.gasto.id] });
    assert.equal(result.close.totalGastos, 0); assert.equal(result.close.efectivoEsperado, 40000);
    assert.equal(result.close.finanzas.gastosOperativos, 760);
});
test('capture is idempotent, preserves old costs, and tracks economic source revisions', async () => {
    const { adapter, docs } = store(initial());
    const first = await adapter.capture('p1'), again = await adapter.capture('p1');
    assert.deepEqual(first, again);
    const p = docs.get('pedidos/p1'); p.total = 29000; p.descuento = 1000;
    const revision = await adapter.capture('p1'); assert.equal(revision.historial.length, 1); assert.equal(revision.historial[0].total, 30000);
    assert.deepEqual(revision.lineas[0].costos, first.lineas[0].costos);
});
test('append uses server state and refuses already paid/closed orders', async () => {
    const data = initial(); data['pedidos/p1'].pagado = false; data['pedidos/p1'].estado = 'preparacion';
    const { adapter, docs } = store(data); const line = order().pizzas[0];
    await Promise.all([adapter.append('p1', [line], [], 30000), adapter.append('p1', [line], [], 30000)]);
    assert.equal(docs.get('pedidos/p1').total, 90000); assert.equal(docs.get('pedidos/p1').pizzas.length, 3);
    docs.get('pedidos/p1').pagado = true; await assert.rejects(adapter.append('p1', [line], [], 30000), /no está abierto/);
});
test('private economics and immutable records have narrow rules in both proposals', () => {
    for (const path of ['reglas_firestore (2).txt', 'tpv-push-backend/firestore.rules.proposed.txt']) {
        const rules = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
        for (const name of ['comercial_pedidos', 'comercial_config', 'comercial_stock']) {
            const block = rules.slice(rules.indexOf(`match /${name}/`), rules.indexOf('}', rules.indexOf(`match /${name}/`) + name.length + 10) + 200);
            assert.match(block, /esAdmin\(\)/); assert.doesNotMatch(block, /esDelivery\(\)|esCamarero\(\)|if true/);
        }
        assert.match(rules, /match \/cierres\/\{id\}[^]*?allow update, delete: if false/);
        assert.match(rules, /resource.data.get\('cierreId', null\) == null/);
    }
});
