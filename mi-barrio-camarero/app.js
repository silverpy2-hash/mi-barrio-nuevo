// Mi Barrio · Camarero — página exclusiva para el rol camarero.
// Subconjunto del TPV (panel_nuevo.html): pedidos locales de mesa, catálogo,
// constructor de pizzas y cola de solicitudes confirmadas por el TPV administrador.
// NO cobra, NO cancela, NO cambia estados, NO abre/cierra el local.
// El camarero NO escribe en pedidos: manda la propuesta SIN precios a solicitudes_mesa;
// el TPV administrador recalcula importes con config/menu antes de crear/agregar.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, query, limit, onSnapshot, doc, serverTimestamp, addDoc, where, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const VERSION_CAMARERO = '2026-11-18 #1 · camarero standalone';
console.info('[Camarero] versión:', VERSION_CAMARERO);

// Mismo proyecto Firebase que el resto de Mi Barrio (Spark, SDK CDN).
const firebaseConfig = {
    apiKey: "AIzaSyBczdHiqe4fO6XThYRQky-WBlwgdhWDYCI",
    authDomain: "mi-barrio-pedidos.firebaseapp.com",
    projectId: "mi-barrio-pedidos",
    storageBucket: "mi-barrio-pedidos.firebasestorage.app",
    messagingSenderId: "495947210483",
    appId: "1:495947210483:web:949ae24ccf15bd025a6186"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const ESTADOS = {
    nuevo:       { label: 'Nuevo',          badge: 'st-nuevo' },
    preparacion: { label: 'En preparación', badge: 'st-preparacion' },
    en_camino:   { label: 'En camino',      badge: 'st-en_camino' },
    entregado:   { label: 'Entregado',      badge: 'st-entregado' },
    cancelado:   { label: 'Cancelado',      badge: 'st-cancelado' }
};
const ACTIVOS = ['nuevo', 'preparacion', 'en_camino'];
const MIN_ATENCION = 15, MIN_URGENTE = 30;

// Catálogo por defecto. Si el TPV guardó config/menu se usa ese (mismo criterio que el TPV).
const MENU = {
    tamanos: {
        'grande':      { nombre: 'Pizza Grande + Mediana muzza gratis', corto: 'Grande',     limite: 2, borde: 15000, precios: { clasico: 60000, especial: 75000, gourmet: 90000 } },
        'mediano':     { nombre: 'Pizza Mediana',                       corto: 'Mediana',    limite: 2, borde: 12000, precios: { clasico: 30000, especial: 40000, gourmet: 50000 } },
        'chico':       { nombre: 'Pizza Tren Chico',                    corto: 'Tren Chico', limite: 2, borde: 20000, precios: { clasico: 55000, especial: 65000, gourmet: 75000 } },
        'tren-grande': { nombre: 'Pizza Tren Grande',                   corto: 'Tren Grande', limite: 3, borde: 30000, precios: { clasico: 75000, especial: 90000, gourmet: 110000 } }
    },
    sabores: {
        gourmet:  ['Suprema', 'Carnívora', 'Carne Katupiry', 'Pollo Katupiry', 'Mexicana', 'Barbacoa de la Casa', 'Costilla BBC'],
        especial: ['Calabacón', 'Especial', 'Peperonni', 'Carbonara', 'Cuatro Quesos', 'Calabresa', 'Bacon', 'Pollo Cheddar', 'Portuguesa'],
        clasico:  ['Muzza', 'Choclo', 'Palmito', 'Vegetariana', 'Napolitana', 'Jamón', 'Margarita', 'Pollo bbc', 'Ajo & Aceite', 'Queso Paraguay']
    },
    extras: [
        ['papas-med', 'Papas Medianas', 15000],
        ['papas-gra', 'Papas Grandes', 25000],
        ['coca-500', 'Coca Cola 500ml', 8000],
        ['coca-1l', 'Coca Cola 1LT', 12000],
        ['coca-15l', 'Coca Cola 1.5LT', 17000]
    ]
};
const GRUPOS_SABOR = [['gourmet', '⭐ Gourmet', 'gs-gourmet'], ['especial', '✨ Especiales', 'gs-especial'], ['clasico', '🍃 Clásicos', 'gs-clasico']];

// ===== Estado =====
let panelAbierto = false;
let usuarioUid = null;
let pedidos = [];
let vistos = null, recien = new Set();
let abiertos = new Set();
let mesas = [], mesasListas = false;
let misSolicitudes = [];
let cancelarEscucha = null, cancelarMesas = null, cancelarMenu = null, cancelarSolicitudes = null;
const nuevo = { mesa: null, tamano: 'grande', sabores: [], borde: false, pizzas: [], extras: {}, guardando: false, agregarA: null, agregarNombre: '' };

// ===== Utilidades =====
function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function gs(n) { return Number(n || 0).toLocaleString('es-PY') + ' Gs'; }
function estadoDe(p) { return ESTADOS[p.estado] ? p.estado : 'nuevo'; }
function creadoMs(p) { return p.creado && p.creado.toMillis ? p.creado.toMillis() : Date.now(); }
function fechaCorta(ms) { return new Date(ms).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function numeroCorto(p) { return p.numero ? '#' + p.numero : '#--'; }
function hace(ms) {
    const m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'Hace menos de 1 min';
    if (m < 60) return 'Hace ' + m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return 'Hace ' + h + ' h' + (r ? ' ' + r + ' min' : '');
    const d = Math.floor(h / 24);
    return 'Hace ' + d + (d === 1 ? ' día' : ' días');
}
function claseTiempo(ms) {
    const m = (Date.now() - ms) / 60000;
    if (m >= MIN_URGENTE) return 't-urgente';
    if (m >= MIN_ATENCION) return 't-aviso';
    return 't-ok';
}
function mostrarError(msg) { const av = $('aviso-error'); av.textContent = msg; av.classList.remove('hidden'); }
function ocultarError() { $('aviso-error').classList.add('hidden'); }
let toastTimer = null;
function mostrarToast(texto) {
    const t = $('toast');
    t.textContent = texto;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 4500);
}
function nuevoCat(sabores) {
    if (sabores.some(x => MENU.sabores.gourmet.includes(x))) return 'gourmet';
    if (sabores.some(x => MENU.sabores.especial.includes(x))) return 'especial';
    return 'clasico';
}
function nuevoPrecio(tam, sabores, borde) {
    const t = MENU.tamanos[tam];
    return t.precios[nuevoCat(sabores)] + (borde ? t.borde : 0);
}
function nuevoTotales() {
    const sub = nuevo.pizzas.reduce((a, z) => a + z.precio, 0) +
        MENU.extras.reduce((a, x) => a + (nuevo.extras[x[0]] || 0) * x[2], 0);
    return { sub, total: sub };
}
function itemsSinPrecios(n) {
    return {
        pizzas: n.pizzas.map(z => ({ tamano: z.tamano, sabores: z.sabores.slice(), borde: !!z.borde })),
        extras: MENU.extras.filter(x => (n.extras[x[0]] || 0) > 0).map(x => ({ id: x[0], cantidad: n.extras[x[0]] }))
    };
}

// ===== Temas (nombres actuales del TPV; subset de 2 opciones) =====
// Clave propia por equipo+usuario: no interfiere con el TPV (temaPanel:*).
const TEMAS = [
    ['camarero', 'Camarero móvil', 'Oscuro, compacto y botones táctiles. Pensado para el celular.'],
    ['clasico',  'Clásico',        'Claro, encabezado rojo. La vista de siempre.']
];
const claveTema = () => usuarioUid ? 'miBarrioCamarero:tema:' + usuarioUid : null;
function leerTema() {
    const k = claveTema();
    if (!k) return 'camarero';
    try { const t = localStorage.getItem(k); return TEMAS.some(x => x[0] === t) ? t : 'camarero'; } catch (e) { return 'camarero'; }
}
function aplicarTema(tema, guardar) {
    if (!TEMAS.some(x => x[0] === tema)) tema = 'camarero';
    document.body.dataset.tema = tema;
    if (guardar !== false) { const k = claveTema(); if (k) { try { localStorage.setItem(k, tema); } catch (e) {} } }
    document.querySelectorAll('[data-tema-card]').forEach(c => c.classList.toggle('actual', c.getAttribute('data-tema-card') === tema));
}
function pintarApariencia() {
    const cont = $('apariencia-grid');
    const actual = document.body.dataset.tema || 'camarero';
    cont.innerHTML = TEMAS.map(([k, nombre, desc]) => `
        <div class="tema-card${actual === k ? ' actual' : ''}" data-tema-card="${k}">
            <div class="mini" aria-hidden="true">${k === 'camarero'
                ? '<div style="height:12px;background:#171717;border-bottom:2px solid #f59e0b"></div><div style="padding:8px;display:grid;gap:5px;background:#e7e5e4"><div style="height:12px;border-radius:6px;background:#f59e0b"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px"><div style="height:18px;border-radius:5px;background:#fff;border:2px solid #e2e8f0"></div><div style="height:18px;border-radius:5px;background:#fff;border:2px solid #e2e8f0"></div></div><div style="height:22px;border-radius:6px;background:#fff;border:1px solid #e2e8f0"></div></div>'
                : '<div style="height:12px;background:#b91c1c"></div><div style="padding:8px;display:grid;gap:5px;background:#f5f5f4"><div style="height:16px;border-radius:6px;background:#fff;border:1px solid #e2e8f0"></div><div style="height:16px;border-radius:6px;background:#fff;border:1px solid #e2e8f0"></div></div>'}</div>
            <div><strong>${esc(nombre)}</strong></div>
            <small>${esc(desc)}</small>
            ${actual === k ? '<div class="tema-actual-lbl">✓ En uso</div>' : `<button type="button" class="tema-btn" data-usar-tema="${k}">Usar este</button>`}
        </div>`).join('');
}
$('apariencia-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-usar-tema]');
    if (!b) return;
    aplicarTema(b.getAttribute('data-usar-tema'), true);
    pintarApariencia();
});
$('btn-apariencia').addEventListener('click', () => { pintarApariencia(); $('modal-apariencia').classList.remove('hidden'); });
$('apariencia-cerrar').addEventListener('click', () => $('modal-apariencia').classList.add('hidden'));
$('modal-apariencia').addEventListener('click', (e) => { if (e.target === $('modal-apariencia')) $('modal-apariencia').classList.add('hidden'); });

