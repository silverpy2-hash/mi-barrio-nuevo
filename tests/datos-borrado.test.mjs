// Isolated in-memory maintenance tests. Never initializes Firebase or makes HTTP calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const file = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const moduleSource = file('comercial/datos.js');
const { createDataMaintenance, DELETE_PLANS, DATA_COLLECTIONS } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
const M = createRequire(import.meta.url)('../comercial/motor.js');
const UID = 'e8czOfuF82VqPwNUZjMpOSMHUQo2', NOW = 1800000000000;
const seed = () => ({
    'pedidos/p1': { estado: 'archivado', cierreId: 'c1', pagado: true, total: 60000, cliente: { nombre: 'Cliente', mapa: 'ubicacion' } },
    'pedidos/p2': { estado: 'nuevo', total: 30000 }, 'cierres/c1': { total: 60000 },
    'comercial_pedidos/p1': { pedidoId: 'p1', estado: 'entregado', cierreId: 'c1', total: 60000, lineas: [], meta: {} },
    'gastos/g1': { monto: 1900, cierreId: 'c1' }, 'comercial_stock/s1': { insumo: 'harina', cantidad: 5000 },
    'solicitudes_mesa/q1': { estado: 'pendiente' },
    'clientes/595000000000': { nombre: 'Cliente', celular: '595000000000', direccion: 'Dirección', mapa: 'ubicacion', lat: -25, lng: -56, pedidos: 9 },
    'config/menu': { precios: { grande: 60000 } }, 'config/local': { delivery: { cobrar: false }, descuentoWeb: { porcentaje: 10 } },
    'config/comercial': { recetas: ['masa'], insumos: [{ id: 'harina', precio: 4000 }] },
    'config/contador': { ultimo: 75, cierres: 12, fondo: 20000, otro: 'conservar' },
    'comercial_config/version1': { recetas: ['masa'], precio: 4000 }, 'usuarios/admin': { rol: 'admin' }
});
function fake(options = {}) {
    const docs = new Map(Object.entries(options.seed || seed()).map(([k, v]) => [k, structuredClone(v)]));
    const versions = new Map(), log = [], messages = [], downloads = [], prompts = [];
    let uid = options.uid ?? UID, generated = 0, batches = 0, reloaded = 0, confirmCount = 0;
    const list = name => [...docs.keys()].filter(k => k.startsWith(name + '/') && k.split('/').length === 2).sort();
    const snapshot = path => ({ id: path.split('/').at(-1), ref: { path }, exists: () => docs.has(path), data: () => structuredClone(docs.get(path)) });
    const ref = (db, ...parts) => ({ path: parts.length ? parts.join('/') : db.path + '/token-' + ++generated + '-maintenance', id: parts.at(-1) || 'token-' + generated + '-maintenance' });
    const apply = (path, data, merge) => { docs.set(path, merge ? { ...docs.get(path), ...structuredClone(data) } : structuredClone(data)); versions.set(path, (versions.get(path) || 0) + 1); };
    const api = { db: {}, collection: (_, path) => ({ path }), doc: ref,
        query: (r, ...constraints) => ({ ...r, constraints }), orderBy: field => ({ order: field }), documentId: () => '__name__',
        startAfter: cursor => ({ after: cursor.id }), limit: n => ({ max: n }), serverTimestamp: () => NOW,
        getCountFromServer: async r => {
            if (options.countFail) throw Error('Sin conexión al servidor');
            log.push(['count', r.path]); return { data: () => ({ count: list(r.path).length }) };
        },
        getDocsFromServer: async q => {
            log.push(['read', q.path]);
            if (options.backupFail === q.path && !batches) throw Error('Falla de lectura de respaldo');
            const n = q.constraints.find(x => x.max)?.max || Infinity, after = q.constraints.find(x => x.after)?.after;
            const paths = list(q.path).filter(p => !after || p.split('/').at(-1) > after).slice(0, n), rows = paths.map(snapshot);
            return { docs: rows, size: rows.length, empty: !rows.length };
        },
        writeBatch: () => {
            const deletions = [];
            return { delete: r => deletions.push(r.path), commit: async () => {
                batches++; if (batches === options.failBatch) throw Error('Falla del lote');
                const control = docs.get('config/mantenimiento');
                assert.equal(uid, UID); assert.equal(control?.activo, true);
                for (const path of deletions) {
                    const name = path.split('/')[0]; assert.ok(DELETE_PLANS[control.accion].collections.includes(name), 'deletion outside operation scope');
                }
                for (const path of deletions) { docs.delete(path); versions.set(path, (versions.get(path) || 0) + 1); log.push(['delete', path]); }
                if (batches === options.lostAckBatch) throw Error('Se perdió la confirmación del servidor');
            } };
        },
        runTransaction: async (_, callback) => {
            for (let retry = 0; retry < 5; retry++) {
                const reads = new Map(), writes = []; let writing = false;
                const tx = { get: async r => {
                    assert.equal(writing, false); reads.set(r.path, versions.get(r.path) || 0);
                    const value = docs.has(r.path) ? structuredClone(docs.get(r.path)) : null;
                    return { exists: () => value !== null, data: () => structuredClone(value) };
                }, set: (r, data, opts) => { writing = true; writes.push([r.path, data, opts?.merge]); },
                update: (r, data) => { writing = true; writes.push([r.path, data, true]); } };
                const result = await callback(tx);
                if ([...reads].some(([p, v]) => v !== (versions.get(p) || 0))) continue;
                for (const [path, data, merge] of writes) { log.push(['set', path]); apply(path, data, merge); }
                return result;
            }
            throw Error('Conflicto de transacción');
        }
    };
    const ui = { uid: () => uid, now: () => NOW, notify: text => messages.push(text),
        prompt: text => { prompts.push(text); options.onPrompt?.(docs); return options.typed === undefined ? Object.values(DELETE_PLANS).find(p => text.includes('Escribí exactamente: ' + p.phrase))?.phrase : options.typed; },
        confirm: () => { confirmCount++; options.onConfirm?.(docs); return options.confirm !== false; },
        download: async (name, text) => { if (options.downloadFail) throw Error('Descarga fallida'); downloads.push(JSON.parse(text)); },
        reload: () => { reloaded++; } };
    return { manager: createDataMaintenance(api, ui), docs, log, messages, downloads, prompts, list,
        get reloaded() { return reloaded; }, get confirmations() { return confirmCount; }, setUid: value => uid = value,
        another: () => createDataMaintenance(api, ui) };
}
test('delete closures only: archived orders, economic snapshots, clients and config remain byte-for-byte unchanged', async () => {
    const f = fake(), before = structuredClone([...f.docs]);
    const original = M.view(f.docs.get('pedidos/p1'), f.docs.get('comercial_pedidos/p1'));
    await f.manager.erase('cierres');
    assert.equal(f.list('cierres').length, 0);
    for (const [path, data] of before.filter(([path]) => !path.startsWith('cierres/'))) assert.deepEqual(f.docs.get(path), data, path);
    assert.deepEqual(M.view(f.docs.get('pedidos/p1'), f.docs.get('comercial_pedidos/p1')), original);
    assert.equal(f.docs.get('pedidos/p1').estado, 'archivado'); assert.equal(f.docs.get('pedidos/p1').cierreId, 'c1');
    assert.equal(f.reloaded, 1);
});
test('full commercial reset clears exactly its six collections and counters, preserving all contacts and configuration versions', async () => {
    const f = fake(), before = structuredClone([...f.docs]);
    await f.manager.erase('ventas');
    for (const name of DELETE_PLANS.ventas.collections) assert.equal(f.list(name).length, 0, name);
    for (const [path, data] of before.filter(([path]) => ['clientes', 'comercial_config', 'usuarios', 'config'].includes(path.split('/')[0]) && path !== 'config/contador')) assert.deepEqual(f.docs.get(path), data, path);
    assert.deepEqual(f.docs.get('config/contador'), { ultimo: 0, cierres: 0, fondo: 0, otro: 'conservar' });
    assert.equal(f.docs.get('config/mantenimiento').activo, false); assert.equal(f.reloaded, 1);
});
test('customer memory deletion is independent of orders, costs, stock, closures and counters', async () => {
    const f = fake(), before = structuredClone([...f.docs]);
    await f.manager.erase('clientes'); assert.equal(f.list('clientes').length, 0);
    for (const [path, data] of before.filter(([path]) => !path.startsWith('clientes/'))) assert.deepEqual(f.docs.get(path), data, path);
});
test('each operation requires its own exact phrase and reports counts before confirmation', async () => {
    assert.equal(new Set(Object.values(DELETE_PLANS).map(p => p.phrase)).size, 3);
    for (const key of Object.keys(DELETE_PLANS)) {
        const f = fake({ typed: 'BORRAR' }); await f.manager.erase(key);
        assert.equal(f.log.filter(x => x[0] === 'delete').length, 0); assert.equal(f.downloads.length, 0);
        assert.ok(f.prompts[0].includes(DELETE_PLANS[key].phrase)); assert.match(f.prompts[0], /TOTAL: \d+/);
        assert.equal(f.docs.has('config/mantenimiento'), false);
    }
});
test('backup contains real saved configurations, contacts, recipe versions and all commercial collections before deletion', async () => {
    const f = fake(); await f.manager.erase('ventas');
    assert.equal(f.downloads.length, 1);
    const backup = f.downloads[0];
    assert.deepEqual(Object.keys(backup.colecciones), DATA_COLLECTIONS.map(([name]) => name));
    assert.deepEqual(backup.colecciones.config.find(x => x.id === 'menu').datos, seed()['config/menu']);
    assert.equal(backup.colecciones.pedidos.length, 2); assert.equal(backup.colecciones.clientes[0].datos.mapa, 'ubicacion');
});
test('declining after backup deletes nothing and releases its temporary authorization', async () => {
    const f = fake({ confirm: false }); await f.manager.erase('ventas');
    assert.equal(f.downloads.length, 1); assert.equal(f.log.filter(x => x[0] === 'delete').length, 0);
    assert.equal(f.docs.get('config/mantenimiento').activo, false); assert.deepEqual(f.docs.get('config/contador'), seed()['config/contador']);
});
test('read or download failures abort before deleting any records', async () => {
    for (const options of [{ countFail: true }, { backupFail: 'config' }, { downloadFail: true }]) {
        const f = fake(options); await f.manager.erase('ventas');
        assert.equal(f.log.filter(x => x[0] === 'delete').length, 0); assert.equal(f.reloaded, 0);
        assert.deepEqual(f.docs.get('config/contador'), seed()['config/contador']);
    }
});
test('a changed count invalidates confirmation rather than silently deleting more records', async () => {
    const f = fake({ onPrompt: docs => docs.set('pedidos/extra', { total: 1000 }) }); await f.manager.erase('ventas');
    assert.equal(f.log.filter(x => x[0] === 'delete').length, 0); assert.equal(f.downloads.length, 0);
    assert.match(f.messages.join('\n'), /cantidades cambiaron/);
});
test('a non-admin cannot count, download, authorize or delete even if calling the handler directly', async () => {
    for (const uid of ['delivery', 'camarero', '', null]) {
        const f = fake({ uid: uid === null ? '' : uid }); await f.manager.erase('ventas'); await f.manager.backup();
        assert.equal(f.log.length, 0); assert.equal(f.downloads.length, 0); assert.match(f.messages.join(' '), /administrador/);
    }
});
test('equal counts cannot hide records replaced or changed after the backup', async () => {
    for (const onConfirm of [docs => { docs.delete('cierres/c1'); docs.set('cierres/c2', { total: 60000 }); },
        docs => docs.set('cierres/c1', { total: 90000 })]) {
        const f = fake({ onConfirm }); await f.manager.erase('cierres');
        assert.equal(f.log.filter(x => x[0] === 'delete').length, 0);
        assert.match(f.messages.at(-1), /no coinciden con el respaldo/);
        assert.equal(f.docs.get('config/mantenimiento').activo, false);
    }
});
test('pagination backs up every record and deletion uses bounded batches above the old one-batch limit', async () => {
    const data = seed(); for (let n = 0; n < 450; n++) data['cierres/id-' + String(n).padStart(4, '0')] = { total: n };
    const f = fake({ seed: data }); await f.manager.erase('cierres');
    assert.equal(f.downloads[0].colecciones.cierres.length, 451); assert.equal(f.list('cierres').length, 0);
    assert.equal(f.log.filter(x => x[0] === 'delete').length, 451);
});
test('partial batch failure is honest, keeps counters unchanged and permits resuming the same operation', async () => {
    const f = fake({ failBatch: 2 }); await f.manager.erase('ventas');
    assert.equal(f.docs.get('config/mantenimiento').activo, true); assert.equal(f.reloaded, 0);
    assert.deepEqual(f.docs.get('config/contador'), seed()['config/contador']); assert.match(f.messages.join('\n'), /Borrado incompleto/);
    await f.manager.erase('ventas'); assert.equal(f.docs.get('config/mantenimiento').activo, false);
    assert.equal(f.reloaded, 1); assert.equal(f.docs.get('config/contador').ultimo, 0);
});
test('two terminals cannot acquire destructive maintenance concurrently', async () => {
    const f = fake(); await Promise.all([f.manager.erase('cierres'), f.another().erase('cierres')]);
    assert.equal(f.reloaded, 1); assert.match(f.messages.join('\n'), /Otra terminal/);
});
test('lost acknowledgement never claims that nothing was deleted or silently resets counters', async () => {
    const f = fake({ lostAckBatch: 1 }); await f.manager.erase('ventas');
    assert.equal(f.list('solicitudes_mesa').length, 0); assert.equal(f.docs.get('config/mantenimiento').activo, true);
    assert.match(f.messages.at(-1), /podría haberse aplicado otro lote/);
    assert.doesNotMatch(f.messages.at(-1), /No se borró ningún registro/);
    assert.deepEqual(f.docs.get('config/contador'), seed()['config/contador']);
});
test('desktop and mobile share the same data actions without changing order/price modules', () => {
    for (const path of ['panel_nuevo.html', 'mi-barrio-tpv-celular/index.html']) {
        const html = file(path); assert.match(html, /import \{ createDataMaintenance \} from ['"]\.\.?\/comercial\/datos.js/);
        assert.match(html, /function borrar\(que\) \{ return gestorDatos.erase\(que\); \}/);
        assert.doesNotMatch(html, /async function vaciar\(/);
        for (const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/src=/.test(s[1])) new vm.Script(s[2].replace(/^\s*import\s+.*?;\s*$/gm, ''));
    }
});
test('rules keep private economics protected and add only admin-only, action-scoped, expiring deletion', () => {
    for (const path of ['reglas_firestore (2).txt', 'tpv-push-backend/firestore.rules.proposed.txt']) {
        const rules = file(path);
        assert.match(rules, /function puedeBorrarDatos\(accion\) \{\s*return esAdmin\(\) && mantenimientoActivo\(accion\)/);
        assert.match(rules, /m.inicio \+ duration.value\(10, 'm'\) > request.time/);
        assert.match(rules, /doc != 'mantenimiento' \|\| autorizacionMantenimientoValida\(\)/);
        assert.match(rules, /m.token == resource.data.token && m.accion == resource.data.accion/);
        assert.match(rules, /allow delete: if puedeBorrarDatos\('cierres'\) \|\| puedeBorrarDatos\('ventas'\)/);
        for (const name of ['comercial_pedidos', 'comercial_stock']) {
            const block = rules.slice(rules.indexOf(`match /${name}/{id}`), rules.indexOf(`match /${name}/{id}`) + 500);
            assert.match(block, /allow delete: if puedeBorrarDatos\('ventas'\)/); assert.doesNotMatch(block, /esDelivery|esCamarero|if true/);
        }
        const costs = rules.slice(rules.indexOf('match /comercial_config/{id}'), rules.indexOf('match /comercial_stock/{id}'));
        assert.match(costs, /allow update, delete: if false/);
        assert.doesNotMatch(rules, /allow read, write: if true/);
    }
});
