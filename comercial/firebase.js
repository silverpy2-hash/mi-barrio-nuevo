// Small storage adapter; uses the TPV's existing authenticated Firebase instance.
export function commercialStore(api, context) {
    const { db, collection, doc, query, orderBy, documentId, startAfter, limit, getDocs, onSnapshot, runTransaction, serverTimestamp } = api;
    const M = window.MBComercial;
    const configRef = () => doc(db, 'config', 'comercial');
    const ledgerRef = id => doc(db, 'comercial_pedidos', id);
    const payload = snap => snap.exists() ? { ...snap.data(), id: snap.id } : null;
    const admin = () => { if (!context.admin()) throw Error('Acceso administrativo requerido.'); };
    function byteGuard(value, max = 800000) {
        if (new TextEncoder().encode(JSON.stringify(value)).length > max) throw Error('El reporte supera el tamaño seguro. Cerrá menos pedidos por vez.');
    }
    async function capture(id, meta) {
        admin();
        return runTransaction(db, async tx => {
            const [p, old, c, menu] = await Promise.all([
                tx.get(doc(db, 'pedidos', id)), tx.get(ledgerRef(id)), tx.get(configRef()), tx.get(doc(db, 'config', 'menu'))
            ]);
            if (!p.exists()) return null;
            if (old.exists() && old.data().cierreId) {
                if (meta) throw Error('El cierre ya fijó este pedido: no se puede reescribir su economía.');
                return old.data();
            }
            const raw = { ...p.data(), id }, previous = old.exists() ? old.data() : null;
            if (meta && (!Number.isSafeInteger(meta.reembolso) || meta.reembolso < 0 || meta.reembolso > M.money(raw.total)
                || meta.reembolso > 0 && (raw.estado !== 'cancelado' || raw.pagado !== true))) throw Error('Los reembolsos se registran solo en pedidos cancelados realmente cobrados.');
            if (raw.estado === 'archivado') throw Error('Pedido antiguo archivado: no se reconstruyen costos faltantes con valores actuales.');
            const cfg = c.exists() ? c.data() : M.defaults();
            const menuData = menu.exists() ? menu.data() : context.menu();
            const snap = previous?.firma === M.signature(raw)
                ? previous.fechaPendiente ? M.view(raw, previous, cfg, menuData) : M.copy(previous)
                : M.freeze(raw, cfg, menuData, Date.now(), previous);
            if (meta) snap.meta = { ...snap.meta, ...meta, reembolsadoMs: meta.reembolso !== (snap.meta?.reembolso || 0) ? Date.now() : snap.meta?.reembolsadoMs || null };
            if (!previous || previous.firma !== snap.firma || previous.fechaPendiente || meta) { byteGuard(snap); tx.set(ledgerRef(id), snap); }
            return snap;
        });
    }
    return {
        ...context,
        watchConfig: (next, fail) => onSnapshot(configRef(), s => next(s.exists() ? s.data() : null), fail),
        async page(name, cursor) {
            admin();
            const args = [orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(500)];
            const snap = await getDocs(query(collection(db, name), ...args));
            return { rows: snap.docs.map(s => ({ ...s.data(), id: s.id })), cursor: snap.docs.at(-1) || cursor, more: snap.size === 500 };
        },
        capture, meta: capture,
        async prepareNew(tx, id, data) {
            const [c, menu] = await Promise.all([tx.get(configRef()), tx.get(doc(db, 'config', 'menu'))]);
            return { ...M.freeze({ ...data, id, creado: Date.now() }, c.exists() ? c.data() : M.defaults(), menu.exists() ? menu.data() : context.menu()), fechaPendiente: true };
        },
        writeNew: (tx, id, snap) => tx.set(ledgerRef(id), snap),
        async append(id, pizzas, extras, amount) {
            admin();
            return runTransaction(db, async tx => {
                const [p, old, c, menu] = await Promise.all([tx.get(doc(db, 'pedidos', id)), tx.get(ledgerRef(id)), tx.get(configRef()), tx.get(doc(db, 'config', 'menu'))]);
                if (!p.exists() || p.data().pagado || !['nuevo', 'preparacion', 'en_camino'].includes(p.data().estado) || p.data().cierreId) throw Error('El pedido ya no está abierto.');
                const data = { ...p.data(), id, pizzas: [...(p.data().pizzas || []), ...pizzas], extras: [...(p.data().extras || []), ...extras], total: M.money(p.data().total) + amount };
                const snap = M.freeze(data, c.exists() ? c.data() : M.defaults(), menu.exists() ? menu.data() : context.menu(), Date.now(), old.exists() ? old.data() : null);
                byteGuard(snap); tx.update(p.ref, { pizzas: data.pizzas, extras: data.extras, total: data.total }); tx.set(ledgerRef(id), snap);
                return data.total;
            });
        },
        async saveConfig(config, expected) {
            admin(); M.validateConfig(config);
            const revision = doc(collection(db, 'comercial_config')).id;
            return runTransaction(db, async tx => {
                const current = await tx.get(configRef());
                if ((current.exists() ? current.data().revision || '' : '') !== expected) throw Error('Otra terminal cambió los costos. Recargá antes de guardar.');
                // IDs/units must remain stable for inventory and historical consumption.
                if (current.exists()) for (const old of current.data().insumos || []) {
                    const item = config.insumos.find(i => i.id === old.id);
                    if (!item || item.unidad !== old.unidad) throw Error('No se puede eliminar o cambiar unidad de un insumo existente: ' + old.id);
                }
                const saved = { ...M.copy(config), revision, desde: serverTimestamp(), actualizadoPor: context.uid() };
                byteGuard(saved); tx.set(configRef(), saved); tx.set(doc(db, 'comercial_config', revision), saved);
                return { ...saved, desde: Date.now() };
            });
        },
        async movement(data, config) {
            admin();
            const ref = doc(collection(db, 'comercial_stock')), expenseRef = doc(collection(db, 'gastos'));
            const time = Date.now();
            return runTransaction(db, async tx => {
                const c = await tx.get(configRef());
                if (!c.exists() || !c.data().insumos.some(i => i.id === data.insumo)) throw Error('Guardá primero la configuración del insumo.');
                const item = c.data().insumos.find(i => i.id === data.insumo);
                const physical = data.tipo === 'conteo';
                const movement = { insumo: item.id, unidadCompra: item.unidad, tipo: data.tipo,
                    cantidad: physical ? 0 : data.tipo === 'merma' ? -Math.abs(data.cantidad) : data.cantidad,
                    fisico: physical ? data.cantidad : null, monto: data.monto, motivo: data.motivo,
                    creado: serverTimestamp(), creadoMs: time, jornada: M.day(time, c.data().corte), usuario: context.uid(), gastoId: data.tipo === 'merma' || data.tipo === 'compra' && data.monto > 0 ? expenseRef.id : null };
                let expense = null;
                if (movement.gastoId) {
                    expense = { concepto: 'Compra: ' + item.nombre + ' · ' + data.motivo, monto: data.monto, clase: 'compra', medio: data.medio,
                        creado: serverTimestamp(), jornada: movement.jornada, corte: c.data().corte, cierreId: null, movimientoId: ref.id };
                    if (data.tipo === 'merma') {
                        const known = item.precio !== null && Number.isFinite(Number(item.precio));
                        expense = { ...expense, concepto: 'Merma: ' + item.nombre + ' · ' + data.motivo,
                            clase: 'merma', medio: 'no-monetario', monto: known ? Math.round(Math.abs(data.cantidad) * item.precio / (item.unidad === 'unidad' ? 1 : 1000)) : 0,
                            costoPendiente: !known, precioCompra: item.precio, cantidad: Math.abs(data.cantidad), unidadCompra: item.unidad };
                    }
                    tx.set(expenseRef, expense);
                }
                tx.set(ref, movement);
                return { ...movement, id: ref.id, creado: time, gasto: expense ? { ...expense, id: expenseRef.id, creado: time } : null };
            });
        },
        async close({ ids, expenseIds, counted, opening, expectedOrders, certified = false }) {
            admin();
            if (new Set(ids).size !== ids.length || new Set(expenseIds).size !== expenseIds.length) throw Error('El cierre contiene operaciones duplicadas.');
            if (!Number.isSafeInteger(opening) || opening < 0 || counted !== null && (!Number.isSafeInteger(counted) || counted < 0)) throw Error('Arqueo o fondo inválido.');
            if (!ids.length && !expenseIds.length) throw Error('No hay operaciones para cerrar.');
            if (ids.length * 2 + expenseIds.length + 2 > 440) throw Error('Demasiados pedidos para un cierre seguro (máximo aproximado: 200).');
            const ref = doc(collection(db, 'cierres')), counterRef = doc(db, 'config', 'contador');
            const now = Date.now();
            return runTransaction(db, async tx => {
                // Every read precedes every write. Read live state, never the local UI snapshot.
                const [counter, config, menu, ...docs] = await Promise.all([
                    tx.get(counterRef), tx.get(configRef()), tx.get(doc(db, 'config', 'menu')),
                    ...ids.map(id => tx.get(doc(db, 'pedidos', id))),
                    ...ids.map(id => tx.get(ledgerRef(id))),
                    ...expenseIds.map(id => tx.get(doc(db, 'gastos', id)))
                ]);
                const cfg = config.exists() ? config.data() : M.defaults(), menuData = menu.exists() ? menu.data() : context.menu();
                const fund = M.money(counter.exists() ? counter.data().fondo : 0);
                if (fund !== opening) throw Error('El fondo cambió en otra terminal. Revisá la caja.');
                const sources = docs.slice(0, ids.length).map((s, i) => {
                    if (!s.exists()) throw Error('Un pedido fue eliminado; actualizá antes de cerrar.');
                    const p = { ...s.data(), id: ids[i] };
                    if (!Number.isSafeInteger(p.total) || p.total < 0) throw Error('Pedido con importe inválido: revisar antes de cerrar.');
                    if (p.cierreId || !['entregado', 'cancelado'].includes(p.estado)) throw Error('Otro cierre o terminal cambió un pedido. Actualizá la caja.');
                    if (p.estado === 'entregado' && p.pagado !== true) throw Error('No se archivan ventas pendientes de cobro.');
                    if (p.pagado === true && !['efectivo', 'transferencia', 'pos'].includes(p.pago)) throw Error('Completá el medio de pago de los pedidos cobrados antes de cerrar.');
                    const shown = expectedOrders.find(x => x.id === p.id);
                    // Compare financial values, not JSON map ordering or optional-field representation.
                    // The close and its economic snapshots are built from this fresh transaction read.
                    if (!shown || ['total', 'descuento', 'costoDelivery'].some(k => Number(shown[k] || 0) !== Number(p[k] || 0))) throw Error('El importe de un pedido cambió. Volvé a abrir Caja para revisar el total actualizado.');
                    if ((shown.pagado === true) !== (p.pagado === true) || (shown.pago || null) !== (p.pago || null) || shown.estado !== p.estado) throw Error('El estado o medio de pago cambió en otra terminal. Volvé a abrir Caja para actualizarlo.');
                    return p;
                });
                const saved = docs.slice(ids.length, ids.length * 2);
                const records = sources.map((p, i) => {
                    const old = saved[i].exists() ? saved[i].data() : null;
                    if (old?.cierreId) throw Error('Pedido ya contabilizado en otro cierre.');
                    const record = M.view(p, old, cfg, menuData);
                    record.cierreId = ref.id; record.cerradoMs = now; record.gastosCertificados = certified;
                    return record;
                });
                const expenses = docs.slice(ids.length * 2).map((s, i) => {
                    if (!s.exists() || s.data().cierreId) throw Error('Un gasto fue borrado o ya está cerrado.');
                    const loss = s.data().clase === 'merma' && s.data().medio === 'no-monetario' && s.data().movimientoId;
                    if (!Number.isSafeInteger(s.data().monto) || s.data().monto < 0 || !loss && s.data().monto === 0) throw Error('Gasto con importe inválido.');
                    return { ...s.data(), id: expenseIds[i] };
                });
                const r = M.report(records, expenses, {}, cfg), cash = M.cash(records, expenses, fund);
                const nro = M.money(counter.exists() ? counter.data().cierres : 0) + 1;
                const sizeGroups = {};
                records.filter(M.sold).forEach(s => s.lineas.forEach(l => {
                    const x = sizeGroups[l.nombre] ||= { nombre: l.nombre, cantidad: 0, monto: 0 }; x.cantidad += l.cantidad; x.monto += l.neto;
                }));
                const byMode = Object.fromEntries(r.modalidades.map(x => [x.nombre, { n: x.pedidos, monto: x.total }]));
                const close = { comercialVersion: 1, cerrado: serverTimestamp(), cerradoPor: context.email(), fecha: new Date(now).toLocaleDateString('es-PY', { timeZone: M.TZ }),
                    jornada: M.day(now, cfg.corte), corte: cfg.corte, zonaHoraria: M.TZ, nro, fondo: fund,
                    desde: Math.min(now, ...records.map(s => s.creadoMs || now)), hasta: Math.max(now, ...records.map(s => s.creadoMs || now)),
                    total: r.netas, porPago: cash.pagos, porTipo: byMode, totalGastos: expenses.filter(g => g.medio !== 'no-monetario').reduce((n, g) => n + M.money(g.monto), 0),
                    gastos: expenses.map(g => ({ id: g.id, concepto: g.concepto, monto: g.monto, clase: g.clase || 'sin-clasificar', medio: g.medio || 'sin-definir', jornada: g.jornada || null })),
                    efectivoEsperado: cash.esperado, efectivoContado: counted, diferencia: counted === null ? null : counted - cash.esperado,
                    cantidadEntregados: r.ventas, cantidadCancelados: r.cancelados, pizzas: r.pizzas, porTamano: Object.values(sizeGroups),
                    topSabores: Object.entries(r.sabores).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, cantidad]) => ({ nombre, cantidad })),
                    horaPico: null, porHora: Object.fromEntries(r.horas.map(h => [h.nombre, h.pedidos])),
                    finanzas: { brutas: r.brutas, descuentos: r.descuentos, netasProductos: r.netasProductos, delivery: r.delivery, cobrado: r.cobrado,
                        reembolsos: r.reembolsos, costoProduccion: r.costoProduccion, costoReparto: r.costoReparto, gastosOperativos: r.gastosOperativos,
                        compras: r.compras, margenBruto: r.margenBruto, resultadoConocido: r.resultadoConocido, gananciaNeta: r.gananciaNeta,
                        calidad: r.completo ? 'costos-declarados-completos' : 'costos-incompletos', regalos: r.regalos, flujo: r.flujo,
                        gastosEfectivo: cash.gastosEfectivo, reembolsosEfectivo: cash.reembolsosEfectivo, gastosCompletos: certified },
                    pedidos: sources.map(p => ({ id: p.id, n: '#' + (p.numero || '--'), numero: p.numero || 0, hora: M.ms(p.creado), nombre: p.cliente?.nombre || '', total: p.total, estado: p.estado, pagado: p.pagado === true })) };
                byteGuard(close);
                records.forEach(s => { byteGuard(s); tx.set(ledgerRef(s.pedidoId), s); });
                tx.set(ref, close);
                // Preserve numbering: resetting from a stale query can collide with new web orders.
                tx.set(counterRef, { cierres: nro, fondo: 0 }, { merge: true });
                sources.forEach(p => tx.update(doc(db, 'pedidos', p.id), { estado: 'archivado', cierreId: ref.id, estadoActualizado: serverTimestamp() }));
                expenses.forEach(g => tx.update(doc(db, 'gastos', g.id), { cierreId: ref.id }));
                return { id: ref.id, close, records };
            });
        }
    };
}