// ===== Aviso sonoro (clave propia por usuario; no interfiere con el TPV) =====
let audioCtx = null;
let sonidoActivo = true;
const claveSonido = () => usuarioUid ? 'miBarrioCamarero:sonido:' + usuarioUid : null;
function leerSonido() { const k = claveSonido(); try { return k ? localStorage.getItem(k) !== '0' : true; } catch (e) { return true; } }
function guardarSonido() { const k = claveSonido(); try { if (k) localStorage.setItem(k, sonidoActivo ? '1' : '0'); } catch (e) {} }
function obtenerAudio() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) { audioCtx = new AC(); audioCtx.onstatechange = actualizarAvisoSonido; }
    }
    return audioCtx;
}
async function desbloquearAudio() {
    const ctx = obtenerAudio();
    if (ctx && ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    actualizarAvisoSonido();
}
function actualizarAvisoSonido() {
    const btn = $('btn-sonido');
    btn.textContent = sonidoActivo ? '🔔 Sonido: sí' : '🔕 Sonido: no';
    const bloqueado = sonidoActivo && (!audioCtx || audioCtx.state !== 'running');
    $('aviso-sonido').classList.toggle('hidden', !(bloqueado && panelAbierto));
}
function tono(ctx, freq, inicio, dur) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(0.5, inicio + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + dur + 0.05);
}
function sonarAlerta(forzar) {
    if (!sonidoActivo && !forzar) return;
    const ctx = obtenerAudio();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
        tono(ctx, 880, t + i * 0.9, 0.35);
        tono(ctx, 1174.66, t + i * 0.9 + 0.4, 0.45);
    }
}
document.addEventListener('pointerdown', desbloquearAudio);
document.addEventListener('keydown', desbloquearAudio);
$('aviso-sonido').addEventListener('click', desbloquearAudio);
$('btn-sonido').addEventListener('click', async () => {
    sonidoActivo = !sonidoActivo;
    guardarSonido();
    await desbloquearAudio();
    if (sonidoActivo) sonarAlerta(true);
    actualizarAvisoSonido();
});

