import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
function section(start, end) {
    const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return html.slice(a, b);
}
export function page({ storage = new Map() } = {}) {
    const nodes = new Map(), gps = [], sent = [], urls = [], opened = [], emails = [], alerts = [];
    const get = id => {
        if (!nodes.has(id)) {
            const classes = new Set(['hidden']);
            nodes.set(id, { value: '', textContent: '', innerText: '', innerHTML: '', disabled: false, style: {},
                classList: { add: (...x) => x.forEach(v => classes.add(v)), remove: (...x) => x.forEach(v => classes.delete(v)), contains: x => classes.has(x), toggle(x, on) { const yes = on ?? !classes.has(x); yes ? classes.add(x) : classes.delete(x); } },
                setAttribute(k, v) { this[k] = v; }, scrollIntoView() {}, focus() {} });
        }
        return nodes.get(id);
    };
    for (const [id, value] of Object.entries({ nombre: 'Cliente prueba', celular: '0981123456', direccion: 'Dirección de prueba' })) get(id).value = value;
    let mapCount = 0, route = async () => ({ json: async () => ({ routes: [{ distance: 1000 }] }) });
    const events = {}, markerEvents = {};
    const map = { setView() { return this; }, invalidateSize() { return this; }, on(name, fn) { events[name] = fn; return this; } };
    let markerCoords = { lat: -25.46, lng: -56.01 };
    const marker = { addTo() { return this; }, setLatLng(v) { markerCoords = Array.isArray(v) ? { lat: v[0], lng: v[1] } : v; return this; }, on(name, fn) { markerEvents[name] = fn; return this; }, getLatLng: () => markerCoords };
    const timers = new Map(); let timer = 0;
    const context = vm.createContext({
        window: { MESA_ACTUAL: null, DESCUENTO_WEB: 20, DESCUENTO_WEB_LISTO: true,
            location: { assign: url => urls.push(url) },
            sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
            guardarPedidoFirebase: async d => { sent.push(JSON.parse(JSON.stringify(d))); return { id: d.intentoId || 'fixture-id' }; },
            open: url => { opened.push(url); return { document: { body: {} }, location: { set href(u) { urls.push(u); } }, close() {} }; } },
        document: { getElementById: get, querySelectorAll: () => [{ value: 'Muzza', getAttribute: () => 'clasico' }] },
        navigator: { geolocation: { getCurrentPosition: (ok, fail) => gps.push({ ok, fail }) } },
        L: { map: () => { mapCount++; return map; }, tileLayer: () => ({ addTo() {} }), marker: () => marker },
        AbortController, setTimeout: (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; }, clearTimeout: id => timers.delete(id),
        fetch: (url, options) => url.includes('router.project-osrm.org') ? route() : (emails.push(JSON.parse(options.body)), Promise.resolve({ ok: true, json: async () => ({}) })),
        actualizarInterfaz() {},
        alert: x => alerts.push(x), confirm: () => true, console: { log() {}, error() {} },
        obtenerTamanoSeleccionado: () => 'grande', matrizPrecios: { grande: { clasico: 60000 } },
        adicionales: { 'borde-piz': 1, papas: 1, bebida: 1 }, preciosAdicionales: { papas: 15000, bebida: 8000 },
        precioBorde: () => 15000, pedido: [], nombresTamano: { grande: 'Grande' }, nombresExtras: { papas: 'Papas', bebida: 'Gaseosa' },
        PAGOS_TXT: { efectivo: 'Efectivo', transferencia: 'Transferencia' }, encodeURIComponent,
    });
    vm.runInContext(section('        let map;', '        // ===== Ingredientes'), context);
    vm.runInContext(section('        function calcularTotal()', '        // Celular de Paraguay'), context);
    vm.runInContext(section('        function normalizarCelularPY(', '        // Botones de cantidad'), context);
    return { context, get, gps, sent, urls, opened, emails, alerts, events, marker, markerEvents, storage, timers, mapCount: () => mapCount,
        run: s => vm.runInContext(s, context), setRoute: fn => { route = fn; } };
}
