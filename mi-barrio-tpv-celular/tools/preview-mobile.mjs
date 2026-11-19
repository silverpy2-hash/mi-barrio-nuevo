#!/usr/bin/env node
// Mi Barrio - TPV Celular · isolated mobile preview generator (T5).
//
// Generates THROWAWAY fixtures from the real index.html for visual/DOM verification:
//   * the inline Firebase business module is REPLACED by a local mock script,
//   * every remote <script> (Tailwind CDN) is stripped so no network is used,
//   * the original inline CSS, ./mobile.css and ./mobile-ui.js are preserved,
//   * output is only allowed in an explicit, approved temp directory outside the repo.
//
// This is a development tool: it is never imported by the app, exposes no demo mode or
// query string in production, never touches Firebase, never writes business data and
// never asks for credentials. Fixtures are clearly labelled fake data.
//
// Usage:
//   node mi-barrio-tpv-celular/tools/preview-mobile.mjs
//   node mi-barrio-tpv-celular/tools/preview-mobile.mjs --out "%TEMP%\mi-barrio-preview" --cases empty,orders,loading,error
//   node mi-barrio-tpv-celular/tools/preview-mobile.mjs --out "%TEMP%\mi-barrio-preview" --serve
//
// Then serve the printed folder over http://127.0.0.1:<port>/mock-orders.html (never file://).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_DIR, '..');
const BANNER = 'VISTA PREVIA DE PRUEBA · datos falsos · sin Firebase';

export const CASES = ['empty', 'orders', 'loading', 'error'];

// Chrome/Windows cannot open a window narrower than ~500 CSS px, so real phone widths are
// reviewed through same-origin iframes, whose media queries use the iframe's own viewport.
export const FRAME_WIDTHS = [320, 390, 768];

const CASE_META = {
    empty: {
        countText: 'Todavía no hay pedidos',
        localOpen: true,
        notice: '',
    },
    orders: {
        countText: '5 en curso · 2 nuevos',
        localOpen: true,
        notice: '',
    },
    loading: {
        countText: 'Cargando...',
        localOpen: true,
        notice: '',
    },
    error: {
        countText: 'No se pudieron cargar los pedidos',
        localOpen: true,
        notice: 'No se pudieron cargar los pedidos: permission-denied (fixture local, sin Firebase).',
    },
};

const ORDER_FIXTURES = [
    {
        estado: 'nuevo',
        cliente: 'Cliente de prueba con nombre y dirección largos',
        tipo: 'delivery',
        total: '87.000',
        pago: '💵 Efectivo',
        cabecera: '🍕 2 pizzas · Muzza / Calabresa · 1 extra',
        direccion: 'Av. Ejemplo 1234 casi Calle Larga, barrio de prueba, portón verde',
        notas: 'Sin cebolla, cortar en 8, timbre dos veces por favor',
        accion: '👨‍🍳 Pasar a En preparación',
    },
    {
        estado: 'preparacion',
        cliente: 'Pedido de prueba para retirar',
        tipo: 'retiro',
        total: '55.000',
        pago: '🏦 Transferencia',
        cabecera: '🍕 1 pizza · Suprema · borde relleno',
        direccion: '',
        notas: 'Pasa a las 21:30',
        accion: '🛵 Marcar En camino',
    },
    {
        estado: 'en_camino',
        cliente: 'Mesa 7 · prueba',
        tipo: 'local',
        total: '39.000',
        pago: '💳 POS',
        cabecera: '🍕 1 pizza · Cuatro Quesos · papas grandes',
        direccion: '',
        notas: 'Cobrar al finalizar',
        accion: '✅ Marcar Entregado',
    },
];

function caseData(caseName) {
    return {
        caseName,
        ...CASE_META[caseName],
        orders: caseName === 'orders' ? ORDER_FIXTURES : [],
        emptyMessage: 'Cuando entre un pedido va a aparecer acá al instante.',
    };
}

