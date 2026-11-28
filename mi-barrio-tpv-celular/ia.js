// Mi Barrio IA - mobile TPV assistant (order creation only).
//
// This module NEVER writes Firestore directly and NEVER re-implements pricing.
// It builds a compact product catalog, asks the serverless endpoint to interpret
// natural language, validates the structured draft against the LIVE menu, computes
// prices with the existing TPV helpers, shows a full preview and delegates the
// final save to the current manual-order function.
//
// If this module fails to load or the API is unavailable, the manual TPV keeps
// working unchanged.

export const IA_STORAGE_KEY = 'mbia.consumo.v1';
export const IA_LAST_ORDER_KEY = 'mbia.ultimoPedido.v1';
export const IA_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
export const IA_MAX_MESSAGE = 1200;

const INSTANCES = new WeakMap();

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

function unique(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}

function allFlavors(menu) {
    const source = isObject(menu && menu.sabores) ? menu.sabores : {};
    return ['clasico', 'especial', 'gourmet'].flatMap((category) => (
        Array.isArray(source[category]) ? source[category] : []
    ));
}

function canonicalFlavor(menu, value) {
    const wanted = String(value || '').trim().toLowerCase();
    if (!wanted) return '';
    return allFlavors(menu).find((flavor) => String(flavor).trim().toLowerCase() === wanted) || '';
}

function extraById(menu, id) {
    const list = Array.isArray(menu && menu.extras) ? menu.extras : [];
    return list.find((extra) => String(extra && extra[0]) === String(id)) || null;
}

function defaultName(draft) {
    if (draft.tipo === 'retiro') return 'Mostrador';
    if (draft.tipo === 'local' && draft.mesa) return 'Mesa ' + draft.mesa;
    return 'Cliente';
}

// ===== Pure helpers (exported for focused Node tests) =====

// The catalog deliberately excludes prices, customers, totals and history.
// The server only needs product names/ids to map the instruction; the client
// calculates every amount with the existing TPV functions.
export function buildCatalog(menu) {
    const source = isObject(menu) ? menu : {};
    const tamanos = Object.entries(isObject(source.tamanos) ? source.tamanos : {})
        .map(([id, size]) => ({
            id,
            nombre: text(String((size && (size.nombre || size.corto)) || id), 80),
            corto: text(String((size && (size.corto || size.nombre)) || id), 40),
            limite: Math.max(1, Math.min(10, Number(size && size.limite) || 1)),
            borde: Number(size && size.borde) > 0,
        }))
        .slice(0, 20);
    const sabores = {};
    for (const category of ['clasico', 'especial', 'gourmet']) {
        sabores[category] = (Array.isArray(source.sabores && source.sabores[category]) ? source.sabores[category] : [])
            .map((flavor) => text(String(flavor), 60))
            .filter(Boolean)
            .slice(0, 100);
    }
    const extras = (Array.isArray(source.extras) ? source.extras : [])
        .map((extra) => ({ id: text(String(extra && extra[0]), 40), nombre: text(String((extra && extra[1]) || (extra && extra[0])), 80) }))
        .filter((extra) => extra.id)
        .slice(0, 50);
    return { tamanos, sabores, extras };
}

export function buscarCliente(clientes, cliente, waNumero) {
    const list = Array.isArray(clientes) ? clientes : [];
    const phone = cliente && cliente.celular ? waNumero(cliente.celular) : '';
    if (phone && phone.length === 12) {
        const byPhone = list.find((item) => String(item.id) === phone || waNumero(item.celular) === phone);
        if (byPhone) return byPhone;
    }
    const name = String((cliente && cliente.nombre) || '').trim().toLowerCase();
    if (name) {
        const byName = list.find((item) => String(item.nombre || '').trim().toLowerCase() === name);
        if (byName) return byName;
    }
    return null;
}

export function huellaPedido(draft) {
    if (!draft || draft.accion !== 'pedido') return '';
    return JSON.stringify({
        tipo: draft.tipo,
        mesa: draft.mesa,
        celular: draft.cliente && draft.cliente.celular ? draft.cliente.celular : '',
        pizzas: (draft.pizzas || []).map((pizza) => [
            pizza.tamano,
            (pizza.sabores || []).slice().sort(),
            !!pizza.borde,
        ]),
        extras: (draft.extras || [])
            .map((extra) => [extra.id, extra.cantidad])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        total: draft.total,
    });
}

export function leerConsumo(storage) {
    try {
        const raw = storage && storage.getItem(IA_STORAGE_KEY);
        const value = raw ? JSON.parse(raw) : null;
        if (isObject(value)) {
            return {
                consultas: Number(value.consultas) || 0,
                tokensEntrada: Number(value.tokensEntrada) || 0,
                tokensSalida: Number(value.tokensSalida) || 0,
                costoUsd: Number(value.costoUsd) || 0,
                costoConocido: value.costoConocido !== false,
                actualizado: Number(value.actualizado) || 0,
            };
        }
    } catch (e) {
        // Private mode or corrupted storage: start a fresh local counter.
    }
    return { consultas: 0, tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, costoConocido: true, actualizado: 0 };
}

export function guardarConsumo(storage, consumo) {
    try {
        if (storage) storage.setItem(IA_STORAGE_KEY, JSON.stringify(consumo));
    } catch (e) {
        // The on-screen counter is best effort; never break the assistant.
    }
}

