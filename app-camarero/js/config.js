/* ==========================================================================
   MI BARRIO — App Camarero · configuración en vivo
   Mesas y menú se leen de config/{mesas,menu}. Se guarda una copia en
   localStorage para poder mostrar el menú sin Internet (pero NUNCA para
   confirmar un pedido: eso siempre lo decide el TPV).
   ========================================================================== */

import { db } from './firebase.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const CACHE = {
  mesas: 'mb-camarero-mesas',
  menu: 'mb-camarero-menu'
};

function leerCache(clave, fallback) {
  try {
    const v = localStorage.getItem(clave);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function escribirCache(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) {}
}

let estado = {
  mesas: leerCache(CACHE.mesas, []),
  menu: leerCache(CACHE.menu, null),
  enLinea: navigator.onLine !== false,
  listo: false
};

const suscriptores = new Set();

function notificar() {
  suscriptores.forEach(fn => { try { fn(estado); } catch (e) {} });
}

export function suscribirConfig(fn) {
  suscriptores.add(fn);
  fn(estado);
  return () => suscriptores.delete(fn);
}

export function configuracion() { return estado; }

export function iniciarConfig() {
  onSnapshot(doc(db, 'config', 'mesas'), (snap) => {
    const lista = snap.exists() && Array.isArray(snap.data().mesas)
      ? snap.data().mesas.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [];
    estado.mesas = [...new Set(lista)].sort((a, b) => a - b);
    escribirCache(CACHE.mesas, estado.mesas);
    notificar();
  }, () => { estado.enLinea = false; notificar(); });

  onSnapshot(doc(db, 'config', 'menu'), (snap) => {
    if (snap.exists()) {
      estado.menu = snap.data();
      escribirCache(CACHE.menu, estado.menu);
    }
    estado.listo = true;
    notificar();
  }, () => { estado.enLinea = false; notificar(); });

  const actualizarRed = () => { estado.enLinea = navigator.onLine !== false; notificar(); };
  window.addEventListener('online', actualizarRed);
  window.addEventListener('offline', actualizarRed);
}
