/* ==========================================================================
   MI BARRIO — Config Listener
   Escucha cambios en tiempo real en config/local, config/menu, config/mesas
   y notifica a la app via CustomEvents
   ========================================================================== */

import { db } from './firebase.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Estado interno
let localConfig = null;
let menuConfig = null;
let mesasConfig = null;
let unsubLocal = null;
let unsubMenu = null;
let unsubMesas = null;

// Caché local del menú: permite pintar los tamaños al instante y refrescar con Firestore.
const MENU_CACHE_KEY = 'mb_menu_v1';

function leerMenuCache() {
  try {
    const raw = localStorage.getItem(MENU_CACHE_KEY);
    if (!raw) return null;
    const menu = JSON.parse(raw);
    return (menu && menu.tamanos) ? menu : null;
  } catch (e) {
    return null;
  }
}

function guardarMenuCache(menu) {
  try {
    if (menu && menu.tamanos) localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(menu));
    else localStorage.removeItem(MENU_CACHE_KEY);
  } catch (e) { /* sin caché disponible */ }
}

// Arrancar con el último menú guardado (si existe)
menuConfig = leerMenuCache();

// Normalizar config/local (igual que index.html y panel_nuevo.html)
function normLocal(d) {
  d = d || {};
  return {
    auto: !!d.auto,
    manual: (d.manual === 'abierto' || d.manual === 'cerrado') ? d.manual : null,
    manualHasta: Number(d.manualHasta) || null,
    horarios: d.horarios || {},
    mensaje: d.mensaje || '',
    agotados: Array.isArray(d.agotados) ? d.agotados.map(String) : [],
    tema: ['clasico', 'bonito', 'noche'].indexOf(d.tema) >= 0 ? d.tema : 'clasico',
    delivery: (d.delivery && Array.isArray(d.delivery.tramos))
      ? d.delivery.tramos.map(t => ({ max: Number(t.max) || 0, costo: Math.max(0, Number(t.costo) || 0) })).filter(t => t.max > 0).sort((a, b) => a.max - b.max)
      : []
  };
}

// Estado del local (abierto/cerrado) - misma lógica que index.html
const TZ_LOCAL = 'America/Asuncion';
function pyAhora(ms) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ_LOCAL, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t) => (p.find(x => x.type === t) || {}).value;
  return { dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), min: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}