export function sumarConsumo(previous, uso, now = Date.now()) {
    const base = isObject(previous)
        ? previous
        : { consultas: 0, tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, costoConocido: true };
    const cost = uso && uso.costoUsd;
    const known = cost !== null && cost !== undefined && Number.isFinite(Number(cost));
    return {
        consultas: (Number(base.consultas) || 0) + 1,
        tokensEntrada: (Number(base.tokensEntrada) || 0) + (Number(uso && uso.tokensEntrada) || 0),
        tokensSalida: (Number(base.tokensSalida) || 0) + (Number(uso && uso.tokensSalida) || 0),
        costoUsd: (Number(base.costoUsd) || 0) + (known ? Number(cost) : 0),
        costoConocido: base.costoConocido !== false && known,
        actualizado: now,
    };
}

export function formatoConsumo(consumo, ultimo) {
    const number = (value) => Number(value || 0).toLocaleString('es-PY');
    const usd = (value) => Number(value || 0).toLocaleString('es-PY', {
        minimumFractionDigits: 6,
        maximumFractionDigits: 6,
    });
    const parts = [];
    if (ultimo) {
        parts.push('Última: ' + number((Number(ultimo.tokensEntrada) || 0) + (Number(ultimo.tokensSalida) || 0)) + ' tokens');
        if (ultimo.costoUsd === null || ultimo.costoUsd === undefined) parts.push('costo no configurado');
        else parts.push('US$ ' + usd(ultimo.costoUsd));
    }
    if (consumo) {
        parts.push('Total: ' + number(consumo.consultas) + ' consultas · ' +
            number((Number(consumo.tokensEntrada) || 0) + (Number(consumo.tokensSalida) || 0)) + ' tokens');
        if (consumo.costoConocido) parts.push('US$ ' + usd(consumo.costoUsd));
    }
    return parts.join(' · ');
}

export function leerUltimoPedido(storage) {
    try {
        const raw = storage && storage.getItem(IA_LAST_ORDER_KEY);
        const value = raw ? JSON.parse(raw) : null;
        if (isObject(value) && typeof value.h === 'string' && Number.isFinite(Number(value.at))) {
            return { h: value.h, at: Number(value.at) };
        }
    } catch (e) {
        // Ignore storage failures.
    }
    return null;
}

export function guardarUltimoPedido(storage, hash, now = Date.now()) {
    try {
        if (storage) storage.setItem(IA_LAST_ORDER_KEY, JSON.stringify({ h: hash, at: now }));
    } catch (e) {
        // Best effort only.
    }
}

function rawFromDraft(draft) {
    if (!draft || draft.accion !== 'pedido') return null;
    const groups = new Map();
    for (const pizza of draft.pizzas || []) {
        const key = JSON.stringify([pizza.tamano, pizza.sabores, !!pizza.borde]);
        const current = groups.get(key);
        if (current) current.cantidad += 1;
        else groups.set(key, { tamano: pizza.tamano, sabores: pizza.sabores.slice(), borde: !!pizza.borde, cantidad: 1 });
    }
    return {
        accion: 'pedido',
        tipo: draft.tipo,
        mesa: draft.mesa,
        cliente: {
            nombre: draft.cliente && draft.cliente.nombre === defaultName(draft) ? null : (draft.cliente && draft.cliente.nombre) || null,
            celular: null,
            referencia: (draft.cliente && draft.cliente.referencia) || null,
            mapa: (draft.cliente && draft.cliente.mapa) || null,
            notas: (draft.cliente && draft.cliente.notas) || null,
        },
        pizzas: [...groups.values()],
        extras: (draft.extras || []).map((extra) => ({ id: extra.id, cantidad: extra.cantidad })),
        pago: draft.pago,
        entrada: draft.entrada,
        descuento: {
            tipo: draft.descuento > 0 ? 'monto' : 'ninguno',
            valor: draft.descuento || 0,
            motivo: draft.motivo || null,
        },
        faltantes: draft.avisos || [],
        aclaracion: draft.aclaracion || '',
    };
}

