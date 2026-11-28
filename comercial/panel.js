/* Administrative UI; storage/auth are supplied by the existing TPV. */
(function () {
    'use strict';
    const M = window.MBComercial;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const gs = n => n == null ? 'Pendiente' : Math.round(n).toLocaleString('es-PY') + ' Gs';
    const num = n => Number(n || 0).toLocaleString('es-PY', { maximumFractionDigits: 2 });
    const card = (title, body) => `<section class="mb-card"><h3>${esc(title)}</h3>${body}</section>`;
    const field = (label, input) => `<label class="mb-field"><span>${esc(label)}</span>${input}</label>`;
    const input = (name, value = '', type = 'text', extra = '') => `<input name="${esc(name)}" type="${type}" value="${esc(value ?? '')}" ${extra}>`;
    const select = (name, opts, value) => `<select name="${name}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const button = (action, text, extra = '') => `<button type="button" data-mb="${action}" ${extra}>${esc(text)}</button>`;
    const table = (heads, rows) => `<div class="mb-scroll"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${heads.length}">Sin datos en este período.</td></tr>`}</tbody></table></div>`;
    const details = (title, body) => `<details class="mb-card"><summary>${esc(title)}</summary>${body}</details>`;
    const pairs = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const lists = ['pedidos', 'comercial_pedidos', 'gastos', 'cierres', 'comercial_stock'];
    const channels = [['', 'Todos los canales'], ['web', 'Web'], ['whatsapp', 'WhatsApp'], ['tpv', 'TPV'], ['qr', 'QR'], ['sin-identificar', 'Sin identificar']];
    const modes = [['', 'Todas las modalidades'], ['delivery', 'Delivery'], ['retiro', 'Retiro'], ['local', 'Local']];
    const types = [['base', 'Base por tamaño'], ['promo', 'Promoción'], ['regalo', 'Pizza regalo'], ['sabor', 'Sabor (pizza completa)'], ['categoria', 'Adicional categoría'], ['borde', 'Borde por tamaño'], ['extra', 'Extra/bebida'], ['envase', 'Envase modalidad:tamaño']];
    function create(a) {
        let cfg = M.defaults(), draft = null, baseRevision = '', stop = null, tab = '', host = null;
        let busy = false, error = '', loaded = false, session = 0, reportNow = null, recordNow = [], recipeIndex = -1;
        const cache = Object.fromEntries(lists.map(k => [k, new Map()]));
        const cursors = {}, more = Object.fromEntries(lists.map(k => [k, true]));
        let filters = { desde: M.day(Date.now() - 29 * 86400000), hasta: M.day(Date.now()), canal: '', modalidad: '', categoria: '', producto: '' };
        let capturing = false, captureAgain = false, captureError = '';
        const active = () => a.admin();
        function fail(message) {
            a.error(message);
            if (!host || !['estadisticas', 'costos'].includes(tab)) return;
            let node = host.querySelector('[data-mb-error]');
            if (!node) { node = document.createElement('p'); node.dataset.mbError = 'true'; node.className = 'mb-error'; node.setAttribute('role', 'alert'); host.prepend(node); }
            node.textContent = message; node.scrollIntoView({ block: 'nearest' });
        }
        const snapshotMap = () => cache.comercial_pedidos;
        function reset() {
            if (host) { host.replaceChildren(); host.classList.remove('mb-comercial'); }
            session++; if (stop) stop(); stop = null; loaded = false; busy = false; tab = ''; host = null; draft = null; cfg = M.defaults();
            lists.forEach(k => { cache[k].clear(); delete cursors[k]; more[k] = true; });
            reportNow = null; recordNow = []; captureError = ''; error = '';
        }
        async function start() {
            reset(); const token = session;
            stop = a.watchConfig(value => {
                if (token !== session || !active()) return;
                cfg = value || M.defaults(); captureLive();
            }, e => { captureError = e.message; });
        }
        async function captureLive() {
            if (!active()) return;
            if (capturing) { captureAgain = true; return; }
            capturing = true; const token = session;
            try {
                do {
                    captureAgain = false;
                    for (const p of a.orders()) {
                        if (token !== session || !active()) break;
                        const old = snapshotMap().get(p.id);
                        if (old?.cierreId || old?.firma === M.signature(p) && !old.fechaPendiente) continue;
                        const saved = await a.capture(p.id);
                        if (token === session && saved) snapshotMap().set(p.id, saved);
                    }
                } while (captureAgain && token === session);
                captureError = '';
            } catch (e) { captureError = 'No se pudo fijar el historial económico: ' + e.message; }
            finally { capturing = false; }
        }
        async function load() {
            if (busy || !active()) return;
            busy = true; error = ''; const token = session; render();
            try {
                const results = await Promise.all(lists.map(async key => {
                    if (!more[key]) return;
                    const page = await a.page(key, cursors[key]);
                    if (token !== session || !active()) return;
                    page.rows.forEach(x => cache[key].set(x.id, x)); cursors[key] = page.cursor; more[key] = page.more;
                }));
                if (token !== session) return;
                loaded = true;
            } catch (e) { if (token === session) error = e.message; }
            finally { if (token === session) { busy = false; render(); } }
        }
        function records() {
            const raw = new Map(cache.pedidos);
            a.orders().forEach(p => raw.set(p.id, p));
            return [...raw.values()].map(p => {
                const saved = snapshotMap().get(p.id);
                if (p.estado === 'archivado' && !saved?.cierreId) {
                    // Old close summaries lack stable order ids; no guessed matching by number.
                    const s = M.freeze(p, cfg, a.menu()); s.estado = 'historico-sin-estado'; s.advertencias.push('Pedido archivado antiguo sin detalle económico: ver cierre original'); return s;
                }
                return M.view(p, saved, cfg, a.menu());
            });
        }
        function activate(next, container) {
            tab = next; host = container; host.classList.add('mb-comercial');
            if (tab === 'costos' && !draft) { draft = M.copy(cfg); baseRevision = cfg.revision || ''; }
            render(); if (!loaded && !busy) load();
        }
        function summaryHTML(r) {
            const metrics = [['Ventas brutas', gs(r.brutas)], ['Descuentos', gs(r.descuentos)], ['Ventas netas', gs(r.netas)],
                ['Cobrado (no facturación)', gs(r.cobrado)], ['Pendiente de cobro', gs(r.pendiente)], ['Ticket promedio', gs(r.ticket)],
                ['Pedidos vendidos', num(r.ventas)], ['Pizzas elaboradas', num(r.pizzas)], ['Pizzas regalo', num(r.regalos)],
                ['Delivery facturado', gs(r.delivery)], ['Envíos gratuitos', num(r.gratis)], ['Cancelados', num(r.cancelados)],
                ['Costo producción conocido', gs(r.costoProduccion)], ['Costo reparto conocido', gs(r.costoReparto)],
                ['Margen bruto' + (r.completo ? '' : ' · provisional'), gs(r.margenBruto)], ['Margen tras reparto · provisional', gs(r.contribucion)],
                ['Gastos operativos', gs(r.gastosOperativos)], ['Compras (no consumo)', gs(r.compras)],
                ['Mermas valorizadas (sin salida de caja)', gs(r.mermas)],
                ['Resultado con costos conocidos', gs(r.resultadoConocido)], ['Ganancia neta', r.gananciaNeta === null ? 'No confirmada' : gs(r.gananciaNeta)],
                ['Flujo de cobros − pagos', gs(r.flujo)], ['Punto de equilibrio del período', gs(r.equilibrio)]];
            const grid = list => `<div class="mb-metrics">${list.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`;
            return grid(metrics.slice(0, 9)) + details('Delivery, costos, flujo y rentabilidad', grid(metrics.slice(9)));
        }
        function bars(rows) {
            const max = Math.max(1, ...rows.map(x => x.total));
            return rows.slice(0, 40).map(x => `<div class="mb-bar"><span>${esc(x.nombre)}</span><i style="width:${Math.max(0, x.total / max * 100)}%"></i><b>${esc(gs(x.total))}</b></div>`).join('') || '<p>Sin ventas.</p>';
        }
        function statsHTML() {
            recordNow = records();
            const r = reportNow = M.report(recordNow, [...cache.gastos.values()], filters, cfg);
            if (Object.values(more).some(Boolean) || error || captureError) { r.completo = false; r.gananciaNeta = null; r.equilibrio = null; }
            const from = Date.parse(filters.desde + 'T12:00:00Z'), to = Date.parse(filters.hasta + 'T12:00:00Z'), span = Math.max(1, Math.round((to - from) / 86400000) + 1);
            const prior = M.report(recordNow, [...cache.gastos.values()], { ...filters,
                desde: new Date(from - span * 86400000).toISOString().slice(0, 10), hasta: new Date(from - 86400000).toISOString().slice(0, 10) }, cfg);
            const priorDiff = prior.netas ? ((r.netas / prior.netas - 1) * 100).toFixed(1) + '%' : 'sin base comparable';
            const options = [['resumen', 'Resumen'], ['pedidos', 'Pedidos'], ['productos', 'Productos'], ['promociones', 'Promociones'], ['gastos', 'Gastos'], ['consumo', 'Consumo'], ['rentabilidad', 'Rentabilidad'], ['cierres', 'Cierres']];
            const exported = `<div class="mb-row">${select('exportar', options, 'resumen')}${button('export', '⬇ CSV (Excel)')}${button('json', '⬇ Respaldo económico JSON')}</div>`;
            const knownSales = r.registros.filter(M.sold);
            const legacy = [...cache.cierres.values()].filter(c => !c.comercialVersion);
            return card('Filtros comerciales', `<form data-mb-form="filters" class="mb-grid">
                ${field('Desde (jornada)', input('desde', filters.desde, 'date', 'required'))}${field('Hasta (jornada)', input('hasta', filters.hasta, 'date', 'required'))}
                ${field('Canal', select('canal', channels, filters.canal))}${field('Modalidad', select('modalidad', modes, filters.modalidad))}
                ${field('Categoría', select('categoria', [['', 'Todas'], ['clasico', 'Clásica'], ['especial', 'Especial'], ['gourmet', 'Gourmet'], ['extra', 'Extras']], filters.categoria))}
                ${field('Producto o sabor', input('producto', filters.producto))}<button type="submit">Aplicar filtros</button></form>
                <div class="mb-row">${['dia', 'semana', 'mes', 'ano'].map(k => button('period', { dia: 'Hoy', semana: '7 días', mes: 'Mes', ano: 'Año' }[k], `data-period="${k}"`)).join('')}</div>
                <p>Filtro de producto/categoría: selecciona pedidos que los contienen; los totales incluyen el pedido completo para conservar la conciliación.</p>`) +
                card('Resultados', summaryHTML(r) + `<p>Comparación con ${span} jornadas anteriores: ${esc(priorDiff)} · base ${esc(gs(prior.netas))}. Solo sobre historial cargado.</p>
                <p>Conciliación: productos brutos ${esc(gs(r.brutasProductos))} − descuentos ${esc(gs(r.descuentos))} + delivery ${esc(gs(r.delivery))} = ${esc(gs(r.netas))}.</p>
                <p>Ventas: entregados por jornada del pedido. Cobros y devoluciones: jornada de su fecha de registro, incluye anticipos y cancelados cobrados. Medio elegido no significa cobrado. Cobros históricos sin fecha comprobable: ${esc(gs(r.cobrosSinFecha))} (no se asignan a un día ficticio). Cancelados cobrados: ${r.canceladosCobrados}; verificar devoluciones.</p>${exported}`) +
                card('Facturación por jornada', bars(r.dias.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)))) +
                details('Cobros, devoluciones y egresos por medio', table(['Medio', 'Cobrado por fecha de cobro', 'Reembolsos', 'Egresos pagados'], ['efectivo', 'transferencia', 'pos', 'sinDefinir', 'sin-definir'].map(k => [esc(k), gs(r.pagos[k] || 0), gs(r.reembolsosPorMedio[k] || 0), gs(r.gastos.filter(g => g.medio === k && g.medio !== 'no-monetario').reduce((n, g) => n + g.monto, 0))])) + '<p>SinDefinir/sin-definir señalan medio faltante. La merma no monetaria afecta resultados, no estos egresos.</p>') +
                details('Productos: facturación y margen', table(['Producto', 'Categoría', 'Unidades comerciales', 'Pizzas físicas', 'Regalos', 'Bruto', 'Descuento', 'Neto', 'Costo conocido', 'Margen producto'], r.productos.map(p => [esc(p.nombre), esc(p.categoria), num(p.cantidad), num(p.elaboradas), num(p.regalos), gs(p.bruto), gs(p.descuento), gs(p.neto), gs(p.costoConocido), (p.completo ? '' : 'Estimado: ') + gs(p.neto - p.costoConocido)]))) +
                details('Ranking por margen de producción verificable', table(['Producto', 'Margen acumulado', 'Margen por unidad comercial'], r.productos.filter(p => p.completo && p.cantidad > 0).sort((a, b) => (b.neto - b.costoConocido) - (a.neto - a.costoConocido)).map(p => [esc(p.nombre), gs(p.neto - p.costoConocido), gs((p.neto - p.costoConocido) / p.cantidad)])) + '<p>Excluye productos con costos incompletos. No descuenta gastos operativos generales ni reparto.</p>') +
                details('Promociones y descuentos (no sumar filas superpuestas)', table(['Promoción registrada', 'Pedidos', 'Clientes identificados', 'Facturación del pedido', 'Descuento del pedido', 'Margen producción'], r.promociones.map(p => [esc(p.nombre), num(p.pedidos), num(p.clientes), gs(p.total), gs(p.descuento), (p.completo ? '' : 'Estimado: ') + gs(p.total - p.costoConocido)])) + '<p>Un pedido puede usar descuento + regalo + envío gratis: aparece en varias filas. Valor monetario de regalos y ahorro de envío no registrados no se inventan.</p>') +
                details('Canales y modalidades', table(['Canal', 'Pedidos', 'Neto', 'Margen producción'], r.canales.map(x => [esc(x.nombre), x.pedidos, gs(x.total), (x.completo ? '' : 'Estimado: ') + gs(x.total - x.costoConocido)])) + table(['Modalidad', 'Pedidos', 'Neto', 'Margen producción'], r.modalidades.map(x => [esc(x.nombre), x.pedidos, gs(x.total), (x.completo ? '' : 'Estimado: ') + gs(x.total - x.costoConocido)]))) +
                details('Sabores, tamaños y categorías', table(['Sabor (fracción de pizza comercial)', 'Cantidad'], pairs(r.sabores).map(([k, v]) => [esc(k), num(v)])) + table(['Tamaño comercial', 'Cantidad'], pairs(r.tamanos).map(([k, v]) => [esc(k), num(v)])) + table(['Categoría', 'Cantidad'], pairs(r.categorias).map(([k, v]) => [esc(k), num(v)]))) +
                details('Demanda y clientes', table(['Hora Paraguay', 'Pedidos', 'Ventas'], r.horas.map(x => [esc(x.nombre), x.pedidos, gs(x.total)])) + table(['Día calendario Paraguay', 'Pedidos', 'Ventas'], r.semana.map(x => [esc(x.nombre), x.pedidos, gs(x.total)])) +
                    `<p>Clientes: ${r.clientes.identificados} identificados · ${r.clientes.nuevosObservados} primera compra observada en el historial cargado · ${r.clientes.recurrentes} recurrentes · ${r.clientes.sinIdentificar} pedidos sin teléfono. No equivale a clientes nuevos absolutos si falta historial.</p>
                    <p>Proyección orientativa: ${num(r.ventas / span)} pedidos/jornada y ${gs(r.netas / span)} por jornada (${span} jornadas, no pronóstico garantizado).</p>`) +
                details('Pedidos y calidad de datos', table(['Pedido', 'Jornada', 'Estado', 'Canal', 'Total', 'Cobrado', 'Reparto real', 'Observaciones'], r.registros.map(s => [esc(s.pedidoId), esc(s.jornada), esc(s.estado), esc(s.canal), gs(s.total), s.pagado ? 'Sí' : 'No', gs(s.meta?.costoReparto ?? null),
                    button('meta', 'Completar', `data-id="${esc(s.pedidoId)}" ${s.cierreId ? 'disabled title="Cierre inmutable"' : ''}`)])) +
                    `<p>${r.advertencias.length} tipos de pendientes. Sin costos completos no se confirma ganancia neta. En segmentos no se prorratean gastos generales.</p><ul>${r.advertencias.slice(0, 60).map(w => `<li>${esc(w)}</li>`).join('')}</ul>`) +
                details('Cierres anteriores sin datos económicos nuevos', `<p>No se revalúan con precios actuales ni se suman otra vez a los pedidos. Sus totales originales siguen disponibles en Historial. ${legacy.length} cierres antiguos cargados; ${recordNow.filter(x => x.estado === 'historico-sin-estado').length} pedidos archivados sin estado anterior identificable.</p>
                    ${table(['Fecha original', 'Ventas declaradas', 'Gastos declarados', 'Calidad'], legacy.map(c => [esc(c.fecha), gs(c.total), gs(c.totalGastos), 'Resumen histórico, desglose no disponible']))}`);
        }
        function costsHTML() {
            const c = draft || cfg, inventory = M.stock([...cache.comercial_stock.values()], records(), cfg);
            const units = [['kg', 'kg (receta en gramos)'], ['litro', 'litro (receta en ml)'], ['unidad', 'unidad']];
            const ingredients = c.insumos.map((i, ix) => `<tr data-insumo="${ix}"><td>${input('id', i.id)}</td><td>${input('nombre', i.nombre)}</td><td>${select('unidad', units, i.unidad)}</td><td>${input('precio', i.precio, 'number', 'min="0" step="any"')}</td><td>${input('minimo', i.minimo, 'number', 'min="0" step="any"')}</td></tr>`).join('');
            const recipes = c.recetas.map((r, i) => [esc(r.tipo), esc(r.clave), r.completa ? 'Confirmada' : 'Pendiente', esc(Object.entries(r.ingredientes).map(([id, n]) => id + ': ' + (n ?? '?')).join(' · ')), button('recipe', 'Editar', `data-index="${i}"`)]);
            const chosen = recipeIndex >= 0 ? c.recetas[recipeIndex] : null;
            return card('Configuración económica privada', `<p>Los precios iniciales son referencias. Guardá y confirmá recetas antes de interpretar márgenes. No cambia precios de venta ni promociones. Nuevas versiones solo afectan nuevas capturas; nunca revalúan cierres.</p>
                <form data-mb-form="config"><div class="mb-grid">${field('Corte de jornada (hora Paraguay, 0–12)', input('corte', c.corte, 'number', 'min="0" max="12" required'))}
                ${field('Rendimiento masa cruda (g)', input('rendimientoMasa', c.rendimientoMasa, 'number', 'min="1" required'))}
                ${field('Aceite: gramos por ml (no asumir densidad)', input('aceiteGramosPorMl', c.aceiteGramosPorMl, 'number', 'min="0.01" step="any"'))}</div>
                <div class="mb-grid">${Object.entries(c.masaBase).map(([id, q]) => field('Masa por lote: ' + id + ' (g)', input('masa-' + id, q, 'number', 'min="0" step="any"'))).join('')}</div>
                <p>Masa cruda: se calcula según el rendimiento declarado. Precio de agua pendiente (se permite 0 explícito). Los gramajes del lote son editables.</p>
                <div class="mb-scroll"><table><thead><tr><th>ID estable</th><th>Insumo</th><th>Compra</th><th>Precio Gs</th><th>Mínimo (g/ml/u)</th></tr></thead><tbody>${ingredients}</tbody></table></div>
                <div class="mb-row">${button('ingredient', '＋ Insumo')}<button type="submit">Guardar versión de costos</button>${button('discard', 'Recargar configuración guardada')}</div></form>
                <p>Vacío = dato desconocido, no cero. No cambies el ID/unidad de un insumo con movimientos; creá otro. Requesón se compra por unidad: su gramaje por unidad no se supone.</p>`) +
                card('Recetas y gramajes', `<p>Claves de tamaño: mediano, grande, chico, tren-grande. Sabor/extra: nombre exacto del menú. Envase: delivery:grande, retiro:mediano, local:chico, etc. Una receta de envase vacía confirmada significa sin caja. Mezclas de sabores se reparten en partes iguales: es consumo teórico. Si no son iguales, el costo es estimado.</p>
                    <p>La receta promo grande-con-regalo se utiliza solo cuando el nombre guardado identifica 2×1 o mediana de regalo; sus 650 g/220 g son referencia total del conjunto (masas, quesos y salsa). Los toppings de ambas pizzas se toman de las recetas de sabor; mediana muzza gratis usa el sabor Muzza también para el regalo. Si el sabor del regalo no se conoce, el costo queda incompleto. No cambia lo que se vende.</p>
                    ${table(['Tipo', 'Clave', 'Estado', 'Componentes (g/ml/u)', ''], recipes)}
                    <form data-mb-form="recipe" class="mb-grid">${field('Tipo', select('tipo', types, chosen?.tipo || 'sabor'))}${field('Clave exacta', input('clave', chosen?.clave || '', 'text', 'required'))}
                    ${field('Ingredientes: un ID=cantidad por línea; ? = pendiente', `<textarea name="ingredientes" rows="5" placeholder="pollo=80\nsalsa=?">${esc(Object.entries(chosen?.ingredientes || {}).map(([id, q]) => `${id}=${q ?? '?'}`).join('\n'))}</textarea>`)}
                    ${field('Verificación', `<label><input type="checkbox" name="completa" ${chosen?.completa ? 'checked' : ''}> Receta completa (incluye todos los ingredientes)</label>`)}
                    <button type="submit">Aplicar receta al borrador</button>${button('new-recipe', 'Nueva receta')}</form><p>Aplicar receta no persiste: luego tocá Guardar versión de costos. Los datos previos del formulario de insumos se conservan al editar recetas.</p>`) +
                card('Compras, ajustes y mermas', `<p>Inventario teórico = movimientos − consumo capturado. Un conteo físico se conserva aparte y NO reemplaza automáticamente el teórico. Para conciliar registrá un ajuste por la diferencia. La merma registra automáticamente un costo no monetario al precio vigente del insumo (pendiente si falta precio), sin sacar dinero de caja. Ajustes de stock no se valorizan automáticamente; compras se registran en Caja sin duplicar el consumo.</p>
                    <form data-mb-form="movement" class="mb-grid">${field('Insumo', select('insumo', cfg.insumos.map(i => [i.id, i.nombre]), cfg.insumos[0]?.id))}
                    ${field('Tipo', select('tipo', [['compra', 'Compra/entrada'], ['ajuste', 'Ajuste firmado'], ['merma', 'Merma (cantidad positiva)'], ['conteo', 'Conteo físico (observación)']], 'compra'))}
                    ${field('Cantidad (g/ml/u)', input('cantidad', '', 'number', 'step="any" required'))}${field('Importe pagado (solo compra)', input('monto', '', 'number', 'min="0"'))}
                    ${field('Medio', select('medio', [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['pos', 'POS']], 'efectivo'))}${field('Motivo / comprobante', input('motivo', '', 'text', 'required maxlength="150"'))}
                    <button type="submit">Registrar movimiento</button></form>
                    ${table(['Insumo', 'Entradas/ajustes netos', 'Consumo teórico', 'Saldo teórico', 'Último conteo físico', 'Alerta'], inventory.map(i => [esc(i.nombre), num(i.movimientos), num(i.consumo), num(i.disponibleTeorico), i.ultimoConteo ? num(i.ultimoConteo.fisico) : 'Sin conteo', i.bajo ? 'Stock bajo' : i.incompleto ? 'Consumo incompleto' : '—']))}
                    <p>Saldo basado exclusivamente en historial cargado. Si faltan recetas, stock inicial o páginas de datos, no es disponibilidad física confirmada.</p>`) +
                details('Historial de movimientos de insumos', table(['Fecha Paraguay', 'Insumo', 'Tipo', 'Movimiento g/ml/u', 'Conteo físico', 'Importe pagado', 'Motivo'], [...cache.comercial_stock.values()].sort((a, b) => (M.ms(b.creado) || 0) - (M.ms(a.creado) || 0)).map(m => [esc(M.ms(m.creado) ? new Date(M.ms(m.creado)).toLocaleString('es-PY', { timeZone: M.TZ }) : 'Sin fecha'), esc(m.insumo), esc(m.tipo), num(m.cantidad), m.fisico == null ? '—' : num(m.fisico), gs(m.monto), esc(m.motivo)]))) +
                details('Capacidad y facturación potencial por producto completo', (() => {
                    const menu = a.menu(), candidates = [];
                    for (const [size, product] of Object.entries(menu.tamanos || {})) for (const [cat, flavors] of Object.entries(menu.sabores || {})) for (const flavor of flavors) {
                        const price = product.precios?.[cat]; if (!Number.isFinite(price)) continue;
                        const s = M.freeze({ id: 'simulacion', creado: Date.now(), tipo: 'retiro', origen: 'panel', total: price,
                            pizzas: [{ tamano: size, nombre: product.nombre, categoria: cat, sabores: [flavor], precio: price }], extras: [] }, cfg, menu);
                        const recipe = s.lineas[0]?.costos;
                        const count = recipe ? M.capacity(recipe, inventory) : null;
                        if (count !== null) candidates.push([esc(product.nombre + ' · ' + flavor), num(count), gs(count * price)]);
                    }
                    return table(['Producto (retiro, sin borde)', 'Pedidos posibles', 'Facturación a precio listado'], candidates) + '<p>Alternativas, no sumables: comparten stock. Solo recetas completas, incluidos regalos y envases. Simulación al precio actual del menú, sin aplicar descuentos futuros. Inventario teórico y datos cargados, no promesa de stock físico.</p>';
                })()) +
                details('Capacidad teórica por receta base', table(['Perfil', 'Capacidad base (no producto completo)', 'Advertencia'], cfg.recetas.filter(r => ['base', 'promo'].includes(r.tipo)).map(r => {
                    const cost = M.recipeCost([[r.tipo, r.clave, 1]], cfg, !!cfg.desde);
                    const cap = M.capacity(cost, inventory);
                    return [esc(r.clave), cap == null ? 'Pendiente' : num(cap), 'No incluye sabores, bordes ni envases; no publicar como venta potencial completa.'];
                })));
        }
        function preserveDraft() {
            if (!host || !draft) return;
            const f = host.querySelector('[data-mb-form="config"]'); if (!f) return;
            const nullable = v => v.trim() === '' ? null : Number(v);
            draft.corte = Number(f.elements.corte.value); draft.rendimientoMasa = Number(f.elements.rendimientoMasa.value);
            draft.aceiteGramosPorMl = nullable(f.elements.aceiteGramosPorMl.value);
            for (const id of Object.keys(draft.masaBase)) draft.masaBase[id] = Number(f.elements['masa-' + id].value);
            f.querySelectorAll('[data-insumo]').forEach(row => {
                const i = draft.insumos[Number(row.dataset.insumo)];
                for (const k of ['id', 'nombre', 'unidad']) i[k] = row.querySelector(`[name="${k}"]`).value.trim();
                for (const k of ['precio', 'minimo']) i[k] = nullable(row.querySelector(`[name="${k}"]`).value);
            });
        }
        function render() {
            if (!host || !active() || !['estadisticas', 'costos'].includes(tab)) return;
            host.classList.add('mb-comercial');
            try {
                const partial = Object.values(more).some(Boolean);
                host.innerHTML = `<div class="mb-row">${button('load', busy ? 'Cargando…' : loaded ? 'Cargar siguientes 500 por colección' : 'Cargar datos', busy || !partial ? 'disabled' : '')}${button('refresh', 'Actualizar historial', busy ? 'disabled' : '')}</div>
                    <p class="mb-notice">${partial ? 'Historial parcial: cargá más páginas antes de sacar conclusiones.' : 'Todas las páginas disponibles cargadas.'} ${cache.pedidos.size} pedidos, ${cache.cierres.size} cierres, ${cache.gastos.size} gastos. Jornada America/Asuncion, corte ${cfg.corte}:00. Cambiar corte no mueve capturas anteriores.</p>
                    ${error || captureError ? `<p class="mb-error">${esc(error || captureError)}. Verificá las reglas de Firebase; ningún dato se presenta como guardado si falló.</p>` : ''}
                    ${tab === 'estadisticas' ? statsHTML() : costsHTML()}`;
            } catch (e) { host.innerHTML = `<p class="mb-error">${esc(e.message)}</p>`; }
        }
        function download(name, text, type) {
            const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
            link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        function exportCSV(kind) {
            if (!reportNow) return;
            const r = reportNow;
            let rows;
            if (kind === 'resumen' || kind === 'rentabilidad') rows = [Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v !== 'object'))];
            else if (kind === 'pedidos') rows = r.registros.map(s => ({ pedidoId: s.pedidoId, jornada: s.jornada, creadoUTC: s.creadoMs ? new Date(s.creadoMs).toISOString() : null, canal: s.canal, modalidad: s.modalidad, estado: s.estado, bruto: s.bruto, descuento: s.descuento, delivery: s.delivery, total: s.total, pagado: s.pagado, pago: s.pago, costoConocido: s.costoConocido, costosCompletos: s.costosCompletos, cierreId: s.cierreId, revisionCostos: s.revisionCostos, motivo: s.motivo, pendientes: s.advertencias }));
            else if (kind === 'productos') rows = r.registros.flatMap(s => s.lineas.map(l => ({ pedidoId: s.pedidoId, jornada: s.jornada, estado: s.estado, ...l, identidad: undefined })));
            else if (kind === 'promociones') rows = r.promociones;
            else if (kind === 'gastos') rows = r.gastos.map(g => ({ id: g.id, jornada: g.jornada, concepto: g.concepto, clase: g.clase, medio: g.medio, monto: g.monto, cierreId: g.cierreId }));
            else if (kind === 'consumo') rows = r.registros.filter(M.produced).flatMap(s => s.lineas.flatMap(l => l.costos.consumo.map(c => ({ pedidoId: s.pedidoId, jornada: s.jornada, producto: l.nombre, ...c, completo: l.costos.completo }))));
            else if (kind === 'cierres') rows = [...cache.cierres.values()].filter(c => { const d = c.jornada || M.day(M.ms(c.cerrado), cfg.corte); return d && d >= filters.desde && d <= filters.hasta; }).map(c => ({ id: c.id, nro: c.nro, fecha: c.fecha, jornada: c.jornada, total: c.total, totalGastos: c.totalGastos, efectivoEsperado: c.efectivoEsperado, efectivoContado: c.efectivoContado, diferencia: c.diferencia, comercialVersion: c.comercialVersion || 'historico', finanzas: c.finanzas || null }));
            rows ||= [];
            const cols = [...new Set(rows.flatMap(x => Object.keys(x)))];
            download(`mi-barrio-${kind}-${filters.desde}-${filters.hasta}.csv`, M.csv(rows, cols.length ? cols : ['sin_datos']), 'text/csv;charset=utf-8');
        }
        async function click(e) {
            const b = e.target.closest('[data-mb]'); if (!b || !active()) return;
            const action = b.dataset.mb;
            try {
                if (tab === 'costos') preserveDraft();
                if (action === 'load') return load();
                if (action === 'refresh') { lists.forEach(k => { cache[k].clear(); delete cursors[k]; more[k] = true; }); return load(); }
                if (action === 'period') {
                    const today = M.day(Date.now(), cfg.corte), p = b.dataset.period;
                    filters.hasta = today;
                    filters.desde = p === 'dia' ? today : p === 'semana' ? new Date(Date.parse(today + 'T12:00:00Z') - 6 * 86400000).toISOString().slice(0, 10) : p === 'mes' ? today.slice(0, 7) + '-01' : today.slice(0, 4) + '-01-01'; render(); return;
                }
                if (action === 'export') return exportCSV(host.querySelector('[name="exportar"]').value);
                if (action === 'json') return download('mi-barrio-economia.json', JSON.stringify({ version: 1, parcial: Object.values(more).some(Boolean), exportadoUTC: new Date().toISOString(), filtros: filters, config: cfg, colecciones: Object.fromEntries(lists.map(k => [k, [...cache[k].values()]])) }, null, 2), 'application/json');
                if (action === 'meta') {
                    const id = b.dataset.id, s = recordNow.find(x => x.pedidoId === id); if (!s || s.cierreId) return;
                    const reparto = prompt('Costo REAL de reparto en Gs (solo devengado; NO salida de caja). Vacío = desconocido. Para pagar este mismo reparto en Caja elegí «Pago de reparto ya imputado»: así no duplicás el costo.', s.meta?.costoReparto ?? ''); if (reparto === null) return;
                    if (reparto !== '' && (!Number.isFinite(Number(reparto)) || Number(reparto) < 0)) throw Error('Costo de reparto inválido.');
                    const refund = s.estado === 'cancelado' && s.pagado ? prompt('Reembolso realmente realizado en Gs (0 si no hubo). Se descuenta del cobro por el mismo medio de pago.', s.meta?.reembolso || 0) : '0'; if (refund === null) return;
                    if (!Number.isFinite(Number(refund)) || Number(refund) < 0 || Number(refund) > s.total) throw Error('Reembolso inválido.');
                    const made = s.estado === 'cancelado' ? confirm('¿Este pedido cancelado fue elaborado? Aceptar descuenta su consumo teórico.') : false;
                    const saved = await a.meta(id, { costoReparto: reparto === '' ? null : M.money(reparto), reembolso: M.money(refund), medioReembolso: s.pago, elaborado: made });
                    cache.comercial_pedidos.set(id, saved); render(); return;
                }
                preserveDraft();
                if (action === 'ingredient') { draft.insumos.push({ id: 'nuevo-' + draft.insumos.length, nombre: 'Nuevo insumo', unidad: 'kg', precio: null, minimo: null }); render(); }
                if (action === 'discard') { draft = M.copy(cfg); baseRevision = cfg.revision || ''; recipeIndex = -1; render(); }
                if (action === 'recipe') { recipeIndex = Number(b.dataset.index); render(); }
                if (action === 'new-recipe') { recipeIndex = -1; render(); }
            } catch (err) { fail(err.message); }
        }
        async function submit(e) {
            const f = e.target.closest('[data-mb-form]'); if (!f || !active()) return; e.preventDefault();
            const data = Object.fromEntries(new FormData(f)), btn = f.querySelector('button[type="submit"]');
            if (btn?.disabled) return;
            if (btn) btn.disabled = true;
            try {
                if (f.dataset.mbForm === 'filters') {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(data.hasta) || data.desde > data.hasta) throw Error('Revisá el rango de fechas.');
                    filters = { ...filters, ...data }; render();
                } else if (f.dataset.mbForm === 'config') {
                    preserveDraft(); M.validateConfig(draft);
                    const saved = await a.saveConfig(draft, baseRevision); cfg = saved; draft = M.copy(saved); baseRevision = saved.revision; a.toast('Configuración económica guardada'); render();
                } else if (f.dataset.mbForm === 'recipe') {
                    preserveDraft(); const ingredients = {};
                    for (const line of data.ingredientes.split(/\r?\n/).filter(x => x.trim())) {
                        const parts = line.split('='); if (parts.length !== 2 || !parts[0].trim()) throw Error('Usá ID=cantidad, uno por línea.');
                        const key = parts[0].trim(), qty = parts[1].trim(); if (Object.hasOwn(ingredients, key)) throw Error('Insumo repetido: ' + key);
                        ingredients[key] = qty === '?' || qty === '' ? null : Number(qty);
                    }
                    const r = { tipo: data.tipo, clave: data.clave.trim(), completa: data.completa === 'on', ingredientes: ingredients };
                    const next = M.copy(draft); if (recipeIndex >= 0) next.recetas[recipeIndex] = r; else next.recetas.push(r); M.validateConfig(next);
                    draft = next; recipeIndex = -1; render();
                } else if (f.dataset.mbForm === 'movement') {
                    const qty = Number(data.cantidad), amount = Number(data.monto);
                    if (!Number.isFinite(qty) || qty === 0 && data.tipo !== 'conteo' || (data.tipo !== 'ajuste' && qty < 0)) throw Error('Cantidad inválida.');
                    if (data.tipo === 'compra' && (data.monto === '' || !Number.isSafeInteger(amount) || amount < 0)) throw Error('Especificá el importe pagado (0 explícito si corresponde).');
                    const movement = await a.movement({ ...data, cantidad: qty, monto: data.tipo === 'compra' ? amount : 0 }, cfg);
                    cache.comercial_stock.set(movement.id, movement);
                    if (movement.gasto) cache.gastos.set(movement.gasto.id, movement.gasto);
                    a.toast('Movimiento guardado'); render();
                }
            } catch (err) { fail(err.message); }
            finally { if (btn) btn.disabled = false; }
        }
        document.getElementById('caja-contenido').addEventListener('click', click);
        document.getElementById('caja-contenido').addEventListener('submit', submit);
        return { start, reset, captureLive, activate, deactivate: () => { tab = ''; }, config: () => cfg, saved: id => snapshotMap().get(id), records, render,
            cacheSaved: s => snapshotMap().set(s.pedidoId, s) };
    }
    window.MBComercialUI = { create };
})();
