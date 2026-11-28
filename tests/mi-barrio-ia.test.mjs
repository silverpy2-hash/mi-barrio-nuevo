// Mi Barrio IA - focused tests.
//
// These tests never touch Firebase, OpenAI or the network. They exercise the
// pure order-building/pricing helpers and the serverless endpoint contract with
// fake requests and a stubbed global fetch.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCatalog,
    buscarCliente,
    huellaPedido,
    leerConsumo,
    guardarConsumo,
    sumarConsumo,
    formatoConsumo,
    leerUltimoPedido,
    guardarUltimoPedido,
    prepararBorrador,
    createMiBarrioIA,
    IA_STORAGE_KEY,
    IA_LAST_ORDER_KEY,
} from '../mi-barrio-tpv-celular/ia.js';

import apiHandler from '../api/mi-barrio-ia.js';

const {
    buildSchema,
    calcularCosto,
    validateCatalog,
    sanitizeDraftForPrompt,
    allowedOrigin,
    OPENAI_PRICING,
} = apiHandler._test;

// ===== Fixtures =====

const MENU = {
    tamanos: {
        grande: {
            nombre: 'Pizza Grande + Mediana muzza gratis',
            corto: 'Grande',
            limite: 2,
            borde: 15000,
            precios: { clasico: 60000, especial: 75000, gourmet: 90000 },
        },
        mediano: {
            nombre: 'Pizza Mediana',
            corto: 'Mediana',
            limite: 2,
            borde: 12000,
            precios: { clasico: 30000, especial: 40000, gourmet: 50000 },
        },
        'tren-grande': {
            nombre: 'Pizza Tren Grande',
            corto: 'Tren Grande',
            limite: 3,
            borde: 30000,
            precios: { clasico: 75000, especial: 90000, gourmet: 110000 },
        },
    },
    sabores: {
        clasico: ['Muzza', 'Napolitana'],
        especial: ['Calabresa', 'Cuatro Quesos'],
        gourmet: ['Suprema'],
    },
    extras: [
        ['coca-1l', 'Coca Cola 1LT', 12000],
        ['papas-med', 'Papas Medianas', 15000],
    ],
};

function nuevoCat(sabores) {
    if (sabores.some((flavor) => MENU.sabores.gourmet.includes(flavor))) return 'gourmet';
    if (sabores.some((flavor) => MENU.sabores.especial.includes(flavor))) return 'especial';
    return 'clasico';
}

function nuevoPrecio(tamano, sabores, borde) {
    const size = MENU.tamanos[tamano];
    return size.precios[nuevoCat(sabores)] + (borde ? size.borde : 0);
}

function waNumero(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('595')) digits = digits.slice(3);
    digits = digits.replace(/^0+/, '');
    return digits ? '595' + digits : '';
}

function coordsDeMaps(texto) {
    if (!texto) return null;
    let source = String(texto);
    try { source = decodeURIComponent(source.replace(/\+/g, ' ')); } catch (e) {}
    let match = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(source);
    if (!match) match = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(source);
    if (!match) match = /[?&](?:q|ll|query|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(source);
    if (!match) match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(source);
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

function linkMaps(texto) {
    const match = /https?:\/\/(?:maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s]*/i.exec(String(texto || ''));
    return match ? match[0].replace(/[.,;)]+$/, '') : '';
}

function linkDeCoords({ lat, lng }) {
    return 'https://maps.google.com/?q=' + lat + ',' + lng;
}

function ubicacionCliente(cliente) {
    return linkMaps(cliente.mapa) || linkMaps(cliente.direccion) || '';
}

function celLocal(cliente) {
    return '0' + String(cliente.celular).slice(3);
}

let deliveryResult = { km: 2.5, costo: 7000, fuera: false };

const helpers = {
    nuevoCat,
    nuevoPrecio,
    waNumero,
    linkMaps,
    coordsDeMaps,
    linkDeCoords,
    ubicacionCliente,
    celLocal,
    calcularDelivery: async () => ({ ...deliveryResult }),
};

function rawOrder(overrides = {}) {
    return {
        accion: 'pedido',
        tipo: 'retiro',
        mesa: null,
        cliente: { nombre: 'Ana', celular: null, referencia: null, mapa: null, notas: null },
        pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false, cantidad: 1 }],
        extras: [],
        pago: null,
        entrada: 'nuevo',
        descuento: { tipo: 'ninguno', valor: 0, motivo: null },
        faltantes: [],
        aclaracion: '',
        ...overrides,
    };
}