function aMin(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function abiertoHorario(h, dia, min) {
  for (const t of ((h && h[dia]) || [])) {
    const a = aMin(t.a), c = aMin(t.c);
    if (a === null || c === null || a === c) continue;
    if (a < c ? (min >= a && min < c) : (min >= a)) return true;
  }
  for (const t of ((h && h[(dia + 6) % 7]) || [])) {
    const a = aMin(t.a), c = aMin(t.c);
    if (a === null || c === null || a === c) continue;
    if (a > c && min < c) return true;
  }
  return false;
}
function hayHorarios(h) {
  return !!h && Object.values(h).some(arr => (arr || []).some(t => aMin(t.a) !== null && aMin(t.c) !== null && aMin(t.a) !== aMin(t.c)));
}

function estadoLocal(cfg, ahora) {
  cfg = cfg || {};
  if (cfg.manual && (!cfg.manualHasta || ahora < cfg.manualHasta)) return { abierto: cfg.manual === 'abierto', modo: 'manual', hasta: cfg.manualHasta || null };
  if (cfg.auto && hayHorarios(cfg.horarios)) { const b = pyAhora(ahora); return { abierto: abiertoHorario(cfg.horarios, b.dia, b.min), modo: 'auto', hasta: null }; }
  return { abierto: true, modo: 'libre', hasta: null };
}

// Disparar evento personalizado
function emit(eventName, detail) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

// Iniciar listeners
export function iniciarConfigListeners() {
  // config/local
  unsubLocal = onSnapshot(doc(db, 'config', 'local'), (snap) => {
    localConfig = normLocal(snap.exists() ? snap.data() : {});
    // Aplicar tema
    if (window.aplicarTemaCliente) window.aplicarTemaCliente(localConfig.tema);
    // Emitir eventos
    emit('config:local', localConfig);
    emit('config:local:agotados', localConfig.agotados);
    emit('config:local:delivery', localConfig.delivery);
    emit('config:local:estado', estadoLocal(localConfig, Date.now()));
    emit('config:local:tema', localConfig.tema);
    // Refrescar estado cada 20s (para cambios de horario)
  }, (err) => {
    console.error('[Config] Error escuchando local:', err);
    emit('config:error', { source: 'local', error: err });
  });

  // config/menu
  unsubMenu = onSnapshot(doc(db, 'config', 'menu'), (snap) => {
    // Solo guardar/borrar la caché con datos del servidor (evita que un snapshot
    // vacío de la caché local de Firestore borre el menú cuando no hay conexión).
    const delServidor = !snap.metadata.fromCache;
    if (snap.exists()) {
      menuConfig = snap.data();
      if (delServidor) guardarMenuCache(menuConfig);
    } else if (delServidor) {
      menuConfig = null;
      guardarMenuCache(null);
    }
    emit('config:menu', menuConfig);
  }, (err) => {
    console.error('[Config] Error escuchando menu:', err);
    emit('config:error', { source: 'menu', error: err });
  });

  // config/mesas — solo hace falta cuando el cliente entró por un QR (?mesa=N).
  // Si las reglas no permiten leer 'mesas', así evitamos un error de permisos en cada visita normal.
  let mesaParam = 0;
  try { mesaParam = parseInt(new URLSearchParams(location.search).get('mesa'), 10) || 0; } catch (e) {}
  if (mesaParam > 0) {
    unsubMesas = onSnapshot(doc(db, 'config', 'mesas'), (snap) => {
      mesasConfig = snap.exists() ? (snap.data().mesas || []) : [];
      emit('config:mesas', mesasConfig);
    }, (err) => {
      console.warn('[Config] No se pudo leer config/mesas (modo mesa sigue activo por URL):', err.message || err);
      emit('config:error', { source: 'mesas', error: err });
    });
  }

  // Timer para refrescar estado del local (horarios)
  setInterval(() => {
    if (localConfig) {
      emit('config:local:estado', estadoLocal(localConfig, Date.now()));
    }
  }, 20000);

  console.log('[Config] Listeners iniciados');
}

// Detener listeners (cleanup)
export function detenerConfigListeners() {
  if (unsubLocal) { unsubLocal(); unsubLocal = null; }
  if (unsubMenu) { unsubMenu(); unsubMenu = null; }
  if (unsubMesas) { unsubMesas(); unsubMesas = null; }
  console.log('[Config] Listeners detenidos');
}

// Getters
export function getLocalConfig() { return localConfig; }
export function getMenuConfig() { return menuConfig; }
export function getMesasConfig() { return mesasConfig; }
export function getEstadoLocal() { return localConfig ? estadoLocal(localConfig, Date.now()) : { abierto: true, modo: 'libre', hasta: null }; }

// Helpers de delivery (tramos)
export function getTramosDelivery() {
  const local = getLocalConfig();
  const def = [
    { max: 1.9, costo: 5000 },
    { max: 2.9, costo: 7000 },
    { max: 3.9, costo: 9000 },
    { max: 4.9, costo: 12000 },
    { max: 6.5, costo: 15000 }
  ];
  return (local && local.delivery && local.delivery.length) ? local.delivery : def;
}

export function costoDeliveryPorKm(km) {
  if (!(km >= 0)) return null;
  for (const t of getTramosDelivery()) if (km <= t.max + 1e-9) return t.costo;
  return null;
}

// Exportar estadoLocal para uso externo
export { estadoLocal, pyAhora, hayHorarios };