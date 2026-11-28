/* Mi Barrio: arithmetic-only commercial ledger. No Firebase, DOM or dependencies. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MBComercial = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const VERSION = 1, TZ = 'America/Asuncion';
    const copy = x => JSON.parse(JSON.stringify(x));
    const finite = x => x !== null && x !== '' && x !== undefined && Number.isFinite(Number(x));
    const money = x => finite(x) ? Math.round(Number(x)) : 0;
    const sum = (xs, fn) => xs.reduce((n, x) => n + fn(x), 0);
    const unique = xs => [...new Set(xs)];
    function ms(x) {
        if (x && typeof x.toMillis === 'function') return x.toMillis();
        if (x && finite(x.seconds)) return Number(x.seconds) * 1000;
        if (typeof x === 'number' && x > 0) return x;
        const n = typeof x === 'string' ? Date.parse(x) : NaN;
        return Number.isFinite(n) ? n : null;
    }
    function localParts(time) {
        if (!ms(time)) return null;
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms(time)));
        const get = k => parts.find(p => p.type === k)?.value;
        return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, weekday: get('weekday') };
    }
    function day(time, cutoff = 5) {
        const p = localParts(time);
        if (!p) return null;
        return p.hour < cutoff ? new Date(Date.parse(p.date + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10) : p.date;
    }
    function defaults() {
        const prices = [
            ['muzzarella', 'Muzzarella', 'kg', 38000], ['harina', 'Harina 000', 'kg', 4000],
            ['aceite', 'Aceite', 'litro', 14000], ['sal', 'Sal', 'kg', 5000], ['levadura', 'Levadura', 'kg', 14000],
            ['salsa', 'Salsa', 'kg', 11000], ['pollo', 'Pechuga de pollo', 'kg', 16000], ['carne', 'Carne', 'kg', 60000],
            ['requeson', 'Requesón', 'unidad', 65000], ['peperonni', 'Peperonni', 'kg', 80000],
            ['calabresa', 'Calabresa', 'kg', 50000], ['panceta', 'Panceta', 'kg', 50000], ['barbacoa', 'Barbacoa', 'kg', 30000],
            ['caja-grande', 'Caja grande', 'unidad', 1900], ['caja-chica', 'Caja chica', 'unidad', 1800], ['agua', 'Agua', 'kg', null]
        ];
        return { version: VERSION, revision: '', desde: null, corte: 5, gastosCompletos: false,
            aceiteGramosPorMl: null, rendimientoMasa: 8150, masaBase: { harina: 5000, agua: 2600, aceite: 250, sal: 150, levadura: 150 },
            insumos: prices.map(([id, nombre, unidad, precio]) => ({ id, nombre, unidad, precio, minimo: null })),
            recetas: [
                { tipo: 'base', clave: 'mediano', completa: false, ingredientes: { masa: 250, muzzarella: 130, salsa: null } },
                { tipo: 'base', clave: 'grande', completa: false, ingredientes: { masa: 400, muzzarella: null, salsa: null } },
                { tipo: 'promo', clave: 'grande-con-regalo', completa: false, ingredientes: { masa: 650, muzzarella: 220, salsa: null } },
                { tipo: 'base', clave: 'chico', completa: false, ingredientes: { masa: 550, muzzarella: 190, salsa: null } },
                { tipo: 'base', clave: 'tren-grande', completa: false, ingredientes: { masa: 800, muzzarella: 300, salsa: null } },
                { tipo: 'regalo', clave: 'mediano', completa: false, ingredientes: { masa: 250, muzzarella: null, salsa: null } }
            ] };
    }
    function validateConfig(cfg) {
        if (!cfg || !Number.isInteger(cfg.corte) || cfg.corte < 0 || cfg.corte > 12) throw Error('La jornada debe cortar entre las 0 y las 12 horas.');
        if (!Array.isArray(cfg.insumos) || cfg.insumos.length > 150 || !Array.isArray(cfg.recetas) || cfg.recetas.length > 300) throw Error('Configuración demasiado grande.');
        const ids = new Set();
        for (const i of cfg.insumos) {
            if (!/^[a-z0-9-]{1,50}$/.test(i.id) || ids.has(i.id) || !i.nombre || !['kg', 'litro', 'unidad'].includes(i.unidad)) throw Error('Revisá identificadores, nombres y unidades de insumos.');
            ids.add(i.id);
            for (const value of [i.precio, i.minimo]) if (value !== null && (!finite(value) || Number(value) < 0)) throw Error('Precio o stock mínimo inválido.');
        }
        const keys = new Set();
        for (const r of cfg.recetas) {
            const key = r.tipo + ':' + r.clave;
            if (!r.clave || keys.has(key) || !['base', 'promo', 'regalo', 'sabor', 'categoria', 'borde', 'extra', 'envase'].includes(r.tipo)) throw Error('Revisá las claves y tipos de recetas.');
            keys.add(key);
            for (const [id, qty] of Object.entries(r.ingredientes || {})) {
                if (id !== 'masa' && !ids.has(id)) throw Error('Insumo desconocido en receta: ' + id);
                if (qty !== null && (!finite(qty) || Number(qty) < 0)) throw Error('Cantidad inválida: ' + id);
            }
        }
        if (!finite(cfg.rendimientoMasa) || cfg.rendimientoMasa <= 0) throw Error('Revisá el rendimiento de masa.');
        if (!cfg.masaBase || !Object.keys(cfg.masaBase).length) throw Error('Configurá la receta base de masa.');
        for (const [id, qty] of Object.entries(cfg.masaBase)) {
            if (!ids.has(id) || !finite(qty) || Number(qty) < 0) throw Error('Revisá la receta de masa: ' + id);
        }
        if (cfg.aceiteGramosPorMl !== null && (!finite(cfg.aceiteGramosPorMl) || cfg.aceiteGramosPorMl <= 0)) throw Error('Revisá la conversión de aceite.');
        return cfg;
    }
    function category(flavors, menu) {
        for (const k of ['gourmet', 'especial', 'clasico']) if ((flavors || []).some(f => (menu?.sabores?.[k] || []).includes(f))) return k;
        return 'sin-identificar';
    }
    function channel(p) {
        if (p.canalComercial) return p.canalComercial;
        if (p.origen === 'whatsapp') return 'whatsapp';
        if (p.origen === 'qr' || p.mesa && p.origen !== 'panel' && p.origen !== 'camarero') return 'qr';
        if (['panel', 'tpv', 'camarero'].includes(p.origen)) return 'tpv';
        // The legacy public writer omits origen. Do not claim every unknown order is web.
        if (p.origen === 'web' || p.intentoId?.startsWith('web-')) return 'web';
        return 'sin-identificar';
    }
    function signature(p) {
        return JSON.stringify([p.total, p.descuento || 0, p.costoDelivery || 0, p.porcentajeDescuento || null, p.pizzas || [], p.extras || [], p.tipo || null, channel(p), p.motivoDescuento || null]);
    }
    function recipeCost(components, cfg, applicable) {
        const quantities = {}, missing = [], recipeCopies = [];
        const add = (id, qty) => { quantities[id] = (quantities[id] || 0) + qty; };
        for (const [type, key, multiplier] of components) {
            const r = cfg.recetas.find(x => x.tipo === type && x.clave === key);
            if (!r) { missing.push(`Receta ${type}: ${key}`); continue; }
            recipeCopies.push(copy(r));
            if (!r.completa) missing.push(`Confirmar receta ${type}: ${key}`);
            for (const [id, qty] of Object.entries(r.ingredientes || {})) {
                if (!finite(qty)) { missing.push(`Gramaje ${id} (${key})`); continue; }
                if (id !== 'masa') { add(id, Number(qty) * multiplier); continue; }
                const fraction = Number(qty) * multiplier / cfg.rendimientoMasa;
                for (const [ingredient, grams] of Object.entries(cfg.masaBase || {})) {
                    const item = cfg.insumos.find(i => i.id === ingredient);
                    if (item?.unidad !== 'litro') add(ingredient, grams * fraction);
                    else if (ingredient === 'aceite' && finite(cfg.aceiteGramosPorMl) && cfg.aceiteGramosPorMl > 0) add(ingredient, grams * fraction / cfg.aceiteGramosPorMl);
                    else missing.push('Densidad de ' + ingredient + ': masa en gramos, precio por litro');
                }
            }
        }
        const consumption = Object.entries(quantities).map(([id, cantidad]) => {
            const i = cfg.insumos.find(x => x.id === id);
            const price = i && finite(i.precio) ? Number(i.precio) : null;
            if (price === null) missing.push('Precio: ' + id);
            return { id, cantidad, unidad: i?.unidad || 'desconocida', precioCompra: price,
                costo: price === null ? null : cantidad * price / (i.unidad === 'unidad' ? 1 : 1000) };
        });
        if (!applicable) missing.push('Sin costos históricos vigentes al crear el pedido');
        return { costoConocido: applicable ? Math.round(sum(consumption, x => x.costo || 0)) : 0,
            completo: applicable && !missing.length, pendientes: unique(missing), consumo: applicable ? consumption : [], recetas: recipeCopies };
    }
    // Integer largest remainder allocation. Exact sum, no lost guaraníes.
    function allocate(amount, weights) {
        const total = sum(weights, x => Math.max(0, x));
        if (!total) return weights.map(() => 0);
        const a = weights.map((w, i) => { const exact = amount * Math.max(0, w) / total; return { i, n: Math.floor(exact), rem: exact - Math.floor(exact) }; });
        let left = amount - sum(a, x => x.n);
        for (const x of a.slice().sort((a, b) => b.rem - a.rem || a.i - b.i)) { if (left-- <= 0) break; x.n++; }
        return a.map(x => x.n);
    }
    function freeze(p, cfg, menu, now = Date.now(), previous = null) {
        cfg = cfg || defaults();
        const created = ms(p.creado), applicable = !!ms(cfg.desde) && !!created && created >= ms(cfg.desde);
        const warnings = [], lines = [];
        const pool = (previous?.lineas || []).map(x => ({ ...copy(x), used: false }));
        function costFor(identity, components) {
            const prior = pool.find(x => !x.used && x.identidad === identity);
            if (prior) { prior.used = true; return { costos: prior.costos, categoria: prior.categoria }; }
            return { costos: recipeCost(components, cfg, applicable) };
        }
        for (const z of p.pizzas || []) {
            const qty = finite(z.cantidad) && z.cantidad > 0 ? Number(z.cantidad) : 1;
            const gift = z.regalo === true || z.gratis === true;
            const bundled = !gift && /mediana.*(?:gratis|regalo)|2\s*[x×]\s*1/i.test(z.nombre || '');
            const physical = bundled ? 2 : 1;
            const giftFlavors = bundled ? (Array.isArray(z.saboresRegalo) && z.saboresRegalo.length ? z.saboresRegalo : /mediana\s+muzza.*(?:gratis|regalo)/i.test(z.nombre || '') ? ['Muzza'] : []) : [];
            const cat = ['clasico', 'especial', 'gourmet'].includes(z.categoria) ? z.categoria : 'sin-identificar', flavorCount = (z.sabores || []).length;
            const key = bundled && z.tamano === 'grande' ? 'grande-con-regalo' : z.tamano;
            const components = [[gift ? 'regalo' : bundled ? 'promo' : 'base', key, qty],
                ['envase', (p.tipo || (p.origen === 'qr' ? 'local' : 'sin-identificar')) + ':' + z.tamano, qty]];
            // A promotional base recipe includes both doughs/cheese, not double toppings.
            for (const f of z.sabores || []) components.push(['sabor', f, qty / flavorCount]);
            if (bundled) {
                if (giftFlavors.length) for (const f of giftFlavors) components.push(['sabor', f, qty / giftFlavors.length]);
                else components.push(['sabor', 'REGALO SIN SABOR IDENTIFICADO', qty]);
            }
            if (!flavorCount) warnings.push('Pizza sin sabores identificados');
            if (z.borde) components.push(['borde', z.tamano, qty]);
            const categoryRecipe = cfg.recetas.find(r => r.tipo === 'categoria' && r.clave === cat);
            if (categoryRecipe) components.push(['categoria', cat, qty]);
            const identity = JSON.stringify(['pizza', z, p.tipo]);
            const prior = costFor(identity, components);
            if (cat === 'sin-identificar' && !prior.categoria) {
                prior.costos = copy(prior.costos); prior.costos.completo = false;
                prior.costos.pendientes = unique([...prior.costos.pendientes, 'Categoría histórica sin identificar']);
            }
            if (flavorCount > 1 && !z.proporcionesConfirmadas) {
                prior.costos = copy(prior.costos); prior.costos.completo = false;
                prior.costos.pendientes = unique([...prior.costos.pendientes, 'Mezcla de sabores: proporciones iguales estimadas, no confirmadas']);
            }
            lines.push({ identidad: identity, tipo: 'pizza', nombre: z.nombre || z.tamano || 'Pizza', clave: z.tamano || '',
                sabores: z.sabores || [], categoria: prior.categoria || cat, cantidad: qty, elaboradas: qty * physical,
                regalos: qty * (gift ? 1 : physical - 1), regalosAdicionales: qty * (physical - 1), saboresRegalo: giftFlavors,
                bruto: gift ? 0 : money(z.precio) * qty, precioAntesDescuento: gift ? 0 : money(z.precio), precioOriginal: finite(z.precioOriginal) ? money(z.precioOriginal) : null,
                promocion: bundled ? z.nombre : null, costos: prior.costos });
        }
        for (const e of p.extras || []) {
            const qty = Number(e.cantidad) || 0, gift = e.regalo === true;
            // Never value old extras using today's menu price.
            const price = finite(e.precioUnitario) ? money(e.precioUnitario) : finite(e.precio) ? money(e.precio) : null;
            const identity = JSON.stringify(['extra', e]);
            lines.push({ identidad: identity, tipo: 'extra', nombre: e.item || 'Extra', clave: e.item || '', sabores: [], categoria: 'extra',
                cantidad: qty, elaboradas: 0, regalos: gift ? qty : 0, bruto: gift ? 0 : price === null ? 0 : price * qty,
                precioOriginal: price, promocion: gift ? 'Regalo registrado' : null,
                costos: costFor(identity, [['extra', e.item || '', qty]]).costos });
            if (price === null) warnings.push('Extra sin precio histórico: ' + e.item);
        }
        const net = money(p.total), discount = money(p.descuento), delivery = money(p.costoDelivery);
        for (const key of ['total', 'descuento', 'costoDelivery']) if (p[key] != null && (!finite(p[key]) || !Number.isSafeInteger(Number(p[key])))) warnings.push('Importe no entero o inválido: ' + key);
        if (p.tipo === 'delivery' && !finite(p.costoDelivery)) warnings.push('Delivery sin importe histórico registrado');
        if (net < 0 || discount < 0 || delivery < 0) warnings.push('Importe negativo: revisar pedido');
        const gross = net + discount - delivery, delta = gross - sum(lines, l => l.bruto);
        if (delta) {
            warnings.push('Desglose sin conciliar: ' + delta + ' Gs');
            lines.push({ identidad: 'sin-desglose', tipo: 'ajuste', nombre: 'Importe sin desglose histórico', clave: '', sabores: [], categoria: 'sin-identificar',
                cantidad: 0, elaboradas: 0, regalos: 0, bruto: delta, precioOriginal: null, promocion: null,
                costos: { completo: false, costoConocido: 0, consumo: [], recetas: [], pendientes: ['Desglose histórico pendiente'] } });
        }
        // Web discounts apply to pizza/border only; manual unspecified discounts to all products.
        const weights = lines.map(l => p.porcentajeDescuento && l.tipo !== 'pizza' ? 0 : Math.max(0, l.bruto));
        const shares = allocate(discount, weights);
        lines.forEach((l, i) => { l.descuento = shares[i]; l.neto = l.bruto - shares[i]; });
        const undistributed = discount - sum(shares, x => x);
        if (undistributed) {
            warnings.push('Descuento sin base de distribución');
            lines.push({ identidad: 'descuento-sin-base', tipo: 'ajuste', nombre: 'Descuento sin base', clave: '', categoria: 'sin-identificar', sabores: [], cantidad: 0,
                elaboradas: 0, regalos: 0, bruto: 0, descuento: undistributed, neto: -undistributed, precioOriginal: null, promocion: null,
                costos: { completo: false, costoConocido: 0, pendientes: ['Descuento sin base'], consumo: [], recetas: [] } });
        }
        const createdParts = localParts(created);
        return { version: VERSION, pedidoId: p.id || '', firma: signature(p), capturado: now, creadoMs: created,
            revisionCostos: cfg.revision || null, corte: previous?.corte ?? cfg.corte, jornada: previous?.jornada || day(created, cfg.corte),
            hora: createdParts?.hour ?? null, diaSemana: createdParts?.weekday || null,
            canal: channel(p), modalidad: p.tipo || (p.origen === 'qr' ? 'local' : 'sin-identificar'), cliente: String(p.cliente?.celular || '').replace(/\D/g, '') || null,
            brutoProductos: gross, bruto: net + discount, descuento: discount, netoProductos: gross - discount, delivery, deliveryRegistrado: finite(p.costoDelivery), total: net,
            motivo: p.motivoDescuento || (p.porcentajeDescuento ? `Descuento registrado ${p.porcentajeDescuento}%` : discount ? 'Sin motivo registrado' : ''),
            porcentaje: p.porcentajeDescuento || null, lineas: lines, advertencias: unique(warnings),
            costoConocido: sum(lines, l => l.costos.costoConocido), costosCompletos: !warnings.length && lines.every(l => l.costos.completo),
            estado: p.estado || 'sin-identificar', pagado: p.pagado === true, pago: p.pago || 'sinDefinir', cobradoMs: ms(p.cobradoEn),
            cierreId: previous?.cierreId || null, meta: previous?.meta || {}, historial: previous ? [...(previous.historial || []), { firma: previous.firma, capturado: previous.capturado, total: previous.total, revisionCostos: previous.revisionCostos }].slice(-30) : [] };
    }
    function view(p, stored, cfg, menu) {
        if (stored?.cierreId) return copy(stored);
        const s = stored && stored.firma === signature(p) ? copy(stored) : freeze(p, cfg, menu, Date.now(), stored);
        s.estado = p.estado || 'sin-identificar'; s.pagado = p.pagado === true; s.pago = p.pago || 'sinDefinir';
        if (s.fechaPendiente && ms(p.creado)) {
            s.creadoMs = ms(p.creado); s.jornada = day(s.creadoMs, s.corte);
            const parts = localParts(s.creadoMs); s.hora = parts.hour; s.diaSemana = parts.weekday; s.fechaPendiente = false;
        }
        s.cobradoMs = ms(p.cobradoEn);
        return s;
    }
    const sold = s => s.estado === 'entregado';
    const produced = s => sold(s) || s.meta?.elaborado === true;
    function expense(g) {
        const kind = g.clase || 'sin-clasificar';
        return { ...g, monto: money(g.monto), clase: kind, medio: g.medio || 'sin-definir',
            jornada: Number.isInteger(g.corte) ? day(ms(g.creado), g.corte) : g.jornada || day(ms(g.creado), 5), creadoMs: ms(g.creado) };
    }
    function report(records, expenses = [], filters = {}, cfg = defaults()) {
        const all = [...new Map(records.map(s => [s.pedidoId, s])).values()];
        const inDate = d => !filters.desde && !filters.hasta || !!d && (!filters.desde || d >= filters.desde) && (!filters.hasta || d <= filters.hasta);
        const inProduct = s => !filters.producto && !filters.categoria || s.lineas.some(l => (!filters.producto || l.nombre.toLowerCase().includes(filters.producto.toLowerCase()) || l.sabores.some(f => f.toLowerCase().includes(filters.producto.toLowerCase()))) && (!filters.categoria || l.categoria === filters.categoria));
        const matches = s => (!filters.canal || s.canal === filters.canal) && (!filters.modalidad || s.modalidad === filters.modalidad) && inProduct(s);
        const selected = all.filter(s => inDate(s.jornada) && matches(s));
        const cashRecords = all.filter(s => s.pagado && matches(s) && inDate(day(s.cobradoMs, s.corte)));
        const refundRecords = all.filter(s => matches(s) && inDate(day(s.meta?.reembolsadoMs, s.corte)));
        const sales = selected.filter(sold), production = selected.filter(produced);
        const hasSegment = !!(filters.canal || filters.modalidad || filters.producto || filters.categoria);
        const eg = expenses.map(expense).filter(g => inDate(g.jornada));
        const s = fn => sum(sales, fn), by = (key, fn = x => x.total) => {
            const out = {};
            sales.forEach(x => { const k = x[key] ?? 'sin-identificar'; const b = out[k] ||= { nombre: k, pedidos: 0, total: 0, costoConocido: 0, completo: true }; b.pedidos++; b.total += fn(x); b.costoConocido += x.costoConocido; b.completo &&= x.costosCompletos; });
            return Object.values(out).sort((a, b) => b.total - a.total);
        };
        const revenue = s(x => x.total), productCost = sum(production, x => x.costoConocido);
        const operating = sum(eg.filter(g => ['fijo', 'variable', 'merma', 'sin-clasificar'].includes(g.clase)), g => g.monto);
        const purchases = sum(eg.filter(g => g.clase === 'compra'), g => g.monto);
        const deliveryExpenses = sum(eg.filter(g => g.clase === 'reparto'), g => g.monto);
        const assignedDelivery = sum(production, x => finite(x.meta?.costoReparto) ? money(x.meta.costoReparto) : 0);
        const deliveryKnown = production.every(x => x.modalidad !== 'delivery' || finite(x.meta?.costoReparto));
        const deliveryCost = hasSegment ? assignedDelivery : assignedDelivery + deliveryExpenses;
        const complete = production.length > 0 && production.every(x => x.costosCompletos && x.gastosCertificados === true) && deliveryKnown && !hasSegment && !eg.some(g => g.clase === 'sin-clasificar' || g.costoPendiente)
            && selected.filter(x => x.estado === 'cancelado').every(x => typeof x.meta?.elaborado === 'boolean');
        const refunds = sum(refundRecords, x => money(x.meta?.reembolso));
        const collected = sum(cashRecords, x => x.total);
        const payments = {};
        cashRecords.forEach(x => { payments[x.pago] = (payments[x.pago] || 0) + x.total; });
        const refundsByPayment = {};
        refundRecords.forEach(x => { const k = x.meta?.medioReembolso || x.pago || 'sinDefinir'; refundsByPayment[k] = (refundsByPayment[k] || 0) + money(x.meta?.reembolso); });
        const items = {}, flavors = {}, sizes = {}, categories = {}, promos = {}, consumption = {};
        for (const x of production) for (const l of x.lineas) {
            for (const c of l.costos.consumo) consumption[c.id] = (consumption[c.id] || 0) + c.cantidad;
        }
        for (const x of sales) {
            const promoKeys = unique([...(x.descuento ? [x.motivo] : []), ...(x.modalidad === 'delivery' && x.deliveryRegistrado && x.delivery === 0 ? ['Envío gratuito registrado'] : []), ...x.lineas.map(l => l.promocion).filter(Boolean)]);
            for (const key of promoKeys) {
                const b = promos[key] ||= { nombre: key, pedidos: 0, total: 0, descuento: 0, costoConocido: 0, completo: true, clientes: new Set() };
                b.pedidos++; b.total += x.total; b.descuento += x.descuento; b.costoConocido += x.costoConocido; b.completo &&= x.costosCompletos;
                if (x.cliente) b.clientes.add(x.cliente);
            }
            for (const l of x.lineas) {
                const key = l.tipo + ':' + l.nombre + ':' + l.categoria;
                const b = items[key] ||= { nombre: l.nombre, categoria: l.categoria, cantidad: 0, elaboradas: 0, regalos: 0, bruto: 0, descuento: 0, neto: 0, costoConocido: 0, completo: true };
                for (const f of ['cantidad', 'elaboradas', 'regalos', 'bruto', 'descuento', 'neto']) b[f] += l[f];
                b.costoConocido += l.costos.costoConocido; b.completo &&= l.costos.completo;
                if (l.tipo === 'pizza') {
                    sizes[l.clave] = (sizes[l.clave] || 0) + l.cantidad;
                    categories[l.categoria] = (categories[l.categoria] || 0) + l.cantidad;
                    for (const f of l.sabores) flavors[f] = (flavors[f] || 0) + l.cantidad / l.sabores.length;
                    if (l.regalosAdicionales) {
                        if (l.saboresRegalo?.length) for (const f of l.saboresRegalo) flavors[f] = (flavors[f] || 0) + l.regalosAdicionales / l.saboresRegalo.length;
                        else flavors['Regalos: sabor sin desglose'] = (flavors['Regalos: sabor sin desglose'] || 0) + l.regalosAdicionales;
                    }
                }
            }
        }
        const first = new Map();
        all.filter(sold).filter(x => x.cliente && x.creadoMs).forEach(x => { const old = first.get(x.cliente); if (!old || x.creadoMs < old) first.set(x.cliente, x.creadoMs); });
        const customers = unique(sales.map(x => x.cliente).filter(Boolean));
        const newCustomers = customers.filter(c => sales.some(x => x.cliente === c && x.creadoMs === first.get(c))).length;
        const contribution = revenue - productCost - deliveryCost;
        const fixed = sum(eg.filter(g => g.clase === 'fijo'), g => g.monto);
        const variable = sum(eg.filter(g => g.clase === 'variable'), g => g.monto);
        const contributionRate = revenue ? (contribution - variable) / revenue : 0;
        return { registros: selected, ventas: sales.length, brutas: s(x => x.bruto), brutasProductos: s(x => x.brutoProductos), descuentos: s(x => x.descuento),
            netas: revenue, netasProductos: s(x => x.netoProductos), delivery: s(x => x.delivery), gratis: sales.filter(x => x.modalidad === 'delivery' && x.deliveryRegistrado && !x.delivery).length,
            cobrado: collected, reembolsos: refunds, reembolsosPorMedio: refundsByPayment, pagos: payments, pendiente: sum(selected.filter(x => !x.pagado && x.estado !== 'cancelado'), x => x.total),
            cobrosSinFecha: sum(selected.filter(x => x.pagado && !x.cobradoMs), x => x.total),
            cancelados: selected.filter(x => x.estado === 'cancelado').length, canceladosCobrados: selected.filter(x => x.estado === 'cancelado' && x.pagado).length,
            pizzas: sum(production, x => sum(x.lineas, l => l.elaboradas)), regalos: sum(production, x => sum(x.lineas.filter(l => l.tipo === 'pizza'), l => l.regalos)),
            ticket: sales.length ? revenue / sales.length : 0, costoProduccion: productCost, costoReparto: deliveryCost,
            margenBruto: revenue - productCost, contribucion: contribution, gastosOperativos: operating, compras: purchases, mermas: sum(eg.filter(g => g.clase === 'merma'), g => g.monto),
            resultadoConocido: contribution - operating, gananciaNeta: complete ? contribution - operating : null, completo: complete,
            flujo: collected - refunds - sum(eg.filter(g => g.medio !== 'no-monetario'), g => g.monto),
            equilibrio: complete && contributionRate > 0 ? Math.ceil(fixed / contributionRate) : null,
            segmentos: hasSegment, productos: Object.values(items).sort((a, b) => b.neto - a.neto), sabores: flavors, tamanos: sizes, categorias: categories,
            canales: by('canal'), modalidades: by('modalidad'), dias: by('jornada'), horas: by('hora'), semana: by('diaSemana'),
            promociones: Object.values(promos).map(x => ({ ...x, clientes: x.clientes.size })), consumo: consumption, gastos: eg,
            clientes: { identificados: customers.length, nuevosObservados: newCustomers, recurrentes: customers.length - newCustomers, sinIdentificar: sales.filter(x => !x.cliente).length },
            advertencias: unique(selected.flatMap(x => x.advertencias).concat(selected.flatMap(x => x.lineas.flatMap(l => l.costos.pendientes)))) };
    }
    function cash(records, expenses, opening = 0) {
        const payments = { efectivo: 0, transferencia: 0, pos: 0, sinDefinir: 0 };
        records.filter(x => x.pagado).forEach(x => { const k = Object.hasOwn(payments, x.pago) ? x.pago : 'sinDefinir'; payments[k] += x.total; });
        const cashExpenses = sum(expenses.map(expense).filter(g => g.medio === 'efectivo'), g => g.monto);
        const refunds = sum(records.filter(x => (x.meta?.medioReembolso || x.pago) === 'efectivo'), x => money(x.meta?.reembolso));
        // Per-order distribution cost is an accrual, NOT automatically paid from the drawer.
        return { pagos: payments, gastosEfectivo: cashExpenses, reembolsosEfectivo: refunds,
            gastosSinMedio: sum(expenses.map(expense).filter(g => g.medio === 'sin-definir'), g => g.monto),
            esperado: money(opening) + payments.efectivo - cashExpenses - refunds };
    }
    function stock(movements, records, cfg) {
        const theoretical = {}, missing = [];
        records.filter(produced).forEach(s => s.lineas.forEach(l => {
            if (!l.costos.completo) missing.push(s.pedidoId);
            l.costos.consumo.forEach(c => theoretical[c.id] = (theoretical[c.id] || 0) + c.cantidad);
        }));
        return cfg.insumos.map(i => {
            const movs = movements.filter(m => m.insumo === i.id);
            const balance = sum(movs, m => Number(m.cantidad) || 0), used = theoretical[i.id] || 0;
            return { ...i, movimientos: balance, consumo: used, disponibleTeorico: balance - used,
                bajo: finite(i.minimo) && balance - used < Number(i.minimo), incompleto: missing.length > 0,
                ultimoConteo: movs.filter(m => m.tipo === 'conteo').sort((a, b) => (ms(b.creado) || 0) - (ms(a.creado) || 0))[0] || null };
        });
    }
    function capacity(recipe, inventory) {
        if (!recipe.completo) return null;
        const needs = recipe.consumo.filter(c => c.cantidad > 0);
        return needs.length ? Math.max(0, Math.floor(Math.min(...needs.map(c => (inventory.find(i => i.id === c.id)?.disponibleTeorico || 0) / c.cantidad)))) : null;
    }
    function csv(rows, columns) {
        const q = value => {
            let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
            if (/^[\s]*[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = "'" + s;
            return '"' + s.replace(/"/g, '""') + '"';
        };
        return '\ufeff' + [columns.map(q).join(';'), ...rows.map(r => columns.map(k => q(r[k])).join(';'))].join('\r\n');
    }
    return { VERSION, TZ, defaults, validateConfig, ms, day, localParts, money, allocate, category, channel, signature, freeze, view, sold, produced, report, cash, stock, capacity, recipeCost, csv, copy };
});