async function preparar(raw, overrides = {}) {
    return prepararBorrador({
        raw,
        menu: MENU,
        tramos: [],
        mesas: [1, 2, 3],
        clientes: [],
        helpers,
        ...overrides,
    });
}

// ===== Catalog / privacy =====

test('buildCatalog sends only ids and names, never prices or customers', () => {
    const catalog = buildCatalog(MENU);
    assert.deepEqual(catalog.tamanos.map((size) => size.id), ['grande', 'mediano', 'tren-grande']);
    assert.deepEqual(catalog.tamanos[0], {
        id: 'grande',
        nombre: 'Pizza Grande + Mediana muzza gratis',
        corto: 'Grande',
        limite: 2,
        borde: true,
    });
    assert.deepEqual(catalog.sabores.clasico, ['Muzza', 'Napolitana']);
    assert.deepEqual(catalog.extras[0], { id: 'coca-1l', nombre: 'Coca Cola 1LT' });

    const serialized = JSON.stringify(catalog).toLowerCase();
    assert.equal(serialized.includes('precio'), false);
    assert.equal(serialized.includes('cliente'), false);
    assert.equal(serialized.includes('60000'), false);
});

test('buscarCliente matches locally by phone or exact name', () => {
    const clientes = [
        { id: '595981123456', nombre: 'Ana', celular: '595981123456', direccion: 'Calle 1' },
        { id: '595971111111', nombre: 'Beto', celular: '595971111111' },
    ];
    assert.equal(buscarCliente(clientes, { celular: '0981 123 456' }, waNumero).nombre, 'Ana');
    assert.equal(buscarCliente(clientes, { nombre: 'beto' }, waNumero).nombre, 'Beto');
    assert.equal(buscarCliente(clientes, { nombre: 'Nadie' }, waNumero), null);
});

// ===== Pricing / validation =====

test('prepararBorrador prices with the TPV helpers and expands quantity', async () => {
    const draft = await preparar(rawOrder({
        pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false, cantidad: 2 }],
        extras: [{ id: 'coca-1l', cantidad: 2 }],
    }));

    assert.equal(draft.accion, 'pedido');
    assert.equal(draft.pizzas.length, 2);
    assert.equal(draft.pizzas[0].precio, 60000);
    assert.equal(draft.pizzas[0].categoria, 'clasico');
    assert.deepEqual(draft.extras, [{
        id: 'coca-1l',
        nombre: 'Coca Cola 1LT',
        cantidad: 2,
        precioUnitario: 12000,
    }]);
    assert.equal(draft.subPizzas, 120000);
    assert.equal(draft.subExtras, 24000);
    assert.equal(draft.total, 144000);
    assert.equal(draft.listo, true);
    assert.deepEqual(draft.errores, []);
    assert.deepEqual(draft.faltantes, []);
});

test('prepararBorrador applies the size category and the border price', async () => {
    const draft = await preparar(rawOrder({
        pizzas: [
            { tamano: 'grande', sabores: ['Suprema'], borde: true, cantidad: 1 },
            { tamano: 'mediano', sabores: ['Calabresa'], borde: false, cantidad: 1 },
        ],
    }));
    assert.equal(draft.pizzas[0].precio, 90000 + 15000);
    assert.equal(draft.pizzas[0].categoria, 'gourmet');
    assert.equal(draft.pizzas[1].precio, 40000);
    assert.equal(draft.pizzas[1].categoria, 'especial');
});

test('prepararBorrador rejects unknown flavors and does not invent prices', async () => {
    const draft = await preparar(rawOrder({
        pizzas: [{ tamano: 'grande', sabores: ['Fantasia'], borde: false, cantidad: 1 }],
    }));
    assert.equal(draft.pizzas.length, 0);
    assert.equal(draft.listo, false);
    assert.ok(draft.errores.some((error) => /sabor no disponible/i.test(error)));
});