let wakeLock = null;
async function mantenerPantalla() {
    try { if ('wakeLock' in navigator && panelAbierto) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mantenerPantalla(); });

// ===== Limpieza de listeners y datos =====
function cancelarListeners() {
    if (cancelarEscucha) { cancelarEscucha(); cancelarEscucha = null; }
    if (cancelarMesas) { cancelarMesas(); cancelarMesas = null; }
    if (cancelarMenu) { cancelarMenu(); cancelarMenu = null; }
    if (cancelarSolicitudes) { cancelarSolicitudes(); cancelarSolicitudes = null; }
}
function limpiarDatos() {
    pedidos = []; vistos = null; recien = new Set(); abiertos = new Set();
    mesas = []; mesasListas = false; misSolicitudes = [];
    $('lista').innerHTML = '';
    $('solicitudes-lista').innerHTML = '';
    $('estado-solicitudes').classList.add('hidden');
    $('solicitudes-box').classList.add('hidden');
    $('contador').textContent = 'Cargando...';
    document.title = 'Mi Barrio · Camarero';
}

// ===== Login =====
$('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    const btn = $('btn-entrar');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    desbloquearAudio();
    try {
        await signInWithEmailAndPassword(auth, $('email').value.trim(), $('clave').value);
    } catch (ex) {
        console.warn('[Camarero] login:', ex && ex.code);
        err.textContent = 'No se pudo entrar. Revisá el correo y la contraseña.';
        err.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
    }
});
$('btn-salir').addEventListener('click', () => signOut(auth));
$('btn-salir-bloqueado').addEventListener('click', () => signOut(auth));