// This function is serialized into the fixture. It must stay self-contained: no imports,
// no closures, no business writes — only fake DOM wiring and click counters.
function fixtureMain(data) {
    const doc = document;
    const $ = (id) => doc.getElementById(id);
    const counts = window.__TPV_PREVIEW_COUNTS__ = {};
    window.__TPV_PREVIEW_ERRORS__ = [];

    // Fake "logged in" state for layout review only. The banner states it is not the app.
    const login = $('login');
    const panel = $('panel');
    if (login) login.classList.add('hidden');
    if (panel) panel.classList.remove('hidden');
    const version = $('version-panel');
    if (version) version.textContent = 'VISTA PREVIA · sin Firebase';

    const visible = ['btn-local', 'btn-autoprint', 'btn-agotados', 'btn-config', 'btn-cocina',
        'btn-rapida', 'btn-nuevo', 'btn-caja', 'btn-sonido', 'btn-notif', 'btn-salir', 'btn-mas'];
    visible.forEach((id) => { const node = $(id); if (node) node.classList.remove('hidden'); });
    // btn-apariencia stays hidden for the administrator, exactly like the real app.
    const localAuto = $('btn-local-auto');
    if (localAuto) localAuto.classList.add('hidden');

    const contador = $('contador');
    if (contador) contador.textContent = data.countText;

    const filtros = $('filtros');
    if (filtros) {
        const defs = [['todos', 'Todos', 3], ['nuevo', 'Nuevos', 1], ['preparacion', 'En prep.', 1], ['en_camino', 'En camino', 1]];
        filtros.innerHTML = defs.map(([key, label, n], i) => '<button type="button" data-filtro="' + key
            + '" class="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full '
            + (i === 0 ? 'bg-white text-red-700' : 'bg-white/20 text-white') + '">' + label
            + ' <span class="opacity-80 filtro-num">' + (data.caseName === 'orders' ? n : 0) + '</span></button>').join('');
    }

    const local = $('btn-local');
    if (local) {
        local.className = 'text-xs font-extrabold px-3 py-1.5 rounded-lg leading-tight text-left text-white ring-2 ring-white/70 '
            + (data.localOpen ? 'bg-green-600 hover:bg-green-700' : 'bg-neutral-900 hover:bg-black');
        local.innerHTML = '<span class="local-estado">' + (data.localOpen ? '🟢 ABIERTO' : '🔴 CERRADO') + '</span>'
            + '<span class="local-modo block text-[10px] font-semibold opacity-80">Manual · hasta 23:30</span>';
    }
    const agotados = $('btn-agotados');
    if (agotados) agotados.textContent = '🚫 Agotados (2)';
    const autoprint = $('btn-autoprint');
    if (autoprint) autoprint.textContent = '🖨️ Auto';
    const notif = $('btn-notif');
    if (notif) {
        notif.textContent = '🔔 Notif.: falta configurar';
        notif.setAttribute('aria-pressed', 'false');
        notif.dataset.pushEstado = 'pending';
    }
    const sonido = $('btn-sonido');
    if (sonido) sonido.textContent = '🔔 Sonido';

    const aviso = $('aviso-error');
    if (aviso) {
        if (data.notice) {
            aviso.textContent = data.notice;
            aviso.classList.remove('hidden');
        } else {
            aviso.textContent = '';
            aviso.classList.add('hidden');
        }
    }

    const lista = $('lista');
    if (lista) {
        if (data.caseName === 'orders') {
            lista.innerHTML = data.orders.map((order, index) => '<article data-estado="' + order.estado
                + '" data-tipo="' + order.tipo + '" class="bg-white rounded-2xl shadow-sm border border-neutral-200 pedido-card">'
                + '<div class="pedido-head flex items-center justify-between gap-2 px-3 py-2.5">'
                + '<div class="pedido-head-main min-w-0 flex items-center gap-2 flex-wrap">'
                + '<span class="pedido-num inline-block text-xs font-black px-2 py-0.5 rounded-lg bg-neutral-900 text-white">#' + (101 + index) + '</span>'
                + '<span class="pedido-cliente font-extrabold truncate max-w-[11rem]">' + order.cliente + '</span>'
                + '<span class="pedido-tipo inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">' + order.tipo.toUpperCase() + '</span>'
                + '</div><span class="pedido-estado inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">' + order.estado.toUpperCase() + '</span>'
                + '</div>'
                + '<div class="pedido-detalle px-4 pb-4 pt-2 space-y-2">'
                + '<div class="pedido-pizzas text-sm font-bold">' + order.cabecera + '</div>'
                + (order.direccion ? '<div class="text-sm text-neutral-700">📍 ' + order.direccion + '</div>' : '')
                + (order.notas ? '<div class="text-sm text-neutral-700">📝 ' + order.notas + '</div>' : '')
                + '<div class="pedido-descuento text-sm text-neutral-600">' + order.pago + '</div>'
                + '<div class="flex items-center justify-between pt-1"><div class="pedido-total text-xl font-black text-red-700">Gs. ' + order.total + '</div>'
                + '<div class="pedido-acciones flex flex-wrap gap-2"><button type="button" data-accion="avanzar" class="text-xs bg-red-700 text-white font-bold px-3 py-2.5 rounded-xl">' + order.accion + '</button></div></div>'
                + '</div></article>').join('');
        } else if (data.caseName === 'empty') {
            lista.innerHTML = '<p class="text-center text-neutral-500 py-10">' + data.emptyMessage + '</p>';
        } else {
            lista.innerHTML = '';
        }
    }

    const count = (id, fn) => {
        const node = $(id);
        if (!node) return;
        node.addEventListener('click', () => {
            counts[id] = (counts[id] || 0) + 1;
            try { if (fn) fn(); } catch (error) { window.__TPV_PREVIEW_ERRORS__.push(String(error)); }
        });
    };
    const show = (id) => { const node = $(id); if (node) node.classList.remove('hidden'); };
    const hide = (id) => { const node = $(id); if (node) node.classList.add('hidden'); };

    count('btn-nuevo', () => show('modal-nuevo'));
    count('btn-caja', () => show('modal-caja'));
    count('btn-config', () => show('modal-config'));
    count('btn-cocina', () => show('vista-cocina'));
    count('btn-agotados', () => show('modal-agotados'));
    count('btn-apariencia', () => show('modal-apariencia'));
    count('btn-rapida', () => { const n = $('btn-nuevo'); if (n) n.click(); });
    count('btn-local-auto', () => { if (contador) contador.textContent = 'Modo automático (fixture)'; });
    count('btn-autoprint', () => { if (autoprint) autoprint.textContent = '🖨️ Auto ON'; });
    count('btn-sonido', () => { if (sonido) sonido.textContent = sonido.textContent.indexOf('🔔') === 0 ? '🔕 Sonido' : '🔔 Sonido'; });
    count('btn-local', () => {
        if (!local) return;
        data.localOpen = !data.localOpen;
        const estado = local.querySelector('.local-estado');
        if (estado) estado.textContent = data.localOpen ? '🟢 ABIERTO' : '🔴 CERRADO';
        local.classList.toggle('bg-green-600', data.localOpen);
        local.classList.toggle('bg-neutral-900', !data.localOpen);
    });
    count('btn-notif', () => {
        if (!notif) return;
        const active = notif.getAttribute('aria-pressed') === 'true';
        notif.setAttribute('aria-pressed', active ? 'false' : 'true');
        notif.dataset.pushEstado = active ? 'inactive' : 'active';
        notif.textContent = active ? '🔔 Activar notificaciones' : '🔔 Notif. activas';
    });
    count('btn-salir', () => {
        const toast = $('toast');
        if (toast) {
            toast.textContent = 'VISTA PREVIA: salir no ejecuta autenticación';
            toast.classList.remove('hidden');
        }
    });

    [['nuevo-cerrar', 'modal-nuevo'], ['cfg-cerrar', 'modal-config'], ['agot-cerrar', 'modal-agotados'],
        ['apariencia-cerrar', 'modal-apariencia'], ['cocina-cerrar', 'vista-cocina'],
        ['caja-cerrar-modal', 'modal-caja']].forEach(([buttonId, modalId]) => {
        const button = $(buttonId);
        if (button) button.addEventListener('click', () => hide(modalId));
    });

    // Machine-readable DOM interaction report for headless checks (never a screenshot-only claim).
    window.addEventListener('load', () => {
        const result = {
            case: data.caseName,
            ready: doc.body.classList.contains('tpv-mobile-ready'),
            headerInPanel: !!(panel && $('tpv-mobile-header') && panel.contains($('tpv-mobile-header'))),
            loginClean: !($('login') && $('login').querySelector('#tpv-mobile-header, #tpv-mobile-nav, #tpv-tools-sheet')),
            navItems: [],
            tools: [],
            sheetClosed: null,
            sheetOpened: false,
            focusEnteredSheet: false,
            backgroundInert: false,
            sheetClosedBeforeDispatch: null,
            configDispatched: false,
            nuevoDispatched: false,
            emptyDecorated: false,
            emptyCta: false,
            cardCount: 0,
            statusText: null,
            errors: window.__TPV_PREVIEW_ERRORS__.slice(),
            failure: null,
        };
        try {
            const nav = $('tpv-mobile-nav');
            const grid = $('tpv-tools-grid');
            const sheet = $('tpv-tools-sheet');
            result.navItems = nav ? Array.prototype.map.call(nav.querySelectorAll('[data-nav]'), (b) => b.getAttribute('data-nav')) : [];
            result.tools = grid ? Array.prototype.map.call(grid.querySelectorAll('[data-tool-target]'), (b) => b.getAttribute('data-tool-target')) : [];
            result.sheetClosed = sheet ? sheet.hasAttribute('hidden') : null;

            const mas = nav && nav.querySelector('[data-nav="mas"]');
            if (mas) mas.click();
            result.sheetOpened = !!sheet && !sheet.hasAttribute('hidden');
            result.focusEnteredSheet = !!sheet && sheet.contains(doc.activeElement);
            result.backgroundInert = !!($('header-panel') && $('header-panel').inert);

            const config = grid && grid.querySelector('[data-tool-target="btn-config"]');
            const beforeConfig = counts['btn-config'] || 0;
            if (config) config.click();
            result.sheetClosedBeforeDispatch = sheet ? sheet.hasAttribute('hidden') : null;
            result.configDispatched = (counts['btn-config'] || 0) === beforeConfig + 1;

            ['modal-config', 'modal-nuevo', 'modal-caja', 'modal-apariencia', 'modal-agotados', 'vista-cocina']
                .forEach((id) => hide(id));
            const nuevo = nav && nav.querySelector('[data-nav="nuevo"]');
            const beforeNuevo = counts['btn-nuevo'] || 0;
            if (nuevo) nuevo.click();
            result.nuevoDispatched = (counts['btn-nuevo'] || 0) === beforeNuevo + 1;

            result.emptyDecorated = !!doc.querySelector('#lista .tpv-empty-state');
            result.emptyCta = !!doc.querySelector('#lista .tpv-empty-cta');
            result.cardCount = doc.querySelectorAll('#lista .pedido-card').length;
            result.statusText = $('tpv-mobile-status') ? $('tpv-mobile-status').textContent : null;

            // Layout evidence: horizontal overflow is a visible defect on a phone.
            const viewportWidth = window.innerWidth;
            result.viewport = { innerWidth: viewportWidth, scrollWidth: doc.documentElement.scrollWidth };
            const offenders = [];
            Array.prototype.forEach.call(doc.querySelectorAll('body *'), (node) => {
                if (offenders.length >= 8) return;
                const rect = node.getBoundingClientRect();
                if (rect.width && rect.right > viewportWidth + 1) {
                    offenders.push((node.tagName || '').toLowerCase() + (node.id ? '#' + node.id : '')
                        + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
                        + ' right=' + Math.round(rect.right));
                }
            });
            result.overflowing = offenders;

            // Leave a clean, representative frame for screenshots (the checks above open modals).
            ['modal-config', 'modal-nuevo', 'modal-caja', 'modal-apariencia', 'modal-agotados', 'vista-cocina']
                .forEach((id) => hide(id));
        } catch (error) {
            result.failure = String(error);
        }
        doc.documentElement.setAttribute('data-tpv-preview-result', JSON.stringify(result));
        window.__TPV_PREVIEW_RESULT__ = result;
        console.log('TPV_PREVIEW_RESULT:' + JSON.stringify(result));
        // Dev-only visual aid: .../mock-orders.html#sheet leaves the More sheet open for a screenshot.
        if (String(location.hash || '').indexOf('sheet') > -1) {
            const sheetNode = $('tpv-tools-sheet');
            const masButton = $('tpv-mobile-nav') && $('tpv-mobile-nav').querySelector('[data-nav="mas"]');
            if (masButton && sheetNode && sheetNode.hasAttribute('hidden')) masButton.click();
        }
    });
}

