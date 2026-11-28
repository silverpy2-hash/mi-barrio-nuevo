// Only Configuración → Datos: explicit, administrator-authorized maintenance.
export const DATA_COLLECTIONS = [
    ['pedidos', 'Pedidos'], ['cierres', 'Cierres'], ['gastos', 'Gastos'],
    ['clientes', 'Memoria de clientes'], ['comercial_pedidos', 'Registros económicos'],
    ['comercial_stock', 'Movimientos de inventario'], ['solicitudes_mesa', 'Solicitudes de mesa'],
    ['comercial_config', 'Versiones de recetas y costos'], ['config', 'Configuraciones guardadas'], ['usuarios', 'Perfiles de usuarios']
];
export const DELETE_PLANS = {
    cierres: { title: 'Borrar historial de cierres', phrase: 'BORRAR CIERRES', collections: ['cierres'],
        removes: 'Elimina solamente los documentos del historial de cierres.',
        keeps: 'Conserva clientes, pedidos, gastos, economía e inventario y todas las configuraciones. Los pedidos siguen archivados y vinculados a su cierre original; no vuelven a Caja ni se duplican las ventas.' },
    ventas: { title: 'Reiniciar toda la base comercial', phrase: 'REINICIAR BASE COMERCIAL',
        collections: ['solicitudes_mesa', 'pedidos', 'comercial_pedidos', 'gastos', 'cierres', 'comercial_stock'],
        removes: 'Elimina pedidos, cierres, gastos, registros económicos, movimientos de inventario y solicitudes de mesa. Las estadísticas derivadas quedan vacías. Reinicia numeración, contador de cierres y fondo de caja.',
        keeps: 'Conserva íntegramente la memoria de clientes (nombres, teléfonos, direcciones y ubicaciones), menú, precios, promociones, mesas, recetas, costos y sus versiones, usuarios y demás configuraciones. El stock teórico queda en cero, listo para registrar el nuevo stock inicial.' },
    clientes: { title: 'Borrar memoria de clientes', phrase: 'BORRAR MEMORIA DE CLIENTES', collections: ['clientes'],
        removes: 'Elimina solamente la colección de clientes recordados.',
        keeps: 'Conserva pedidos y sus datos de contacto históricos, cierres, economía, inventario, contadores y todas las configuraciones. No borra información comercial.' }
};
const LABELS = Object.fromEntries(DATA_COLLECTIONS);
const ADMIN_UID = 'e8czOfuF82VqPwNUZjMpOSMHUQo2';
const TTL = 10 * 60 * 1000;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export function createDataMaintenance(api, ui) {
    const { db, collection, doc, query, orderBy, documentId, startAfter, limit, getDocsFromServer, getCountFromServer, writeBatch, runTransaction, serverTimestamp } = api;
    const controlRef = () => doc(db, 'config', 'mantenimiento');
    const now = ui.now || Date.now;
    let busy = false, container = null, resume = null;
    const admin = () => { if (ui.uid() !== ADMIN_UID) throw Error('Solo el administrador puede usar estas operaciones.'); };
    const message = (text, bad = false) => {
        ui.notify(text);
        if (!container) return;
        const node = container.querySelector('[data-datos-message]');
        if (node) { node.textContent = text; node.className = bad ? 'text-sm text-red-700 font-bold p-3' : 'text-sm text-neutral-700 p-3'; }
    };
    const buttons = disabled => container?.querySelectorAll('[data-borrar], #d-backup').forEach(b => b.disabled = disabled);
    async function counts(names) {
        admin();
        const out = {};
        for (const name of names) {
            if (!LABELS[name]) throw Error('Colección no autorizada.');
            out[name] = (await getCountFromServer(collection(db, name))).data().count;
        }
        return out;
    }
    const describe = data => Object.entries(data).map(([k, n]) => `${LABELS[k]}: ${n}`).join('\n');
    const equal = (a, b) => Object.keys(a).every(k => a[k] === b[k]);
    async function readAll(name, heartbeat) {
        const rows = []; let cursor = null;
        for (;;) {
            admin(); if (heartbeat) await heartbeat();
            const q = query(collection(db, name), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(400));
            const page = await getDocsFromServer(q);
            rows.push(...page.docs.map(d => ({ id: d.id, datos: d.data() })));
            if (page.size < 400) return rows;
            cursor = page.docs.at(-1);
        }
    }
    async function downloadBackup(heartbeat) {
        admin();
        const out = { formato: 'mi-barrio-respaldo-completo', version: 1, generadoUTC: new Date(now()).toISOString(), colecciones: {} };
        for (const [name, label] of DATA_COLLECTIONS) {
            message('Preparando respaldo: ' + label + '…');
            out.colecciones[name] = await readAll(name, heartbeat);
        }
        await ui.download('respaldo-mi-barrio-' + new Date(now()).toISOString().replace(/[:.]/g, '-') + '.json', JSON.stringify(out), 'application/json');
        return out;
    }
    async function backup() {
        if (busy) return;
        busy = true; buttons(true);
        try { admin(); await downloadBackup(); message('Se inició la descarga del respaldo completo. Comprobá que el archivo se guardó.'); }
        catch (e) { message('No se pudo generar el respaldo: ' + e.message, true); }
        finally { busy = false; buttons(false); }
    }
    async function begin(key, phrase) {
        const token = resume?.key === key ? resume.token : doc(collection(db, 'cierres')).id;
        await runTransaction(db, async tx => {
            admin(); const s = await tx.get(controlRef()), old = s.exists() ? s.data() : null;
            const stamp = old?.inicio?.toMillis ? old.inicio.toMillis() : Number(old?.inicio || 0);
            if (old?.activo && stamp + TTL > now() && old.token !== token) throw Error('Otra terminal tiene un mantenimiento activo. Esperá a que termine.');
            tx.set(controlRef(), { activo: true, accion: key, token, confirmacion: phrase, usuario: ui.uid(), inicio: serverTimestamp() });
        });
        return token;
    }
    async function renew(key, token) {
        await runTransaction(db, async tx => {
            admin(); const s = await tx.get(controlRef());
            if (!s.exists() || !s.data().activo || s.data().token !== token || s.data().accion !== key) throw Error('La autorización de mantenimiento cambió. No se continúa borrando.');
            tx.update(controlRef(), { inicio: serverTimestamp() });
        });
    }
    async function end(token, result) {
        await runTransaction(db, async tx => {
            admin(); const s = await tx.get(controlRef());
            if (!s.exists() || s.data().token !== token || !s.data().activo) return;
            tx.update(controlRef(), { activo: false, resultado: result, finalizado: serverTimestamp() });
        });
    }
    async function clearCollection(name, expected, heartbeat, onAttempt, onDeleted) {
        for (;;) {
            admin(); await heartbeat();
            const page = await getDocsFromServer(query(collection(db, name), orderBy(documentId()), limit(200)));
            if (!page.size) return;
            if (page.docs.some(d => !expected.has(d.id) || expected.get(d.id) !== canonical(d.data()))) throw Error('Hay registros nuevos o modificados que no coinciden con el respaldo. Revisá los datos y confirmá un nuevo respaldo.');
            // Each batch is atomic, not the complete multi-collection reset.
            const batch = writeBatch(db); page.docs.forEach(d => batch.delete(d.ref));
            onAttempt();
            await batch.commit(); onDeleted(page.size);
        }
    }
    async function erase(key) {
        if (busy) return;
        busy = true; buttons(true);
        let token = null, removed = 0, attempted = false, completed = false;
        try {
            admin(); const plan = DELETE_PLANS[key]; if (!plan) throw Error('Operación no reconocida.');
            const before = await counts(plan.collections);
            message(plan.title + '\n' + describe(before));
            const total = Object.values(before).reduce((a, n) => a + n, 0);
            const typed = ui.prompt(`${plan.title}\n\n${plan.removes}\n\n${plan.keeps}\n\nRegistros afectados:\n${describe(before)}\nTOTAL: ${total}\n${key === 'ventas' ? 'También se reinician ultimo, cierres y fondo de config/contador.\n' : ''}\nSe descargará un respaldo completo antes del borrado. No se puede deshacer automáticamente. Cerrá las otras terminales antes de continuar.\n\nEscribí exactamente: ${plan.phrase}`);
            if (typed !== plan.phrase) { message('Operación cancelada. No se borró ningún registro.'); return; }
            token = await begin(key, typed);
            const heartbeat = () => renew(key, token);
            if (!equal(before, await counts(plan.collections))) throw Error('Las cantidades cambiaron mientras confirmabas. Volvé a revisar y confirmar los nuevos totales.');
            const backup = await downloadBackup(heartbeat);
            if (!ui.confirm('Se inició la descarga del respaldo completo. Verificá que el JSON quedó guardado y se puede abrir.\n\n¿Confirmás que tenés el respaldo y querés ejecutar ' + plan.title + '?\n\nRegistros: ' + total)) { message('Cancelado después del respaldo. No se borró ningún registro.'); return; }
            await heartbeat();
            if (!equal(before, await counts(plan.collections))) throw Error('Los datos cambiaron durante el respaldo. No se inicia el borrado; revisá los totales.');
            for (const name of plan.collections) {
                message('Eliminando ' + LABELS[name] + '…');
                const expected = new Map(backup.colecciones[name].map(row => [row.id, canonical(row.datos)]));
                await clearCollection(name, expected, heartbeat, () => { attempted = true; resume = { key, token }; }, n => { removed += n; });
            }
            await heartbeat();
            const remaining = await counts(plan.collections);
            if (Object.values(remaining).some(n => n !== 0)) throw Error('Quedaron registros: la operación no terminó.');
            if (key === 'ventas') {
                attempted = true; resume = { key, token };
                await runTransaction(db, async tx => {
                    admin(); const s = await tx.get(controlRef());
                    if (!s.exists() || s.data().token !== token || !s.data().activo) throw Error('No se reinician contadores sin autorización vigente.');
                    tx.set(doc(db, 'config', 'contador'), { ultimo: 0, cierres: 0, fondo: 0 }, { merge: true });
                    tx.update(controlRef(), { activo: false, resultado: 'completado', finalizado: serverTimestamp() });
                });
            } else await end(token, 'completado');
            completed = true; resume = null;
            message(`Operación completada: ${removed} registros eliminados. Recargando para vaciar las estadísticas y cachés de esta terminal…`);
            try { ui.reload(); } catch (e) { message('Borrado completado. Recargá manualmente esta terminal para actualizar sus estadísticas. ' + e.message); }
        } catch (e) {
            message(attempted ? `Borrado incompleto: ${removed} eliminaciones confirmadas; si se perdió la conexión podría haberse aplicado otro lote. El reinicio de contadores no está confirmado. No se restaura nada automáticamente. Conservá el respaldo y reintentá la misma opción para terminar. Mantenimiento temporal activo (vence tras 10 minutos sin actividad). Error: ${e.message}`
                : 'No se borró ningún registro. ' + e.message, true);
        } finally {
            if (token && !completed && !attempted) {
                try { await end(token, 'cancelado'); } catch (e) { message('No se pudo liberar el mantenimiento; vence automáticamente tras 10 minutos sin actividad. ' + e.message, true); }
            }
            busy = false; buttons(false);
        }
    }
    async function render(host, { CARD, LBL, BTN, esc, current }) {
        container = host;
        try { admin(); } catch (e) { host.textContent = e.message; return; }
        host.innerHTML = `<div class="${CARD}"><div class="${LBL}">Respaldo completo</div><p class="text-sm text-neutral-600">Descarga datos reales de Firebase: pedidos, cierres, gastos, clientes, economía, inventario, solicitudes, versiones de costos, configuraciones y perfiles. No usa cambios sin guardar del formulario.</p><button type="button" id="d-backup" class="${BTN} bg-neutral-800 text-white">⬇ Descargar respaldo completo</button></div>
            <div data-datos-message role="status" aria-live="polite" class="text-sm p-3">Contando registros desde el servidor…</div>` +
            Object.entries(DELETE_PLANS).map(([key, p]) => `<div class="${CARD} border-red-200"><h3 class="font-bold text-red-800">${esc(p.title)}</h3><p class="text-sm"><strong>Elimina:</strong> ${esc(p.removes)}</p><p class="text-sm text-neutral-600"><strong>Conserva:</strong> ${esc(p.keeps)}</p><div data-datos-count="${key}" class="text-sm whitespace-pre-line">Contando…</div><p class="text-xs text-red-700">Confirmación escrita: ${esc(p.phrase)}. Respaldo obligatorio antes de ejecutar.</p><button disabled type="button" data-borrar="${key}" class="w-full ${BTN} bg-red-100 text-red-700 disabled:opacity-50">${esc(p.title)}</button></div>`).join('');
        buttons(true);
        try {
            const data = await counts(DATA_COLLECTIONS.map(([name]) => name));
            if (!current()) return;
            for (const [key, p] of Object.entries(DELETE_PLANS)) {
                const subset = Object.fromEntries(p.collections.map(k => [k, data[k]]));
                host.querySelector(`[data-datos-count="${key}"]`).textContent = describe(subset) + '\nTotal: ' + Object.values(subset).reduce((a, n) => a + n, 0);
            }
            message('Tres operaciones independientes, solo para el administrador. Cada botón vuelve a verificar las cantidades antes de confirmar.');
            buttons(busy);
        } catch (e) { message('No se pudieron consultar todos los registros. No se habilita el borrado: ' + e.message, true); }
    }
    return { render, backup, erase };
}