// Se valida el rol ANTES de suscribirse a cualquier dato: sin rol camarero activo
// no se lee nada (ni pedidos, ni menú, ni mesas, ni solicitudes).
onAuthStateChanged(auth, async (user) => {
    if (user) {
        usuarioUid = user.uid;
        sonidoActivo = leerSonido();

        let permitido = false, motivo = 'Esta cuenta no tiene el rol de camarero activo.';
        try {
            const perfil = await getDoc(doc(db, 'usuarios', user.uid));
            const dp = perfil.exists() ? (perfil.data() || {}) : {};
            permitido = dp.rol === 'camarero' && dp.activo === true;
            if (!permitido && !perfil.exists()) motivo = 'No existe el perfil de esta cuenta (usuarios/{uid}). Pedile al administrador que lo cree.';
            else if (!permitido && dp.rol !== 'camarero') motivo = 'Esta cuenta no es de camarero.';
            else if (!permitido) motivo = 'El usuario de camarero está desactivado.';
        } catch (e) {
            console.warn('[Camarero] No se pudo leer usuarios/{uid}:', e.code || e.message);
            motivo = 'No se pudo verificar el permiso de esta cuenta (' + (e.code || 'error') + ').';
        }

        if (!permitido) {
            // Bloqueado: NO se suscribe a datos. NO se cierra la sesión automáticamente
            // (el mismo navegador puede tener otras páginas abiertas, p. ej. el TPV como administrador).
            cancelarListeners();
            limpiarDatos();
            panelAbierto = false;
            $('bloqueado-motivo').textContent = motivo;
            $('login').classList.add('hidden');
            $('panel').classList.add('hidden');
            $('modal-nuevo').classList.add('hidden');
            $('modal-apariencia').classList.add('hidden');
            aplicarTema('camarero', false);
            $('bloqueado').classList.remove('hidden');
            return;
        }

        panelAbierto = true;
        $('bloqueado').classList.add('hidden');
        $('login').classList.add('hidden');
        $('panel').classList.remove('hidden');
        aplicarTema(leerTema(), false);
        actualizarAvisoSonido();
        mantenerPantalla();
        ocultarError();
        escucharMenu();
        escucharMesas();
        escucharPedidos();
        escucharMisSolicitudes();
    } else {
        panelAbierto = false;
        usuarioUid = null;
        cancelarListeners();
        limpiarDatos();
        if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
        aplicarTema('camarero', false);
        $('panel').classList.add('hidden');
        $('modal-nuevo').classList.add('hidden');
        $('modal-apariencia').classList.add('hidden');
        $('bloqueado').classList.add('hidden');
        $('login').classList.remove('hidden');
        $('clave').value = '';
        document.title = 'Mi Barrio · Camarero';
    }
});

// ===== Menú (config/menu): el TPV lo puede editar; acá solo se usa para mostrar/calcular =====
function escucharMenu() {
    if (cancelarMenu) cancelarMenu();
    cancelarMenu = onSnapshot(doc(db, 'config', 'menu'), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (d.tamanos) MENU.tamanos = d.tamanos;
        if (d.sabores) MENU.sabores = d.sabores;
        if (d.extras) MENU.extras = d.extras.map(x => [x.id, x.nombre, Number(x.precio) || 0]);
        if (!MENU.tamanos[nuevo.tamano]) nuevo.tamano = Object.keys(MENU.tamanos)[0];
        nuevo.sabores = nuevo.sabores.filter(x => Object.values(MENU.sabores).some(a => a.includes(x)));
        if (!$('modal-nuevo').classList.contains('hidden')) renderNuevo();
    }, (err) => console.warn('[Camarero] No se pudo leer config/menu:', err.code || err.message));
}

// ===== Mesas (config/mesas): misma lectura que el TPV camarero =====
function escucharMesas() {
    if (cancelarMesas) cancelarMesas();
    cancelarMesas = onSnapshot(doc(db, 'config', 'mesas'), (s) => {
        mesas = Array.isArray(s.exists() ? s.data().mesas : null) ? s.data().mesas.map(Number).filter(n => n > 0) : [];
        mesasListas = true;
        const modal = $('modal-nuevo');
        if (modal && !modal.classList.contains('hidden')) pintarMesasNuevo();
    }, () => { mesasListas = false; });
}

// ===== Pedidos del local en vivo (tipo == 'local'; las reglas lo exigen) =====
function escucharPedidos() {
    if (cancelarEscucha) cancelarEscucha();
    const q = query(collection(db, 'pedidos'), where('tipo', '==', 'local'), limit(300));
    cancelarEscucha = onSnapshot(q, (snap) => {
        ocultarError();
        pedidos = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
            .filter(p => p.estado !== 'archivado' && p.estado !== 'cancelado')
            .sort((a, b) => creadoMs(b) - creadoMs(a));

        if (vistos !== null) {
            const llegaron = pedidos.filter(p => !vistos.has(p.id));
            if (llegaron.length) {
                llegaron.forEach(p => recien.add(p.id));
                sonarAlerta();
                setTimeout(() => { recien = new Set(); render(); }, 10000);
            }
        }
        vistos = new Set(pedidos.map(p => p.id));
        render();
    }, (error) => {
        console.warn('[Camarero] escucha de pedidos:', error.code || error.message);
        mostrarError(error.code === 'permission-denied'
            ? 'Este usuario no tiene permiso para ver los pedidos locales. Entrá con la cuenta de camarero (rol = camarero, activo = sí).'
            : 'No se pudieron cargar los pedidos: ' + (error.message || 'error desconocido'));
    });
}

function actualizarContador() {
    const nuevos = pedidos.filter(p => estadoDe(p) === 'nuevo').length;
    const activos = pedidos.filter(p => ACTIVOS.includes(estadoDe(p))).length;
    $('contador').textContent = pedidos.length === 0
        ? 'Todavía no hay pedidos'
        : activos + ' en curso · ' + nuevos + ' nuevo' + (nuevos === 1 ? '' : 's');
    document.title = (nuevos > 0 ? '(' + nuevos + ') ' : '') + 'Mi Barrio · Camarero';
}