test('prepararBorrador rejects a flavor count over the size limit', async () => {
    const draft = await preparar(rawOrder({
        pizzas: [{ tamano: 'grande', sabores: ['Muzza', 'Napolitana', 'Calabresa'], borde: false, cantidad: 1 }],
    }));
    assert.equal(draft.listo, false);
    assert.ok(draft.errores.some((error) => /admite hasta 2 sabores/i.test(error)));
});

test('prepararBorrador applies a percentage discount only to pizzas', async () => {
    const draft = await preparar(rawOrder({
        pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false, cantidad: 2 }],
        extras: [{ id: 'coca-1l', cantidad: 1 }],
        descuento: { tipo: 'porcentaje', valor: 10, motivo: 'Promo mostrador' },
    }));
    assert.equal(draft.subPizzas, 120000);
    assert.equal(draft.sub, 132000);
    assert.equal(draft.descuento, 12000);
    assert.equal(draft.total, 120000);
    assert.equal(draft.listo, true);
});

test('prepararBorrador requires a reason and a discount smaller than the order', async () => {
    const withoutReason = await preparar(rawOrder({
        descuento: { tipo: 'monto', valor: 5000, motivo: null },
    }));
    assert.equal(withoutReason.listo, false);
    assert.ok(withoutReason.errores.some((error) => /motivo del descuento/i.test(error)));

    const tooBig = await preparar(rawOrder({
        descuento: { tipo: 'monto', valor: 999999, motivo: 'Error' },
    }));
    assert.equal(tooBig.listo, false);
    assert.ok(tooBig.errores.some((error) => /no puede superar/i.test(error)));
});

// ===== Delivery / local / payment =====

test('prepararBorrador reuses the existing delivery calculation', async () => {
    deliveryResult = { km: 2.5, costo: 7000, fuera: false };
    const draft = await preparar(rawOrder({
        tipo: 'delivery',
        cliente: {
            nombre: 'Ana',
            celular: '0981 123 456',
            referencia: 'Portón negro',
            mapa: 'https://maps.google.com/?q=-25.46,-56.01',
            notas: null,
        },
    }));
    assert.equal(draft.distanciaKm, 2.5);
    assert.equal(draft.envio, 7000);
    assert.equal(draft.total, 67000);
    assert.equal(draft.cliente.celular, '595981123456');
    assert.equal(draft.listo, true);
});

test('prepararBorrador blocks a delivery outside the covered area', async () => {
    deliveryResult = { km: 9, costo: 0, fuera: true };
    const draft = await preparar(rawOrder({
        tipo: 'delivery',
        cliente: {
            nombre: 'Ana',
            celular: null,
            referencia: null,
            mapa: 'https://maps.google.com/?q=-25.60,-56.20',
            notas: null,
        },
    }));
    assert.equal(draft.listo, false);
    assert.ok(draft.errores.some((error) => /zona no está cubierta/i.test(error)));
});

test('prepararBorrador requires a map for delivery', async () => {
    const draft = await preparar(rawOrder({
        tipo: 'delivery',
        cliente: { nombre: 'Ana', celular: null, referencia: 'Calle 1', mapa: null, notas: null },
    }));
    assert.equal(draft.listo, false);
    assert.ok(draft.faltantes.includes('link de Google Maps o coordenadas'));
});

test('prepararBorrador validates the table for local orders', async () => {
    const missing = await preparar(rawOrder({ tipo: 'local', mesa: 9 }));
    assert.equal(missing.listo, false);
    assert.ok(missing.faltantes.includes('mesa'));

    const ok = await preparar(rawOrder({ tipo: 'local', mesa: 2 }));
    assert.equal(ok.mesa, 2);
    assert.equal(ok.listo, true);
});

test('prepararBorrador requires a payment method when the order is already paid', async () => {
    const draft = await preparar(rawOrder({ entrada: 'entregado', pago: null }));
    assert.equal(draft.listo, false);
    assert.ok(draft.faltantes.includes('medio de pago'));

    const paid = await preparar(rawOrder({ entrada: 'entregado', pago: 'efectivo' }));
    assert.equal(paid.listo, true);
});

