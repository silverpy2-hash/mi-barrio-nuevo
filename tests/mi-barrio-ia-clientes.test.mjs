import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buscarClientes, buscarCliente, prepararBorrador } from '../mi-barrio-tpv-celular/ia.js';

// Local fixtures only: no real customer records or network access.
const clientes = [
    { id: '595981111111', nombre: 'José Pérez', celular: '595981111111', mapa: 'https://maps.google.com/?q=-25.4,-56.0', direccion: 'Portón azul' },
    { id: '595982222222', nombre: 'José López', celular: '595982222222', mapa: 'https://maps.google.com/?q=-25.5,-56.1', direccion: 'Portón rojo' },
];
const waNumero = v => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('595')) d = d.slice(3);
    return d ? '595' + d.replace(/^0+/, '') : '';
};
const helpers = {
    waNumero,
    linkMaps: v => String(v || '').startsWith('https://maps.google.com/') ? v : '',
    coordsDeMaps: v => v ? { lat: -25.4, lng: -56 } : null,
    linkDeCoords: () => clientes[0].mapa,
    ubicacionCliente: c => c.mapa || '',
    nuevoCat: () => 'clasico', nuevoPrecio: () => 60000,
    calcularDelivery: async () => ({ km: 2.5, costo: 7000, fuera: false }),
};
const raw = cliente => ({
    accion: 'pedido', tipo: 'delivery', cliente,
    pizzas: [{ tamano: 'grande', sabores: ['Muzza'], cantidad: 1, borde: false }],
    extras: [], pago: null, entrada: 'nuevo', descuento: { tipo: 'ninguno', valor: 0 },
    faltantes: ['teléfono del cliente', 'link de Google Maps', 'medio de pago'],
});
const preparar = (source, more = {}) => prepararBorrador({
    raw: source, clientes, menu: { tamanos: { grande: { limite: 2 } }, sabores: { clasico: ['Muzza'] }, extras: [] },
    mesas: [], tramos: [], helpers, ...more,
});

test('searches partial names without accents, phones and identifiers locally', () => {
    assert.equal(buscarClientes(clientes, { nombre: 'jose' }, waNumero).length, 2);
    assert.equal(buscarCliente(clientes, { nombre: 'jose' }, waNumero), null);
    assert.equal(buscarCliente(clientes, { celular: '0981 111 111' }, waNumero).id, clientes[0].id);
    assert.equal(buscarCliente(clientes, { nombre: clientes[1].id }, waNumero).id, clientes[1].id);
    assert.equal(buscarCliente([{ id: 'cli-A7', nombre: 'Prueba' }], { nombre: 'cli-A7' }, waNumero).id, 'cli-A7');
});

test('recovers phone/location and delivery without requiring payment', async () => {
    const draft = await preparar(raw({ nombre: 'jose perez' }));
    assert.equal(draft.cliente.nombre, 'José Pérez');
    assert.equal(draft.cliente.celular, clientes[0].celular);
    assert.equal(draft.cliente.mapa, clientes[0].mapa);
    assert.equal(draft.cliente.referencia, 'Portón azul');
    assert.equal(draft.envio, 7000);
    assert.equal(draft.total, 67000);
    assert.equal(draft.pago, null);
    assert.equal(draft.listo, true);
    assert.deepEqual(draft.avisos, []);
});

test('blocks ambiguous selection, then fills only the chosen record', async () => {
    const source = raw({ nombre: 'jose' });
    const ambiguous = await preparar(source);
    assert.equal(ambiguous.listo, false);
    assert.equal(ambiguous.clientesCoincidentes.length, 2);
    assert(ambiguous.faltantes.includes('seleccionar cliente'));
    assert.equal(ambiguous.cliente.celular, '');
    const chosen = await preparar({ ...source, clienteSeleccionadoId: clientes[1].id });
    assert.equal(chosen.cliente.celular, clientes[1].celular);
    assert.equal(chosen.cliente.mapa, clientes[1].mapa);
    assert.equal(chosen.listo, true);
});

test('uses a single-record fallback for a customer outside the recent cache', async () => {
    let lookup;
    const draft = await preparar(raw({ nombre: 'cli-A7' }), {
        clientes: [], helpers: { ...helpers, buscarFichaCliente: async c => { lookup = c.nombre; return { ...clientes[0], id: 'cli-A7' }; } },
    });
    assert.equal(lookup, 'cli-A7');
    assert.equal(draft.clienteSeleccionadoId, 'cli-A7');
    assert.equal(draft.listo, true);
});

test('keeps explicit new address and payment-required invariant for paid orders', async () => {
    const draft = await preparar({ ...raw({ nombre: 'jose perez', mapa: clientes[1].mapa }), entrada: 'entregado' });
    assert.equal(draft.cliente.mapa, clientes[1].mapa);
    assert.equal(draft.listo, false);
    assert(draft.faltantes.includes('medio de pago'));
});

test('a different explicit phone never falls back to an unrelated namesake', async () => {
    const draft = await preparar(raw({ nombre: 'jose perez', celular: '0983 333 333' }));
    assert.equal(draft.clienteSeleccionadoId, null);
    assert.equal(draft.cliente.mapa, '');
    assert.equal(draft.listo, false);
});

test('local recalculation retains selection; provider draft excludes candidates and phone', async () => {
    // Expose the private converter in an isolated module, without changing production exports.
    const source = readFileSync(new URL('../mi-barrio-tpv-celular/ia.js', import.meta.url), 'utf8');
    const { rawFromDraft } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { rawFromDraft };').toString('base64'));
    const chosen = await preparar({ ...raw({ nombre: 'jose' }), clienteSeleccionadoId: clientes[1].id });
    const recalculated = await preparar(rawFromDraft(chosen));
    assert.equal(recalculated.clienteSeleccionadoId, clientes[1].id);
    assert.equal(recalculated.cliente.celular, clientes[1].celular);
    const outbound = rawFromDraft(chosen, true);
    assert.equal(outbound.cliente.celular, null);
    assert.equal(outbound.cliente.mapa, null);
    assert.equal(outbound.cliente.referencia, null);
    assert(!('clienteSeleccionadoId' in outbound));
    assert(!('clientesCoincidentes' in outbound));
    assert(!('clienteSolicitado' in outbound));
    assert(!JSON.stringify(outbound).includes(clientes[0].mapa));
});