function tarjeta(p) {
    const c = p.cliente || {};
    const e = estadoDe(p);
    const info = ESTADOS[e];
    const ms = creadoMs(p);
    const activo = ACTIVOS.includes(e);
    const idAttr = esc(p.id);
    const nombre = esc(c.nombre || ('Mesa ' + (p.mesa || '')));

    const pizzas = (p.pizzas || []).map((z, i) => `
        <div class="pizza-linea">
            <strong>🍕 Pizza ${i + 1} – ${esc(z.nombre)}</strong>
            <span>${esc((z.sabores || []).join(', '))}${z.borde ? ' · <strong>Borde relleno</strong>' : ''}</span>
            <div class="pizza-precio">${gs(z.precio)}</div>
        </div>`).join('');
    const extras = (p.extras || []).map(x => `<li>${esc(x.item)} x${esc(x.cantidad)}</li>`).join('');
    const abierto = abiertos.has(p.id);

    let botones = '';
    if (e !== 'cancelado' && !p.pagado) {
        botones += `<button type="button" data-accion="agregar" data-id="${idAttr}" class="btn-agregar">➕ Agregar</button>`;
    }

    return `
    <article class="pedido${recien.has(p.id) ? ' recien' : ''}${e === 'cancelado' ? ' cancelado' : ''}" data-estado="${e}">
        <button type="button" data-accion="toggle" data-id="${idAttr}" class="pedido-head" aria-expanded="${abierto ? 'true' : 'false'}">
            <span class="pedido-head-main">
                <span class="pedido-num">${esc(numeroCorto(p))}</span>
                <span class="pedido-cliente">${nombre}</span>
                ${p.mesa ? `<span class="chip-mesa">🪑 Mesa ${esc(p.mesa)}</span>` : ''}
            </span>
            <span class="pedido-head-badges">
                ${p.pagado ? '<span class="badge-pagado">✅ PAGADO</span>' : ''}
                <span class="badge-estado ${info.badge}">${esc(info.label.toUpperCase())}</span>
                <span class="flecha">${abierto ? '▲' : '▼'}</span>
            </span>
        </button>
        <div class="detalle${abierto ? '' : ' hidden'}">
            <div class="detalle-top">
                <div class="detalle-hora">${esc(numeroCorto(p))} · ${esc(fechaCorta(ms))}</div>
                <div class="detalle-total">${gs(p.total)}</div>
            </div>
            ${activo ? `<span class="detalle-tiempo ${claseTiempo(ms)}" data-tiempo="${ms}">⏱ ${esc(hace(ms))}</span>` : ''}
            ${c.notas ? `<div>📝 ${esc(c.notas)}</div>` : ''}
            <div style="display:grid;gap:6px">${pizzas}</div>
            ${extras ? `<ul class="extras-linea">${extras}</ul>` : ''}
            ${p.pagado ? `<div class="cobro-info">✅ Cobrado${p.pago ? ' · ' + esc(p.pago === 'pos' ? 'POS' : (p.pago.charAt(0).toUpperCase() + p.pago.slice(1))) : ''}</div>` : ''}
            ${botones ? `<div class="acciones">${botones}</div>` : ''}
        </div>
    </article>`;
}

function render() {
    actualizarContador();
    if (pedidos.length === 0) {
        $('lista').innerHTML = '<p class="vacio">Cuando entre un pedido del local va a aparecer acá al instante.</p>';
        return;
    }
    $('lista').innerHTML = pedidos.map(tarjeta).join('');
}

$('lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const p = pedidos.find(x => x.id === b.dataset.id);
    if (!p) return;
    const acc = b.dataset.accion;
    if (acc === 'toggle') {
        if (abiertos.has(p.id)) abiertos.delete(p.id); else abiertos.add(p.id);
        render();
    } else if (acc === 'agregar') {
        abrirAgregar(p);
    }
});

// Actualiza los "⏱ Hace N min" una vez por minuto sin re-renderizar toda la lista.
setInterval(() => {
    document.querySelectorAll('[data-tiempo]').forEach(el => {
        const ms = Number(el.getAttribute('data-tiempo'));
        if (ms) el.textContent = '⏱ ' + hace(ms);
    });
}, 60000);

// ===== Mis solicitudes (pendiente / confirmada / rechazada) =====
function escucharMisSolicitudes() {
    if (cancelarSolicitudes) cancelarSolicitudes();
    if (!usuarioUid) return;
    cancelarSolicitudes = onSnapshot(
        query(collection(db, 'solicitudes_mesa'), where('solicitadoPor', '==', usuarioUid), limit(30)),
        (snap) => {
            misSolicitudes = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
                .sort((a, b) => creadoMs(b) - creadoMs(a));
            pintarSolicitudes();
        },
        (err) => {
            console.warn('[Camarero] No se pudo leer solicitudes propias:', err.code || err.message);
            mostrarError('No se pudieron cargar tus solicitudes: ' + (err.message || 'error desconocido'));
        }
    );
}