test('prepararBorrador keeps model notices out of the blocking list', async () => {
    const draft = await preparar(rawOrder({ faltantes: ['No se indicó el tipo de pedido'] }));
    assert.equal(draft.listo, true);
    assert.ok(draft.avisos.includes('No se indicó el tipo de pedido'));
});

// ===== Duplicates / consumption =====

test('huellaPedido is stable and changes with the priced total', async () => {
    const first = await preparar(rawOrder());
    const same = await preparar(rawOrder());
    assert.equal(huellaPedido(first), huellaPedido(same));

    const bigger = await preparar(rawOrder({
        pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false, cantidad: 2 }],
    }));
    assert.notEqual(huellaPedido(first), huellaPedido(bigger));
});

test('consumption accumulates real tokens and reports an unknown cost honestly', () => {
    const start = { consultas: 0, tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, costoConocido: true };
    const once = sumarConsumo(start, { tokensEntrada: 1000, tokensSalida: 500, costoUsd: 0.00045 }, 10);
    assert.equal(once.consultas, 1);
    assert.equal(once.tokensEntrada, 1000);
    assert.equal(once.tokensSalida, 500);
    assert.equal(once.costoUsd, 0.00045);
    assert.equal(once.costoConocido, true);

    const unknown = sumarConsumo(once, { tokensEntrada: 10, tokensSalida: 5, costoUsd: null }, 20);
    assert.equal(unknown.consultas, 2);
    assert.equal(unknown.costoUsd, 0.00045);
    assert.equal(unknown.costoConocido, false);
});

test('consumption survives storage and is rendered for the cashier', () => {
    const memory = new Map();
    const storage = {
        getItem: (key) => (memory.has(key) ? memory.get(key) : null),
        setItem: (key, value) => memory.set(key, String(value)),
    };
    assert.equal(leerConsumo(storage).consultas, 0);
    guardarConsumo(storage, { consultas: 2, tokensEntrada: 3000, tokensSalida: 900, costoUsd: 0.001, costoConocido: true });
    const restored = leerConsumo(storage);
    assert.equal(restored.consultas, 2);
    assert.equal(restored.tokensEntrada, 3000);
    assert.match(formatoConsumo(restored, { tokensEntrada: 100, tokensSalida: 50, costoUsd: 0.0001 }), /US\$/);
    assert.equal(memory.has(IA_STORAGE_KEY), true);
});

test('the duplicate guard stores only a hash and a timestamp', () => {
    const memory = new Map();
    const storage = {
        getItem: (key) => (memory.has(key) ? memory.get(key) : null),
        setItem: (key, value) => memory.set(key, String(value)),
    };
    assert.equal(leerUltimoPedido(storage), null);
    guardarUltimoPedido(storage, 'abc', 1234);
    assert.deepEqual(leerUltimoPedido(storage), { h: 'abc', at: 1234 });
    assert.equal(memory.has(IA_LAST_ORDER_KEY), true);
});

test('createMiBarrioIA does nothing without a document', () => {
    assert.equal(createMiBarrioIA({ document: null, window: null }), null);
});

// ===== Serverless endpoint =====

function makeResponse() {
    const response = {
        statusCode: 0,
        headers: {},
        payload: null,
        ended: false,
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        end(body) {
            this.ended = true;
            this.payload = body ? JSON.parse(body) : null;
        },
    };
    return response;
}

const ENV_KEYS = [
    'OPENAI_API_KEY',
    'FIREBASE_WEB_API_KEY',
    'TPV_ADMIN_UID',
    'OPENAI_MODEL',
    'OPENAI_PRICE_INPUT_PER_1M',
    'OPENAI_PRICE_OUTPUT_PER_1M',
    'OPENAI_MAX_OUTPUT_TOKENS',
    'IA_ALLOWED_ORIGINS',
];

function snapshotEnv() {
    return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
    for (const key of ENV_KEYS) {
        if (snapshot[key] === undefined) delete process.env[key];
        else process.env[key] = snapshot[key];
    }
}