export function resolvePreviewDir(outDir, { workspaceRoot = process.cwd(), tempRoot = tmpdir() } = {}) {
    if (!outDir || typeof outDir !== 'string') throw new Error('preview: --out must be a non-empty path');
    if (!isAbsolute(outDir)) throw new Error('preview: --out must be an absolute path');
    const out = resolve(outDir);
    const root = resolve(workspaceRoot);
    const relWorkspace = relative(root, out);
    if (relWorkspace === '' || (!relWorkspace.startsWith('..') && !isAbsolute(relWorkspace))) {
        throw new Error('preview: output must live outside the workspace');
    }
    const temp = resolve(tempRoot);
    const relTemp = relative(temp, out);
    const insideTemp = relTemp === '' || (!relTemp.startsWith('..') && !isAbsolute(relTemp));
    if (!insideTemp) {
        throw new Error('preview: output must live inside the approved temp directory');
    }
    return out;
}

export function buildPreviewHtml({ indexHtml, caseName }) {
    if (!CASES.includes(caseName)) throw new Error(`preview: unknown case "${caseName}"`);
    if (typeof indexHtml !== 'string' || !indexHtml.includes('<body')) {
        throw new Error('preview: index.html source was not provided');
    }
    let html = indexHtml;
    const modulePattern = /<script type="module">[\s\S]*?<\/script>/;
    if (!modulePattern.test(html)) throw new Error('preview: Firebase business module not found in index.html');
    const fixture = `const PREVIEW_CASE = '${caseName}';\n`
        + `(${fixtureMain.toString()})(${JSON.stringify(caseData(caseName))});\n`;
    html = html.replace(modulePattern, () => `<script>\n${fixture}\n</script>`);

    // No network: remove every remote script (Tailwind CDN and any future external tag).
    html = html.replace(/[ \t]*<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*["'][^>]*>\s*<\/script>\s*\r?\n?/gi, '');
    // Remove remote module scripts too, in case a future refactor splits them.
    html = html.replace(/[ \t]*<script\b[^>]*type\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*["'][^>]*>\s*<\/script>\s*\r?\n?/gi, '');

    const banner = `<div id="tpv-preview-banner" role="note" style="position:fixed;left:8px;top:8px;z-index:2147483647;background:#7f1d1d;color:#fff;font:700 10px/1.4 system-ui,sans-serif;padding:4px 8px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:.94">${BANNER}</div>\n`;
    html = html.replace(/<body([^>]*)>/, (match, attrs) => `<body${attrs}>\n${banner}`);
    html = html.replace('</head>', `    <meta name="tpv-preview-case" content="${caseName}">\n    <meta name="robots" content="noindex, nofollow">\n</head>`);
    return html;
}

export function buildFramesHtml({ caseName }) {
    if (!CASES.includes(caseName)) throw new Error(`preview: unknown case "${caseName}"`);
    const figures = FRAME_WIDTHS.map((width) => `
    <figure>
      <figcaption>${width} px de ancho</figcaption>
      <iframe src="mock-${caseName}.html" width="${width}" height="844" title="Vista previa ${width} px"></iframe>
    </figure>`).join('');
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Marco de revisión ${caseName} — 320 / 390 / 768 px</title>
<style>
  body { margin: 0; padding: 12px; background: #e5e7eb; display: flex; gap: 14px; align-items: flex-start;
         font: 600 11px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #334155; }
  figure { margin: 0; }
  figcaption { margin-bottom: 6px; text-transform: uppercase; letter-spacing: .08em; }
  iframe { border: 0; background: #ffffff; box-shadow: 0 10px 30px -18px rgba(15, 23, 42, .5); }
</style>
</head>
<body>
    <div style="position:fixed;left:8px;bottom:8px;z-index:9;background:#7f1d1d;color:#fff;padding:4px 8px;border-radius:999px">${BANNER}</div>${figures}
</body>
</html>
`;
}

export function generatePreview({ outDir, cases = CASES, workspaceRoot = process.cwd() } = {}) {
    const safeOut = resolvePreviewDir(outDir, { workspaceRoot });
    for (const name of cases) {
        if (!CASES.includes(name)) throw new Error(`preview: unknown case "${name}"`);
    }
    mkdirSync(safeOut, { recursive: true });
    const indexHtml = readFileSync(join(APP_DIR, 'index.html'), 'utf8');
    const files = [];
    const frames = [];
    for (const name of cases) {
        const file = join(safeOut, `mock-${name}.html`);
        writeFileSync(file, buildPreviewHtml({ indexHtml, caseName: name }), 'utf8');
        files.push(file);
        const frameFile = join(safeOut, `frames-${name}.html`);
        writeFileSync(frameFile, buildFramesHtml({ caseName: name }), 'utf8');
        frames.push(frameFile);
    }
    copyFileSync(join(APP_DIR, 'mobile-ui.js'), join(safeOut, 'mobile-ui.js'));
    const cssSource = join(APP_DIR, 'mobile.css');
    const cssCopied = existsSync(cssSource);
    if (cssCopied) copyFileSync(cssSource, join(safeOut, 'mobile.css'));
    return {
        dir: safeOut,
        files,
        frames,
        controller: join(safeOut, 'mobile-ui.js'),
        css: cssCopied ? join(safeOut, 'mobile.css') : null,
        missingCss: !cssCopied,
    };
}

function startServer(dir, port) {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    const server = createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const name = url.pathname === '/' ? '/mock-orders.html' : url.pathname;
        const file = resolve(join(dir, decodeURIComponent(name)));
        const rel = relative(dir, file);
        if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(file)) {
            res.statusCode = 404;
            res.end('not found');
            return;
        }
        const ext = file.slice(file.lastIndexOf('.'));
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
    });
    server.listen(port, '127.0.0.1', () => {
        const actual = server.address().port;
        console.log(`Preview local: http://127.0.0.1:${actual}/mock-orders.html`);
        console.log('Casos: ' + CASES.map((c) => `http://127.0.0.1:${actual}/mock-${c}.html`).join('  '));
        console.log('Resultado DOM: data-tpv-preview-result / window.__TPV_PREVIEW_RESULT__ / consola TPV_PREVIEW_RESULT:');
    });
    return server;
}

async function main() {
    const args = process.argv.slice(2);
    const valueOf = (flag, fallback) => {
        const index = args.indexOf(flag);
        return index > -1 && args[index + 1] ? args[index + 1] : fallback;
    };
    if (args.includes('--help')) {
        console.log('Uso: node tools/preview-mobile.mjs [--out <carpeta-temp-absoluta>] [--cases empty,orders,loading,error] [--serve] [--port 4173]');
        return;
    }
    const outDir = valueOf('--out', join(tmpdir(), 'mi-barrio-tpv-preview-' + Date.now()));
    const cases = valueOf('--cases', CASES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
    const result = generatePreview({ outDir, cases, workspaceRoot: REPO_ROOT });
    console.log('Fixtures generados en: ' + result.dir);
    console.log('Archivos: ' + result.files.map((f) => f.split(/[\\/]/).pop()).join(', '));
    console.log('Marcos 320/390/768: ' + result.frames.map((f) => f.split(/[\\/]/).pop()).join(', '));
    console.log('Controlador copiado: ' + result.controller);
    if (result.missingCss) {
        console.log('Aviso: mobile.css todavía no existe; la vista previa usa solo el CSS inline original.');
    } else {
        console.log('Estilos móviles copiados: ' + result.css);
    }
    console.log('Los fixtures son datos falsos: no usan Firebase, no escriben pedidos y no registran service worker.');
    if (args.includes('--serve')) {
        const port = Number(valueOf('--port', '0')) || 0;
        startServer(result.dir, port);
    } else {
        console.log('Serví la carpeta por localhost (nunca file://), por ejemplo:');
        console.log(`  node mi-barrio-tpv-celular/tools/preview-mobile.mjs --out "${result.dir}" --serve --port 4173`);
    }
}

const invokedDirectly = (() => {
    try {
        return !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
    } catch (e) {
        return false;
    }
})();

if (invokedDirectly) {
    main().catch((error) => {
        console.error('preview: ' + (error && error.message ? error.message : error));
        process.exitCode = 1;
    });
}