function pintarSolicitudes() {
    const box = $('solicitudes-box');
    if (!misSolicitudes.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');

    const pendientes = misSolicitudes.filter(s => s.estado === 'pendiente').length;
    $('solicitudes-resumen').textContent = 'Mis solicitudes' + (pendientes ? ' (' + pendientes + ' pendiente' + (pendientes === 1 ? ')' : 's)') : '');

    const estadoSol = $('estado-solicitudes');
    if (pendientes) {
        estadoSol.textContent = '⏳ ' + pendientes + ' pedido' + (pendientes === 1 ? '' : 's') +
            ' esperando confirmación del TPV. El TPV del local debe estar abierto; si nadie confirma, quedan pendientes.';
        estadoSol.classList.remove('hidden');
    } else {
        const rechazadas = misSolicitudes.filter(s => s.estado === 'rechazada');
        if (rechazadas.length) {
            estadoSol.textContent = '⚠️ Última solicitud rechazada: ' + String(rechazadas[0].motivo || 'revisá el pedido');
            estadoSol.classList.remove('hidden');
        } else {
            estadoSol.classList.add('hidden');
        }
    }

    $('solicitudes-lista').innerHTML = misSolicitudes.map(s => {
        const e = s.estado || 'pendiente';
        const chip = e === 'confirmada' ? '<span class="chip-estado chip-confirmada">✅ Confirmada</span>'
            : e === 'rechazada' ? '<span class="chip-estado chip-rechazada">⚠️ Rechazada</span>'
            : '<span class="chip-estado chip-pendiente">⏳ Pendiente</span>';
        const op = s.operacion === 'agregar' ? 'Agregar' : 'Crear';
        const fecha = s.creado ? fechaCorta(creadoMs(s)) : '';
        const detalle = [op + ' · Mesa ' + esc(s.mesa), fecha ? esc(fecha) : '', e === 'confirmada' && s.total ? gs(s.total) : '']
            .filter(Boolean).join(' · ');
        const motivo = e === 'rechazada' && s.motivo ? `<div class="solicitud-motivo">Motivo: ${esc(s.motivo)}</div>` : '';
        return `<li class="solicitud-item">${chip}<span class="solicitud-meta">${detalle}</span>${motivo}</li>`;
    }).join('');
}

// ===== Modal: nuevo pedido / agregar a pedido (siempre mesa, siempre local) =====
function nuevoMsg(id, texto) {
    const el = $(id);
    if (texto) {
        el.textContent = texto;
        el.classList.remove('hidden');
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    } else {
        el.classList.add('hidden');
    }
}
function pintarMesasNuevo() {
    const cont = $('nuevo-mesa');
    if (!mesasListas) { cont.innerHTML = '<p class="total-nota">Cargando mesas…</p>'; return; }
    if (!mesas.length) { cont.innerHTML = '<p class="total-nota" style="color:var(--err-tx);font-weight:700">No hay mesas configuradas. Cargalas en el TPV (Configuración → 🪑 Mesas).</p>'; return; }
    if (nuevo.mesa && !mesas.includes(Number(nuevo.mesa))) nuevo.mesa = null;
    cont.innerHTML = mesas.map(n => `<button type="button" data-n-mesa="${n}" class="mesa-btn${Number(nuevo.mesa) === n ? ' on' : ''}">Mesa ${n}</button>`).join('');
}
function renderNuevo() {
    const enAgregar = !!nuevo.agregarA;
    $('modal-nuevo-titulo').textContent = enAgregar ? '➕ Agregar al pedido' : '➕ Nuevo pedido';
    $('nuevo-agregar-info').classList.toggle('hidden', !enAgregar);
    $('nuevo-cliente-box').classList.toggle('hidden', enAgregar);

    pintarMesasNuevo();

    const t = MENU.tamanos[nuevo.tamano];
    const tams = Object.entries(MENU.tamanos).map(([k, v]) =>
        `<button type="button" data-n-tam="${esc(k)}" class="tam-btn${nuevo.tamano === k ? ' on' : ''}">${esc(v.corto)}<small>desde ${Number(v.precios.clasico).toLocaleString('es-PY')}</small></button>`).join('');
    const grupos = GRUPOS_SABOR.map(([cat, titulo, clase]) =>
        `<div><span class="grupo-sabor-titulo ${clase}">${titulo} · ${gs(t.precios[cat])}</span><div class="sabores-linea">` +
        MENU.sabores[cat].map(sb => `<button type="button" data-n-sabor="${esc(sb)}" class="sabor-btn${nuevo.sabores.includes(sb) ? ' on' : ''}">${esc(sb)}</button>`).join('') +
        `</div></div>`).join('');
    const precio = nuevo.sabores.length ? nuevoPrecio(nuevo.tamano, nuevo.sabores, nuevo.borde) : 0;
    $('nuevo-constructor').innerHTML = `
        <div class="tamanos-grid">${tams}</div>
        ${grupos}
        <button type="button" data-n-borde class="borde-btn${nuevo.borde ? ' on' : ''}">🧀 Borde relleno (+${gs(t.borde)})</button>
        <div class="constructor-pie">
            <div class="constructor-resumen">${nuevo.sabores.length ? '<strong>' + esc(nuevo.sabores.join(' / ')) + '</strong><br><small>' + esc(t.corto) + ' · ' + gs(precio) + '</small>' : '<small>Elegí los sabores (máx. ' + t.limite + ')</small>'}</div>
            <button type="button" data-n-addpizza ${nuevo.sabores.length ? '' : 'disabled'} class="btn-addpizza">＋ Agregar pizza</button>
        </div>`;

    $('nuevo-pizzas').innerHTML = nuevo.pizzas.map((z, i) => `
        <div class="pizza-item">
            <div><strong>🍕 ${esc(MENU.tamanos[z.tamano].corto)}${z.borde ? ' · Borde relleno' : ''}</strong><br><small>${esc(z.sabores.join(' / '))}</small></div>
            <div class="pizza-item-der"><span>${gs(z.precio)}</span><button type="button" data-n-delpizza="${i}" class="btn-delpizza" aria-label="Quitar pizza">✖</button></div>
        </div>`).join('');

    $('nuevo-extras').innerHTML = MENU.extras.map(([k, nombre, pr]) => {
        const n = nuevo.extras[k] || 0;
        return `<div class="extra-fila">
            <span>${esc(nombre)} <small>${gs(pr)}</small></span>
            <span class="extra-controles">
                <button type="button" data-n-extra="${esc(k)}" data-delta="-1" class="extra-btn" aria-label="Quitar uno">−</button>
                <span class="extra-cant">${n}</span>
                <button type="button" data-n-extra="${esc(k)}" data-delta="1" class="extra-btn mas" aria-label="Agregar uno">+</button>
            </span>
        </div>`;
    }).join('');

    renderNuevoTotal();
}
function renderNuevoTotal() {
    const { total } = nuevoTotales();
    if (!nuevo.guardando) $('nuevo-guardar').textContent = (nuevo.agregarA ? '📤 Agregar al pedido · ' : '📤 Enviar pedido · ') + gs(total);
    $('nuevo-total').innerHTML = `<div class="total-fila"><strong>TOTAL</strong><span class="total-grande">${gs(total)}</span></div>`;
}
function nuevoLimpiar() {
    ['nuevo-nombre', 'nuevo-notas'].forEach(id => { $(id).value = ''; });
    nuevo.sabores = []; nuevo.borde = false; nuevo.pizzas = []; nuevo.extras = {};
    nuevo.mesa = null; nuevo.agregarA = null; nuevo.agregarNombre = '';
}
function abrirModal(agregarA) {
    nuevoLimpiar();
    if (agregarA) {
        nuevo.agregarA = agregarA.id;
        nuevo.mesa = Number(agregarA.mesa) || null;
        nuevo.agregarNombre = (agregarA.cliente && agregarA.cliente.nombre) || '';
        $('nuevo-agregar-info').textContent = '➕ Agregando al pedido ' + numeroCorto(agregarA) + ' · Mesa ' + (agregarA.mesa || '-') + ' · ' + ((agregarA.cliente && agregarA.cliente.nombre) || '');
    }
    nuevoMsg('nuevo-ok', ''); nuevoMsg('nuevo-error', '');
    $('modal-nuevo').classList.remove('hidden');
    renderNuevo();
}
function abrirAgregar(p) {
    if (p.estado === 'entregado' || p.pagado) { mostrarToast('⚠️ El pedido ' + numeroCorto(p) + ' ya fue cobrado/entregado: no se puede agregar más. Creá un nuevo pedido.'); return; }
    if (p.tipo !== 'local' || !p.mesa) { mostrarToast('⚠️ Solo se puede agregar a pedidos de mesa.'); return; }
    abrirModal(p);
    nuevoMsg('nuevo-ok', '➕ Agregando al pedido ' + numeroCorto(p) + '. Lo que sumes sale como una solicitud de agregado que valida el TPV.');
}
$('btn-nuevo').addEventListener('click', () => { if (panelAbierto) abrirModal(null); });
$('nuevo-cerrar').addEventListener('click', () => $('modal-nuevo').classList.add('hidden'));
$('modal-nuevo').addEventListener('click', (e) => {
    if (e.target === $('modal-nuevo')) { $('modal-nuevo').classList.add('hidden'); return; }
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    nuevoMsg('nuevo-error', '');
    if (b.id === 'nuevo-cerrar') return;
    if (b.id === 'nuevo-guardar') { enviarSolicitud(); return; }
    if (d.nMesa) { if (nuevo.agregarA) return; nuevo.mesa = Number(d.nMesa); }
    else if (d.nTam) { nuevo.tamano = d.nTam; nuevo.sabores = nuevo.sabores.slice(0, MENU.tamanos[d.nTam].limite); }
    else if (d.nSabor) {
        const i = nuevo.sabores.indexOf(d.nSabor);
        if (i >= 0) nuevo.sabores.splice(i, 1);
        else if (nuevo.sabores.length >= MENU.tamanos[nuevo.tamano].limite) { nuevoMsg('nuevo-error', 'Este tamaño admite hasta ' + MENU.tamanos[nuevo.tamano].limite + ' sabores.'); return; }
        else nuevo.sabores.push(d.nSabor);
    }
    else if ('nBorde' in d) { nuevo.borde = !nuevo.borde; }
    else if ('nAddpizza' in d) {
        if (!nuevo.sabores.length) return;
        nuevo.pizzas.push({ tamano: nuevo.tamano, sabores: nuevo.sabores.slice(), borde: nuevo.borde, precio: nuevoPrecio(nuevo.tamano, nuevo.sabores, nuevo.borde) });
        nuevo.sabores = []; nuevo.borde = false;
    }
    else if (d.nDelpizza !== undefined) { nuevo.pizzas.splice(Number(d.nDelpizza), 1); }
    else if (d.nExtra) { nuevo.extras[d.nExtra] = Math.max(0, (nuevo.extras[d.nExtra] || 0) + Number(d.delta)); }
    else return;
    renderNuevo();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('modal-nuevo').classList.add('hidden'); $('modal-apariencia').classList.add('hidden'); } });