// Turns the model's semantic draft into a validated, priced draft using the
// SAME live menu and the SAME TPV helpers. It never trusts model prices.
export async function prepararBorrador({ raw, menu, tramos, mesas, clientes, helpers }) {
    const source = isObject(raw) ? raw : {};
    const action = ['pedido', 'cancelar', 'no_entendido'].includes(source.accion) ? source.accion : 'pedido';
    if (action !== 'pedido') {
        return {
            accion: action,
            mensaje: text(source.aclaracion, 500),
            errores: [],
            faltantes: [],
            avisos: [],
            listo: false,
        };
    }

    const errors = [];
    const missing = [];
    const notices = [];
    const tipo = ['retiro', 'local', 'delivery'].includes(source.tipo) ? source.tipo : 'retiro';
    if (!['retiro', 'local', 'delivery'].includes(source.tipo)) {
        notices.push('No se indicó el tipo de pedido; se asumió retiro.');
    }

    const menuSafe = isObject(menu) ? menu : {};
    const clientesSafe = Array.isArray(clientes) ? clientes : [];
    const mesasSafe = (Array.isArray(mesas) ? mesas : []).map(Number).filter((value) => Number.isInteger(value));

    // ----- customer -----
    const rawClient = isObject(source.cliente) ? source.cliente : {};
    const cliente = {
        nombre: text(rawClient.nombre, 60).trim(),
        celular: '',
        referencia: text(rawClient.referencia, 500).trim(),
        mapa: '',
        notas: text(rawClient.notas, 150).trim(),
    };
    const rawPhone = text(rawClient.celular, 30).trim();
    if (rawPhone) {
        const phone = helpers.waNumero(rawPhone);
        if (phone.length === 12) cliente.celular = phone;
        else errors.push('El celular no es válido. Ejemplo: 0981 123 456.');
    }

    const rawMap = text(rawClient.mapa, 500).trim();
    if (rawMap) {
        const link = helpers.linkMaps(rawMap);
        const coords = helpers.coordsDeMaps(link || rawMap);
        if (link) cliente.mapa = link;
        else if (coords) cliente.mapa = helpers.linkDeCoords(coords);
        else if (tipo === 'delivery') errors.push('El link de Google Maps no es válido.');
    }

    // Client memory is searched locally. The full customer database never leaves the browser.
    const match = buscarCliente(clientesSafe, cliente, helpers.waNumero);
    if (match) {
        if (!cliente.nombre && match.nombre) cliente.nombre = text(String(match.nombre), 60).trim();
        if (!cliente.celular && match.celular) {
            const phone = helpers.waNumero(match.celular);
            if (phone.length === 12) cliente.celular = phone;
        }
        if (!cliente.referencia && match.direccion && !helpers.linkMaps(match.direccion)) {
            cliente.referencia = text(String(match.direccion), 500).trim();
        }
        if (tipo === 'delivery' && !cliente.mapa && typeof helpers.ubicacionCliente === 'function') {
            const saved = helpers.ubicacionCliente(match);
            const link = helpers.linkMaps(saved);
            const coords = helpers.coordsDeMaps(link || saved);
            if (link) cliente.mapa = link;
            else if (coords) cliente.mapa = helpers.linkDeCoords(coords);
        }
    }

    // ----- pizzas (expanded to individual units, exactly like the manual flow) -----
    const pizzas = [];
    const rawPizzas = Array.isArray(source.pizzas) ? source.pizzas : [];
    for (let index = 0; index < rawPizzas.length; index += 1) {
        const item = rawPizzas[index];
        const size = item && menuSafe.tamanos ? menuSafe.tamanos[item.tamano] : null;
        if (!size) {
            errors.push('Pizza ' + (index + 1) + ': el tamaño no está disponible.');
            continue;
        }
        const requested = Array.isArray(item.sabores) ? item.sabores : [];
        const flavors = unique(requested.map((flavor) => canonicalFlavor(menuSafe, flavor)).filter(Boolean));
        const invalid = requested.filter((flavor) => !canonicalFlavor(menuSafe, flavor));
        if (invalid.length) {
            errors.push('Pizza ' + (index + 1) + ': sabor no disponible: ' + invalid.join(', ') + '.');
            continue;
        }
        if (!flavors.length) {
            errors.push('Pizza ' + (index + 1) + ': falta el sabor.');
            continue;
        }
        if (flavors.length > Number(size.limite || 1)) {
            errors.push('Pizza ' + (index + 1) + ': ' + (size.corto || item.tamano) + ' admite hasta ' + size.limite + ' sabores.');
            continue;
        }
        const quantity = Math.max(1, Math.min(20, Math.round(Number(item.cantidad) || 1)));
        const border = !!item.borde && Number(size.borde) > 0;
        const category = helpers.nuevoCat(flavors);
        const unitPrice = helpers.nuevoPrecio(item.tamano, flavors, border);
        for (let copy = 0; copy < quantity; copy += 1) {
            pizzas.push({
                tamano: item.tamano,
                categoria: category,
                sabores: flavors.slice(),
                borde: border,
                precio: unitPrice,
            });
        }
    }
    if (pizzas.length > 50) errors.push('Hay demasiadas pizzas para un solo pedido (máximo 50).');

    // ----- extras -----
    const extras = [];
    for (const item of (Array.isArray(source.extras) ? source.extras : [])) {
        const found = extraById(menuSafe, item && item.id);
        if (!found) {
            errors.push('Extra no reconocido: ' + text(String(item && item.id), 40) + '.');
            continue;
        }
        const quantity = Math.max(1, Math.min(50, Math.round(Number(item.cantidad) || 1)));
        extras.push({
            id: String(found[0]),
            nombre: String(found[1]),
            cantidad: quantity,
            precioUnitario: Number(found[2]) || 0,
        });
    }
    if (!pizzas.length && !extras.length) errors.push('El pedido no tiene pizzas ni extras.');

    const subPizzas = pizzas.reduce((sum, pizza) => sum + pizza.precio, 0);
    const subExtras = extras.reduce((sum, extra) => sum + extra.precioUnitario * extra.cantidad, 0);
    const sub = subPizzas + subExtras;

    // ----- discount (only if explicitly requested by the cashier) -----
    const rawDiscount = isObject(source.descuento) ? source.descuento : {};
    const motivo = text(rawDiscount.motivo, 100).trim();
    let descuento = 0;
    if (rawDiscount.tipo === 'monto') {
        descuento = Math.max(0, Math.round(Number(rawDiscount.valor) || 0));
    } else if (rawDiscount.tipo === 'porcentaje') {
        const percent = Math.max(0, Math.min(100, Number(rawDiscount.valor) || 0));
        // Same semantic as the web promotion: only the pizza subtotal.
        descuento = Math.round((subPizzas * percent) / 100);
    }
    if (descuento > 0 && !motivo) errors.push('Indicá el motivo del descuento.');
    if (descuento > sub) errors.push('El descuento no puede superar los productos del pedido.');

    // ----- local table -----
    let mesa = null;
    if (tipo === 'local') {
        const candidate = Number(source.mesa);
        if (Number.isInteger(candidate) && mesasSafe.includes(candidate)) mesa = candidate;
        else missing.push('mesa');
    }

    // ----- payment / entry -----
    const pago = ['efectivo', 'transferencia', 'pos'].includes(source.pago) ? source.pago : null;
    const entrada = source.entrada === 'entregado' ? 'entregado' : 'nuevo';
    if (entrada === 'entregado' && !pago) missing.push('medio de pago');

    // ----- delivery (reuses the existing distance/tier calculation) -----
    let envio = 0;
    let distanciaKm = null;
    let deliveryFuera = false;
    let envioManual = source.envioManual === true && Number(source.envio) > 0;
    if (tipo === 'delivery') {
        if (!cliente.mapa) missing.push('link de Google Maps o coordenadas');
        else {
            const coords = helpers.coordsDeMaps(cliente.mapa);
            if (!coords) {
                errors.push('No pude leer las coordenadas del link de Google Maps. Pegá el link largo (con @lat,lng).');
            } else {
                try {
                    const calculated = await helpers.calcularDelivery(coords);
                    distanciaKm = calculated && calculated.km != null ? Number(calculated.km) : null;
                    deliveryFuera = !!(calculated && calculated.fuera);
                    if (deliveryFuera) {
                        errors.push('La zona no está cubierta por el delivery.');
                    } else if (envioManual) {
                        envio = Math.round(Number(source.envio));
                    } else {
                        envio = Math.max(0, Math.round(Number(calculated && calculated.costo) || 0));
                        if (!(envio > 0)) missing.push('costo de delivery');
                    }
                } catch (e) {
                    if (envioManual) {
                        envio = Math.round(Number(source.envio));
                    } else {
                        errors.push('No se pudo calcular el delivery. Elegí un tramo a mano.');
                    }
                }
            }
        }
    }
    if (envioManual && envio > 0) {
        // A manual tier is allowed, but the save path still requires a valid map.
        const index = missing.indexOf('costo de delivery');
        if (index >= 0) missing.splice(index, 1);
    }

    const nombreFinal = cliente.nombre || (tipo === 'retiro' ? 'Mostrador' : (tipo === 'local' && mesa ? 'Mesa ' + mesa : 'Cliente'));
    for (const item of (Array.isArray(source.faltantes) ? source.faltantes : [])) {
        const notice = text(item, 120).trim();
        if (notice && !missing.includes(notice) && !notices.includes(notice)) notices.push(notice);
    }

    const total = Math.max(0, sub + envio - descuento);
    const faltantes = unique(missing);
    const errores = unique(errors);
    return {
        accion: 'pedido',
        tipo,
        mesa,
        cliente: { ...cliente, nombre: nombreFinal },
        pizzas,
        extras,
        pago,
        entrada,
        descuento,
        motivo,
        envio,
        distanciaKm,
        deliveryFuera,
        envioManual,
        sub,
        subPizzas,
        subExtras,
        total,
        faltantes,
        errores,
        avisos: unique(notices),
        aclaracion: text(source.aclaracion, 500).trim(),
        listo: errores.length === 0 && faltantes.length === 0,
    };
}

