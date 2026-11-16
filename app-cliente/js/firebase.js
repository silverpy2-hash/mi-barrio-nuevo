/* ==========================================================================
   MI BARRIO — Firebase Initialization
   Configuración compartida para toda la app cliente
   ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, serverTimestamp, collection } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Configuración del proyecto Firebase (misma que index.html y panel_nuevo.html)
const firebaseConfig = {
  apiKey: "AIzaSyBczdHiqe4fO6XThYRQky-WBlwgdhWDYCI",
  authDomain: "mi-barrio-pedidos.firebaseapp.com",
  projectId: "mi-barrio-pedidos",
  storageBucket: "mi-barrio-pedidos.firebasestorage.app",
  messagingSenderId: "495947210483",
  appId: "1:495947210483:web:949ae24ccf15bd025a6186"
};

// Inicializar Firebase
let app;
let db;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  console.log('[Firebase] Inicializado correctamente');
} catch (err) {
  console.error('[Firebase] Error al inicializar:', err);
}

// Exportar instancias
export { app, db };

// Helper para serverTimestamp
export { serverTimestamp };

// Helpers para colecciones (getters para evitar uso antes de init)
export function getPedidosCollection() { return collection(db, 'pedidos'); }
export function getConfigCollection() { return collection(db, 'config'); }

// Función de utilidad: normalizar celular Paraguay (copiada de index.html)
export function normalizarCelularPY(valor) {
  let d = String(valor || '').replace(/\D/g, '');
  if (d.startsWith('595')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^9\d{8}$/.test(d)) return null;
  return '595' + d;
}

export function formatearCelularPY(n) {
  return '+595 ' + n.slice(3, 6) + ' ' + n.slice(6, 9) + ' ' + n.slice(9, 12);
}

// Función de utilidad: escapar HTML
const HTML_ENTIDADES = {
  '&': '\u0026amp;',
  '<': '\u0026lt;',
  '>': '\u0026gt;',
  '"': '\u0026quot;',
  "'": '\u0026#39;'
};
export function escaparHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ENTIDADES[c]);
}

// Formatear moneda Paraguay
export function formatearGs(n) {
  return Number(n || 0).toLocaleString('es-PY') + ' Gs';
}