// ===== Enviar solicitud al TPV (propuesta SIN precios; el TPV recalcula y valida) =====
async function enviarSolicitud() {
    const n = nuevo;
    if (!panelAbierto || !usuarioUid || n.guardando) return;
    nuevoMsg('nuevo-ok', ''); nuevoMsg('nuevo-error', '');
    const enAgregar = !!n.agregarA;
    if (!navigator.onLine) { nuevoMsg('nuevo-error', '📴 Sin conexión. No se puede enviar la solicitud: no se guarda ni se reenvía sin internet.'); return; }
    if (n.sabores.length) { nuevoMsg('nuevo-error', 'Tenés sabores elegidos sin agregar. Tocá "＋ Agregar pizza" o desmarcalos.'); return; }
    const extras = MENU.extras.filter(x => (n.extras[x[0]] || 0) > 0).map(x => ({ item: x[1], cantidad: n.extras[x[0]] }));
    if (!n.pizzas.length && !extras.length) { nuevoMsg('nuevo-error', 'Agregá al menos una pizza o un extra.'); return; }
    if (!mesasListas) { nuevoMsg('nuevo-error', 'Todavía se están cargando las mesas. Esperá un segundo.'); return; }
    if (!mesas.length) { nuevoMsg('nuevo-error', 'No hay mesas configuradas. Cargalas en el TPV (Configuración → 🪑 Mesas).'); return; }
    if (!n.mesa || !mesas.includes(Number(n.mesa))) { nuevoMsg('nuevo-error', 'Elegí la mesa del pedido.'); return; }
    n.mesa = Number(n.mesa);

    const nombre = enAgregar
        ? String(n.agregarNombre || ('Mesa ' + n.mesa))
        : ($('nuevo-nombre').value.trim() || ('Mesa ' + n.mesa));
    const notas = enAgregar ? '' : $('nuevo-notas').value.trim();
    const items = itemsSinPrecios(n);

    n.guardando = true;
    $('nuevo-guardar').disabled = true;
    $('nuevo-guardar').textContent = 'Enviando...';
    try {
        const u = auth.currentUser;
        await addDoc(collection(db, 'solicitudes_mesa'), {
            local: 'mi-barrio',
            estado: 'pendiente',
            tipo: 'local',
            mesa: n.mesa,
            operacion: enAgregar ? 'agregar' : 'crear',
            pedidoId: enAgregar ? n.agregarA : null,
            pizzas: items.pizzas,
            extras: items.extras,
            cliente: { nombre: String(nombre || ('Mesa ' + n.mesa)) },
            notas: String(notas || ''),
            solicitadoPor: u ? u.uid : '',
            solicitadoEmail: u ? (u.email || '') : '',
            creado: serverTimestamp()
        });
        nuevoLimpiar();
        renderNuevo();
        $('modal-nuevo').classList.add('hidden');
        mostrarToast('⏳ Mesa ' + n.mesa + ': solicitud enviada. El TPV del local la valida y recién ahí aparece el pedido.');
    } catch (e) {
        console.error('[Camarero] Error al enviar solicitud de mesa:', { code: e.code, message: e.message });
        nuevoMsg('nuevo-error', e.code === 'permission-denied'
            ? 'Firebase rechazó la solicitud (permission-denied). Revisá que tu usuario sea camarero activo y que el TPV tenga publicadas las reglas vigentes.'
            : 'No se pudo enviar (' + (e.code || 'error') + '): ' + (e.message || 'sin mensaje'));
    } finally {
        n.guardando = false;
        $('nuevo-guardar').disabled = false;
        renderNuevoTotal();
    }
}

// ===== Conexión: sin internet no se puede operar (no hay reenvío automático) =====
function actualizarConexion() {
    const offline = !navigator.onLine;
    $('aviso-offline').classList.toggle('hidden', !offline);
    $('btn-nuevo').disabled = offline;
}
window.addEventListener('online', actualizarConexion);
window.addEventListener('offline', actualizarConexion);
actualizarConexion();

// ===== PWA: service worker (alcance /mi-barrio-camarero/) =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[Camarero] SW:', e));
    });
}