// ===== UI factory =====

export function createMiBarrioIA(context = {}) {
    const doc = context.document || (typeof document !== 'undefined' ? document : null);
    const win = context.window || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    if (!doc || !win || context.enabled === false) return null;
    const panel = doc.getElementById('panel');
    if (!panel) return null;
    const existing = INSTANCES.get(doc);
    if (existing) return existing;

    const esc = context.esc || ((value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character])));
    const gs = context.gs || ((value) => Number(value || 0).toLocaleString('es-PY') + ' Gs');
    const endpoint = String(context.endpoint || '/api/mi-barrio-ia');
    const fetchFn = context.fetch || (win.fetch ? win.fetch.bind(win) : null);
    const storage = context.storage !== undefined ? context.storage : (() => {
        try { return win.localStorage; } catch (e) { return null; }
    })();

    let state = {
        draft: null,
        raw: null,
        loading: false,
        confirming: false,
        open: false,
        lastUsage: null,
        consumo: leerConsumo(storage),
        speech: null,
    };

    const fab = doc.createElement('button');
    fab.id = 'mbia-fab';
    fab.type = 'button';
    fab.className = 'mbia-fab';
    fab.setAttribute('aria-label', 'Abrir Mi Barrio IA');
    fab.innerHTML = '<span class="mbia-fab-icon" aria-hidden="true">🤖</span><span class="mbia-fab-label">Mi Barrio IA</span>';

    const modal = doc.createElement('div');
    modal.id = 'mbia-modal';
    modal.className = 'mbia-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'mbia-title');
    modal.innerHTML = `
        <div class="mbia-sheet">
            <header class="mbia-head">
                <div>
                    <h2 id="mbia-title">🤖 Mi Barrio IA</h2>
                    <p>Pedidos por texto o dictado</p>
                </div>
                <button type="button" class="mbia-close" id="mbia-close" aria-label="Cerrar Mi Barrio IA">✕</button>
            </header>
            <div class="mbia-body">
                <p class="mbia-note">La IA interpreta el pedido. Los precios, el delivery y el total los calcula el TPV. Revisá todo antes de confirmar.</p>
                <label class="mbia-label" for="mbia-input">Instrucción</label>
                <textarea id="mbia-input" class="mbia-input" rows="3" maxlength="${IA_MAX_MESSAGE}" enterkeyhint="send" placeholder="Ej: 2 muzza grandes con borde, retiro, efectivo, Juan 0981 123 456"></textarea>
                <div class="mbia-actions">
                    <button type="button" id="mbia-mic" class="mbia-btn mbia-btn-ghost" hidden>🎤 Dictar</button>
                    <button type="button" id="mbia-send" class="mbia-btn mbia-btn-primary">Interpretar</button>
                </div>
                <p id="mbia-status" class="mbia-status" role="status" aria-live="polite"></p>
                <div id="mbia-preview" class="mbia-preview"></div>
                <p id="mbia-usage" class="mbia-usage"></p>
            </div>
        </div>`;
    panel.appendChild(fab);
    panel.appendChild(modal);

    const $ = (id) => doc.getElementById(id);
    const input = $('mbia-input');
    const send = $('mbia-send');
    const mic = $('mbia-mic');
    const status = $('mbia-status');
    const preview = $('mbia-preview');
    const usage = $('mbia-usage');
    const closeButton = $('mbia-close');

    function setStatus(message, tone = 'none') {
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function renderUsage() {
        usage.textContent = formatoConsumo(state.consumo, state.lastUsage);
    }

    function tipoLabel(value) {
        const types = typeof context.tipos === 'function' ? context.tipos() : null;
        return (types && types[value] && types[value].label) || value;
    }

    function pagoLabel(value) {
        const payments = typeof context.pagos === 'function' ? context.pagos() : null;
        return (payments && payments[value] && payments[value].label) || value;
    }

    function groupPizzas(pizzas) {
        const groups = new Map();
        for (const pizza of pizzas || []) {
            const key = JSON.stringify([pizza.tamano, pizza.sabores, !!pizza.borde, pizza.precio]);
            const current = groups.get(key);
            if (current) current.cantidad += 1;
            else groups.set(key, {
                tamano: pizza.tamano,
                sabores: pizza.sabores.slice(),
                borde: !!pizza.borde,
                precio: pizza.precio,
                cantidad: 1,
            });
        }
        return [...groups.values()];
    }

    function renderPreview() {
        const draft = state.draft;
        if (!draft) {
            preview.innerHTML = `
                <div class="mbia-empty">
                    <p><strong>Escribí el pedido como se lo dirías a un compañero.</strong></p>
                    <p class="mbia-examples">Ejemplos: “una grande de muzza y una Coca de 1 litro para retiro, paga en efectivo” · “dos medianas, una de calabresa y otra de cuatro quesos, para la mesa 3” · “delivery a la casa de Juan, link de Maps …”.</p>
                    <p class="mbia-examples">También podés usar el micrófono del teclado del celular o el botón 🎤 Dictar.</p>
                </div>`;
            return;
        }
        if (draft.accion === 'cancelar') {
            preview.innerHTML = '<div class="mbia-empty"><p>Borrador descartado.</p></div>';
            return;
        }
        if (draft.accion === 'no_entendido') {
            preview.innerHTML = '<div class="mbia-empty"><p>' + esc(draft.mensaje || 'No entendí el pedido. Probá con otras palabras.') + '</p></div>';
            return;
        }

        const menu = typeof context.menu === 'function' ? context.menu() : {};
        const pizzas = groupPizzas(draft.pizzas);
        const pizzaHtml = pizzas.map((pizza) => {
            const size = menu && menu.tamanos ? menu.tamanos[pizza.tamano] : null;
            return `<li><span class="mbia-item-name">${pizza.cantidad}× ${esc((size && size.corto) || pizza.tamano)} · ${esc(pizza.sabores.join(' / '))}${pizza.borde ? ' · Borde relleno' : ''}</span><span class="mbia-item-price">${gs(pizza.precio * pizza.cantidad)}</span></li>`;
        }).join('');
        const extrasHtml = (draft.extras || []).map((extra) => (
            `<li><span class="mbia-item-name">${esc(extra.nombre)} ×${extra.cantidad}</span><span class="mbia-item-price">${gs(extra.precioUnitario * extra.cantidad)}</span></li>`
        )).join('');
        const phone = draft.cliente.celular && context.helpers && context.helpers.celLocal
            ? context.helpers.celLocal({ celular: draft.cliente.celular })
            : '';
        const maps = draft.cliente.mapa
            ? `<a class="mbia-map" href="${esc(draft.cliente.mapa)}" target="_blank" rel="noopener">🗺️ Abrir ubicación</a>`
            : '';
        const typeButtons = ['retiro', 'local', 'delivery'].map((type) => (
            `<button type="button" data-mbia-tipo="${type}" class="mbia-chip ${draft.tipo === type ? 'is-on' : ''}">${esc(tipoLabel(type))}</button>`
        )).join('');
        const mesaButtons = draft.tipo === 'local'
            ? `<div class="mbia-fix"><span class="mbia-fix-label">Mesa</span><div class="mbia-chips">${(typeof context.mesas === 'function' ? context.mesas() : []).map((number) => (
                `<button type="button" data-mbia-mesa="${Number(number)}" class="mbia-chip ${Number(draft.mesa) === Number(number) ? 'is-on' : ''}">Mesa ${Number(number)}</button>`
            )).join('')}</div></div>`
            : '';
        const deliveryFix = draft.tipo === 'delivery'
            ? `<div class="mbia-fix">
                    <label class="mbia-fix-label" for="mbia-mapa">Link de Google Maps</label>
                    <div class="mbia-map-row">
                        <input id="mbia-mapa" class="mbia-input mbia-input-compact" maxlength="500" value="${esc(draft.cliente.mapa || '')}" placeholder="Pegá el link largo (con @lat,lng)">
                        <button type="button" data-mbia-calcular class="mbia-btn mbia-btn-small">Calcular</button>
                    </div>
                    <div class="mbia-chips">${(typeof context.tramos === 'function' ? context.tramos() : []).map((tier) => {
                        const cost = Number(tier.costo);
                        return `<button type="button" data-mbia-envio="${cost}" class="mbia-chip ${Number(draft.envio) === cost ? 'is-on' : ''}">${cost / 1000} mil</button>`;
                    }).join('')}</div>
                </div>`
            : '';
        const paymentButtons = ['efectivo', 'transferencia', 'pos'].map((payment) => (
            `<button type="button" data-mbia-pago="${payment}" class="mbia-chip ${draft.pago === payment ? 'is-on' : ''}">${esc(pagoLabel(payment))}</button>`
        )).join('');
        const entryButtons = [['nuevo', '🔔 A cocina'], ['entregado', '✅ Ya entregado y cobrado']].map(([entry, label]) => (
            `<button type="button" data-mbia-entrada="${entry}" class="mbia-chip ${draft.entrada === entry ? 'is-on' : ''}">${label}</button>`
        )).join('');
        const issues = [
            ...(draft.errores || []).map((item) => `<li class="is-error">${esc(item)}</li>`),
            ...(draft.faltantes || []).map((item) => `<li class="is-missing">Falta: ${esc(item)}</li>`),
            ...(draft.avisos || []).map((item) => `<li class="is-notice">${esc(item)}</li>`),
        ].join('');
        const summary = [
            '<div class="mbia-summary">',
            `<div><span>Tipo</span><strong>${esc(tipoLabel(draft.tipo))}${draft.mesa ? ' · Mesa ' + esc(draft.mesa) : ''}</strong></div>`,
            `<div><span>Cliente</span><strong>${esc(draft.cliente.nombre)}${phone ? ' · ' + esc(phone) : ''}</strong></div>`,
            draft.cliente.referencia ? `<div><span>Referencia</span><strong>${esc(draft.cliente.referencia)}</strong></div>` : '',
            draft.cliente.notas ? `<div><span>Notas</span><strong>${esc(draft.cliente.notas)}</strong></div>` : '',
            `<div><span>Pago</span><strong>${draft.pago ? esc(pagoLabel(draft.pago)) : 'Sin definir'} · ${draft.entrada === 'entregado' ? 'Ya cobrado' : 'A cocina'}</strong></div>`,
            '</div>',
        ].join('');

        preview.innerHTML = `
            ${draft.aclaracion ? `<p class="mbia-aclaracion">“${esc(draft.aclaracion)}”</p>` : ''}
            ${issues ? `<ul class="mbia-issues">${issues}</ul>` : ''}
            ${summary}
            <div class="mbia-fix"><span class="mbia-fix-label">Tipo de pedido</span><div class="mbia-chips">${typeButtons}</div></div>
            ${mesaButtons}
            ${deliveryFix}
            <div class="mbia-fix"><span class="mbia-fix-label">Pago</span><div class="mbia-chips">${paymentButtons}</div></div>
            <div class="mbia-fix"><span class="mbia-fix-label">Cómo entra</span><div class="mbia-chips">${entryButtons}</div></div>
            <ul class="mbia-items">${pizzaHtml}${extrasHtml}</ul>
            <div class="mbia-totals">
                <div><span>Subtotal</span><strong>${gs(draft.sub)}</strong></div>
                ${draft.envio > 0 ? `<div><span>🛵 Delivery${draft.distanciaKm != null ? ' · ' + Number(draft.distanciaKm).toFixed(1) + ' km' : ''}</span><strong>+ ${gs(draft.envio)}</strong></div>` : ''}
                ${draft.descuento > 0 ? `<div class="is-discount"><span>Descuento${draft.motivo ? ' · ' + esc(draft.motivo) : ''}</span><strong>− ${gs(draft.descuento)}</strong></div>` : ''}
                <div class="mbia-total"><span>TOTAL</span><strong>${gs(draft.total)}</strong></div>
            </div>
            ${maps}
            <div class="mbia-confirm-row">
                <button type="button" data-mbia-confirmar class="mbia-btn mbia-btn-primary" ${draft.listo && !state.confirming ? '' : 'disabled'}>${state.confirming ? 'Guardando…' : '✅ Confirmar pedido · ' + gs(draft.total)}</button>
                <button type="button" data-mbia-editar class="mbia-btn mbia-btn-ghost">✏️ Editar en formulario</button>
                <button type="button" data-mbia-descartar class="mbia-btn mbia-btn-ghost">🗑️ Descartar</button>
            </div>`;
    }

    async function revalidar(patch = {}) {
        if (!state.draft || state.draft.accion !== 'pedido') return;
        const base = rawFromDraft(state.draft);
        if (!base) return;
        if (patch.tipo) {
            base.tipo = patch.tipo;
            if (patch.tipo !== 'local') base.mesa = null;
            if (patch.tipo !== 'delivery') {
                base.envio = 0;
                base.envioManual = false;
            }
        }
        if (patch.mesa !== undefined) base.mesa = patch.mesa;
        if (patch.pago !== undefined) base.pago = patch.pago;
        if (patch.entrada !== undefined) base.entrada = patch.entrada;
        if (patch.mapa !== undefined) base.cliente.mapa = patch.mapa;
        if (patch.envio !== undefined) {
            base.envio = patch.envio;
            base.envioManual = true;
        }
        try {
            const draft = await prepararBorrador({
                raw: base,
                menu: typeof context.menu === 'function' ? context.menu() : {},
                tramos: typeof context.tramos === 'function' ? context.tramos() : [],
                mesas: typeof context.mesas === 'function' ? context.mesas() : [],
                clientes: typeof context.clientes === 'function' ? context.clientes() : [],
                helpers: context.helpers,
            });
            state.raw = base;
            state.draft = draft;
            setStatus(
                draft.errores.length ? 'Revisá los avisos antes de confirmar.' : (draft.listo ? 'Pedido listo para confirmar.' : 'Faltan datos para confirmar.'),
                draft.errores.length ? 'error' : (draft.listo ? 'ok' : 'warn'),
            );
            renderPreview();
        } catch (e) {
            setStatus('No se pudo recalcular el pedido: ' + (e && e.message ? e.message : 'error'), 'error');
        }
    }

    async function interpretar() {
        if (state.loading) return;
        const message = input.value.trim();
        if (!message) {
            setStatus('Escribí o dictá un pedido.', 'error');
            input.focus();
            return;
        }
        const user = context.auth && context.auth.currentUser;
        if (!user || (typeof context.isAdminUid === 'function' && !context.isAdminUid(user.uid))) {
            setStatus('Necesitás la sesión del administrador para usar Mi Barrio IA.', 'error');
            return;
        }
        if (!fetchFn) {
            setStatus('Este navegador no puede conectarse con Mi Barrio IA.', 'error');
            return;
        }
        state.loading = true;
        send.disabled = true;
        setStatus('Interpretando el pedido…', 'loading');
        try {
            const token = await user.getIdToken();
            const response = await fetchFn(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
                body: JSON.stringify({
                    mensaje: message,
                    borrador: state.draft && state.draft.accion === 'pedido' ? rawFromDraft(state.draft) : null,
                    catalogo: buildCatalog(typeof context.menu === 'function' ? context.menu() : {}),
                    mesas: typeof context.mesas === 'function' ? context.mesas() : [],
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) {
                setStatus(data.error || 'No se pudo interpretar el pedido. Probá de nuevo.', 'error');
                return;
            }
            state.lastUsage = data.uso || null;
            state.consumo = sumarConsumo(state.consumo, data.uso);
            guardarConsumo(storage, state.consumo);
            renderUsage();
            const raw = data.pedido;
            if (raw && raw.accion === 'cancelar') {
                state.draft = null;
                state.raw = null;
                setStatus('Borrador descartado.', 'ok');
                renderPreview();
                return;
            }
            if (raw && raw.accion === 'no_entendido') {
                state.draft = { accion: 'no_entendido', mensaje: text(raw.aclaracion, 500) || 'No entendí el pedido. Probá con otras palabras.' };
                state.raw = null;
                setStatus('La IA no interpretó un pedido nuevo.', 'warn');
                renderPreview();
                return;
            }
            const draft = await prepararBorrador({
                raw,
                menu: typeof context.menu === 'function' ? context.menu() : {},
                tramos: typeof context.tramos === 'function' ? context.tramos() : [],
                mesas: typeof context.mesas === 'function' ? context.mesas() : [],
                clientes: typeof context.clientes === 'function' ? context.clientes() : [],
                helpers: context.helpers,
            });
            state.raw = raw;
            state.draft = draft;
            setStatus(
                draft.errores.length ? 'Revisá los avisos antes de confirmar.' : (draft.listo ? 'Pedido listo para confirmar.' : 'Faltan datos para confirmar.'),
                draft.errores.length ? 'error' : (draft.listo ? 'ok' : 'warn'),
            );
            renderPreview();
        } catch (e) {
            setStatus('No se pudo conectar con Mi Barrio IA. El TPV manual sigue funcionando.', 'error');
        } finally {
            state.loading = false;
            send.disabled = false;
        }
    }

    async function confirmar() {
        if (!state.draft || state.draft.accion !== 'pedido' || !state.draft.listo || state.confirming) return;
        const hash = huellaPedido(state.draft);
        const last = leerUltimoPedido(storage);
        if (last && last.h === hash && Date.now() - last.at < IA_DUPLICATE_WINDOW_MS) {
            const proceed = typeof win.confirm === 'function'
                ? win.confirm('Ya se guardó un pedido idéntico hace menos de 2 minutos.\n\n¿Crear otro igual?')
                : false;
            if (!proceed) return;
        }
        state.confirming = true;
        renderPreview();
        setStatus('Guardando el pedido…', 'loading');
        try {
            const result = await context.confirmarBorrador(state.draft);
            if (result && result.ok) {
                guardarUltimoPedido(storage, hash);
                state.draft = null;
                state.raw = null;
                setStatus('Pedido guardado. La comanda sigue el flujo normal del TPV.', 'ok');
                if (typeof context.mostrarToast === 'function') context.mostrarToast('✅ Pedido guardado por Mi Barrio IA');
                close();
            } else {
                setStatus((result && result.error) || 'No se pudo guardar el pedido.', 'error');
                if (result && result.abrioFormulario) close();
            }
        } catch (e) {
            setStatus('No se pudo guardar el pedido: ' + (e && e.message ? e.message : 'error'), 'error');
        } finally {
            state.confirming = false;
            renderPreview();
        }
    }

    function editar() {
        if (!state.draft || state.draft.accion !== 'pedido') return;
        const result = context.aplicarBorrador(state.draft);
        if (!result || !result.ok) {
            setStatus((result && result.error) || 'No se pudo abrir el formulario.', 'error');
            return;
        }
        if (typeof context.abrirFormulario === 'function') context.abrirFormulario();
        close();
    }

    function descartar() {
        state.draft = null;
        state.raw = null;
        setStatus('Borrador descartado.', 'ok');
        renderPreview();
    }

    function onPreviewClick(event) {
        const button = event.target && event.target.closest ? event.target.closest('button') : null;
        if (!button) return;
        const data = button.dataset || {};
        if (data.mbiaTipo) { revalidar({ tipo: data.mbiaTipo }); return; }
        if (data.mbiaMesa) { revalidar({ mesa: Number(data.mbiaMesa) }); return; }
        if (data.mbiaPago) { revalidar({ pago: data.mbiaPago }); return; }
        if (data.mbiaEntrada) { revalidar({ entrada: data.mbiaEntrada }); return; }
        if (data.mbiaEnvio) { revalidar({ envio: Number(data.mbiaEnvio) }); return; }
        if ('mbiaCalcular' in data) {
            const mapInput = $('mbia-mapa');
            revalidar({ mapa: mapInput ? mapInput.value.trim() : '' });
            return;
        }
        if ('mbiaConfirmar' in data) { confirmar(); return; }
        if ('mbiaEditar' in data) { editar(); return; }
        if ('mbiaDescartar' in data) { descartar(); }
    }

    function startSpeech() {
        const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
        if (!Recognition) {
            setStatus('Este navegador no tiene dictado por voz. Usá el micrófono del teclado.', 'warn');
            return;
        }
        try {
            const recognition = new Recognition();
            recognition.lang = 'es-PY';
            recognition.interimResults = false;
            recognition.continuous = false;
            recognition.maxAlternatives = 1;
            recognition.onresult = (event) => {
                const transcript = event.results && event.results[0] && event.results[0][0]
                    ? event.results[0][0].transcript
                    : '';
                if (transcript) {
                    input.value = (input.value ? input.value + ' ' : '') + transcript;
                    input.focus();
                }
            };
            recognition.onerror = () => setStatus('No se pudo dictar. Probá otra vez o escribí el pedido.', 'warn');
            recognition.onend = () => { state.speech = null; mic.textContent = '🎤 Dictar'; };
            state.speech = recognition;
            mic.textContent = '⏹ Detener';
            setStatus('Escuchando…', 'loading');
            recognition.start();
        } catch (e) {
            setStatus('No se pudo iniciar el dictado. Escribí el pedido.', 'warn');
        }
    }

    function stopSpeech() {
        if (state.speech) {
            try { state.speech.stop(); } catch (e) { /* ignore */ }
            state.speech = null;
            mic.textContent = '🎤 Dictar';
        }
    }

    function open() {
        const user = context.auth && context.auth.currentUser;
        if (!user || (typeof context.isAdminUid === 'function' && !context.isAdminUid(user.uid))) {
            if (typeof context.mostrarError === 'function') context.mostrarError('Mi Barrio IA es solo para el administrador.');
            return;
        }
        state.open = true;
        modal.classList.remove('hidden');
        renderPreview();
        renderUsage();
        setTimeout(() => { try { input.focus(); } catch (e) {} }, 60);
    }

    function close() {
        stopSpeech();
        state.open = false;
        modal.classList.add('hidden');
    }

    const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (Recognition) mic.hidden = false;

    fab.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    send.addEventListener('click', interpretar);
    preview.addEventListener('click', onPreviewClick);
    preview.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target && event.target.id === 'mbia-mapa') {
            event.preventDefault();
            const mapInput = $('mbia-mapa');
            revalidar({ mapa: mapInput ? mapInput.value.trim() : '' });
        }
    });
    input.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            interpretar();
        }
    });
    if (Recognition) {
        mic.addEventListener('click', () => {
            if (state.speech) stopSpeech();
            else startSpeech();
        });
    }

    const onEscape = (event) => { if (event.key === 'Escape' && state.open) close(); };
    doc.addEventListener('keydown', onEscape);

    let unsubscribeAuth = null;
    if (context.auth && typeof context.auth.onAuthStateChanged === 'function') {
        unsubscribeAuth = context.auth.onAuthStateChanged((user) => {
            if (!user) close();
        });
    }

    const api = {
        open,
        close,
        interpretar,
        confirmar,
        get state() { return state; },
        destroy() {
            doc.removeEventListener('keydown', onEscape);
            if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
            fab.remove();
            modal.remove();
            INSTANCES.delete(doc);
        },
    };
    INSTANCES.set(doc, api);
    return api;
}