function setBaseEnv() {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.FIREBASE_WEB_API_KEY = 'test-firebase-key';
    process.env.TPV_ADMIN_UID = 'admin-uid';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    delete process.env.OPENAI_PRICE_INPUT_PER_1M;
    delete process.env.OPENAI_PRICE_OUTPUT_PER_1M;
    delete process.env.OPENAI_MAX_OUTPUT_TOKENS;
    delete process.env.IA_ALLOWED_ORIGINS;
}

test('sanitizeDraftForPrompt removes the saved customer phone', () => {
    const clean = sanitizeDraftForPrompt({
        accion: 'pedido',
        tipo: 'delivery',
        cliente: {
            nombre: 'Ana',
            celular: '595981123456',
            referencia: 'Portón',
            mapa: 'https://maps.google.com/?q=-25.46,-56.01',
            notas: 'Tocar timbre',
        },
        pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false, cantidad: 1 }],
        extras: [],
        pago: 'efectivo',
        entrada: 'nuevo',
        descuento: { tipo: 'ninguno', valor: 0, motivo: null },
        faltantes: [],
        aclaracion: '',
    });
    assert.equal(clean.cliente.celular, null);
    assert.equal(clean.cliente.nombre, 'Ana');
    assert.equal(JSON.stringify(clean).includes('595981123456'), false);
});

test('calcularCosto uses the published price and reports unknown models honestly', () => {
    const known = calcularCosto('gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 500 }, {}, OPENAI_PRICING);
    assert.equal(known.tokensEntrada, 1000);
    assert.equal(known.tokensSalida, 500);
    assert.equal(known.costoUsd, 0.00045);
    assert.equal(known.precioConfigurado, true);

    const unknown = calcularCosto('modelo-desconocido', { prompt_tokens: 10, completion_tokens: 5 }, {}, OPENAI_PRICING);
    assert.equal(unknown.costoUsd, null);
    assert.equal(unknown.precioConfigurado, false);
});

test('the schema is bounded by the live catalog', () => {
    const catalog = buildCatalog(MENU);
    const schema = buildSchema(catalog);
    assert.deepEqual(schema.properties.pizzas.items.properties.tamano.enum, ['grande', 'mediano', 'tren-grande']);
    assert.deepEqual(schema.properties.extras.items.properties.id.enum, ['coca-1l', 'papas-med']);
    assert.ok(schema.properties.pizzas.items.properties.sabores.items.enum.includes('Suprema'));
    assert.equal(schema.properties.pizzas.maxItems, 20);
    assert.equal(schema.additionalProperties, false);
});

test('validateCatalog accepts the real catalog and rejects malformed ones', () => {
    assert.equal(validateCatalog(buildCatalog(MENU)), null);
    assert.match(validateCatalog({ tamanos: [] }), /tamaños/i);
    assert.match(validateCatalog({ tamanos: [{ id: 'grande', limite: 2 }], sabores: { clasico: ['Muzza'] }, extras: [] }), /sabores/i);
});

test('allowedOrigin accepts same-origin and rejects unknown origins', () => {
    assert.equal(allowedOrigin({ headers: { origin: 'https://tpv.example', host: 'tpv.example' } }), 'https://tpv.example');
    assert.equal(allowedOrigin({ headers: { origin: 'https://evil.example', host: 'tpv.example' } }), null);
    assert.equal(allowedOrigin({ headers: {} }), '*');
});

test('endpoint rejects non-POST, missing session and non-admin tokens', async () => {
    const snapshot = snapshotEnv();
    try {
        setBaseEnv();

        const get = makeResponse();
        await apiHandler({ method: 'GET', headers: {} }, get);
        assert.equal(get.statusCode, 405);

        const noAuth = makeResponse();
        await apiHandler({ method: 'POST', headers: { origin: 'https://tpv.example', host: 'tpv.example' }, body: {} }, noAuth);
        assert.equal(noAuth.statusCode, 401);

        const realFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => ({ ok: true, json: async () => ({ users: [{ localId: 'otro-uid' }] }) });
            const notAdmin = makeResponse();
            await apiHandler({
                method: 'POST',
                headers: { origin: 'https://tpv.example', host: 'tpv.example', authorization: 'Bearer token' },
                body: { mensaje: 'una muzza', catalogo: buildCatalog(MENU), mesas: [] },
            }, notAdmin);
            assert.equal(notAdmin.statusCode, 403);

            globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
            const expired = makeResponse();
            await apiHandler({
                method: 'POST',
                headers: { origin: 'https://tpv.example', host: 'tpv.example', authorization: 'Bearer token' },
                body: { mensaje: 'una muzza', catalogo: buildCatalog(MENU), mesas: [] },
            }, expired);
            assert.equal(expired.statusCode, 401);
        } finally {
            globalThis.fetch = realFetch;
        }
    } finally {
        restoreEnv(snapshot);
    }
});

test('endpoint answers OPTIONS and reports missing configuration', async () => {
    const snapshot = snapshotEnv();
    try {
        setBaseEnv();
        const options = makeResponse();
        await apiHandler({ method: 'OPTIONS', headers: { origin: 'https://tpv.example', host: 'tpv.example' } }, options);
        assert.equal(options.statusCode, 204);
        assert.equal(options.headers['access-control-allow-origin'], 'https://tpv.example');

        delete process.env.OPENAI_API_KEY;
        const missing = makeResponse();
        await apiHandler({ method: 'POST', headers: { origin: 'https://tpv.example', host: 'tpv.example' } }, missing);
        assert.equal(missing.statusCode, 503);
        assert.deepEqual(missing.payload.missing, ['OPENAI_API_KEY']);
    } finally {
        restoreEnv(snapshot);
    }
});

test('endpoint returns a validated order, cost and no customer phone in the prompt', async () => {
    const snapshot = snapshotEnv();
    const realFetch = globalThis.fetch;
    try {
        setBaseEnv();
        const catalog = buildCatalog(MENU);
        let openAiBody = null;

        globalThis.fetch = async (url, options) => {
            if (String(url).includes('identitytoolkit')) {
                return { ok: true, json: async () => ({ users: [{ localId: 'admin-uid' }] }) };
            }
            openAiBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    choices: [{
                        finish_reason: 'stop',
                        message: {
                            content: JSON.stringify({
                                accion: 'pedido',
                                tipo: 'retiro',
                                mesa: null,
                                cliente: { nombre: 'Ana', celular: null, referencia: null, mapa: null, notas: null },
                                pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false, cantidad: 2 }],
                                extras: [{ id: 'coca-1l', cantidad: 1 }],
                                pago: 'efectivo',
                                entrada: 'nuevo',
                                descuento: { tipo: 'ninguno', valor: 0, motivo: null },
                                faltantes: [],
                                aclaracion: 'Dos muzza grandes y una Coca.',
                            }),
                        },
                    }],
                    usage: { prompt_tokens: 1000, completion_tokens: 500 },
                }),
            };
        };

        const response = makeResponse();
        await apiHandler({
            method: 'POST',
            headers: { origin: 'https://tpv.example', host: 'tpv.example', authorization: 'Bearer token' },
            body: {
                mensaje: 'dos muzza grandes y una coca para Ana 0981 123 456',
                catalogo: catalog,
                mesas: [1, 2, 3],
                borrador: {
                    accion: 'pedido',
                    tipo: 'retiro',
                    cliente: { nombre: 'Ana', celular: '595981123456' },
                    pizzas: [],
                    extras: [],
                },
            },
        }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.payload.ok, true);
        assert.equal(response.payload.pedido.pizzas.length, 1);
        assert.equal(response.payload.uso.tokensEntrada, 1000);
        assert.equal(response.payload.uso.tokensSalida, 500);
        assert.equal(response.payload.uso.costoUsd, 0.00045);
        assert.equal(response.payload.uso.precioConfigurado, true);
        assert.match(response.payload.consultaId, /^[0-9a-f-]{36}$/);

        const prompt = JSON.stringify(openAiBody);
        assert.equal(prompt.includes('595981123456'), false, 'the saved phone never reaches OpenAI');
        assert.equal(prompt.includes('60000'), false, 'prices are never sent to OpenAI');
        assert.ok(openAiBody.response_format.json_schema.strict);
    } finally {
        globalThis.fetch = realFetch;
        restoreEnv(snapshot);
    }
});
