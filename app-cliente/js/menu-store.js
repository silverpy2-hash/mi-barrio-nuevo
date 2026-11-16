/* ==========================================================================
   MI BARRIO — Menu Store
   Estado reactivo del menú (tamaños, sabores, extras) basado en config/menu
   ========================================================================== */

import { getMenuConfig, getLocalConfig } from './config-listener.js';

// Estado interno
let tamanos = {};
let sabores = { gourmet: [], especial: [], clasico: [] };
let extras = [];
let limiteSaboresPorTamano = {};
let preciosPorTamanoYCategoria = {};
let preciosExtras = {};
let nombresExtras = {};
let preciosBorde = {};
let nombresTamanos = {};
let nombresCortosTamanos = {};

// Suscriptores para reactividad
const suscriptores = new Set();

function notificar() {
  suscriptores.forEach(fn => fn(getState()));
}

export function suscribir(fn) {
  suscriptores.add(fn);
  fn(getState()); // Emitir el estado actual (menú cacheado o ya procesado)
  return () => suscriptores.delete(fn);
}

// Procesar config/menu cuando llega
export function procesarMenuConfig(menu) {
  if (!menu || !menu.tamanos) return;

  // Tamaños
  const nuevosTamanos = {};
  Object.keys(menu.tamanos).forEach(k => {
    const t = menu.tamanos[k] || {};
    const p = t.precios || {};
    nuevosTamanos[k] = {
      clasico: Math.max(0, Number(p.clasico) || 0),
      especial: Math.max(0, Number(p.especial) || 0),
      gourmet: Math.max(0, Number(p.gourmet) || 0),
      limiteSabores: Math.max(1, Number(t.limite) || 1),
      nombre: String(t.nombre || k),
      corto: String(t.corto || k),
      borde: Math.max(0, Number(t.borde) || 0)
    };
  });
  tamanos = nuevosTamanos;

  // Derivados
  limiteSaboresPorTamano = {};
  preciosPorTamanoYCategoria = {};
  preciosBorde = {};
  nombresTamanos = {};
  nombresCortosTamanos = {};
  Object.keys(tamanos).forEach(k => {
    const t = tamanos[k];
    limiteSaboresPorTamano[k] = t.limiteSabores;
    preciosPorTamanoYCategoria[k] = { clasico: t.clasico, especial: t.especial, gourmet: t.gourmet };
    preciosBorde[k] = t.borde;
    nombresTamanos[k] = t.nombre;
    nombresCortosTamanos[k] = t.corto;
  });

  // Sabores
  const s = menu.sabores || {};
  sabores = {
    gourmet: Array.isArray(s.gourmet) ? s.gourmet.map(String) : [],
    especial: Array.isArray(s.especial) ? s.especial.map(String) : [],
    clasico: Array.isArray(s.clasico) ? s.clasico.map(String) : []
  };

  // Extras
  const extrasArray = Array.isArray(menu.extras) ? menu.extras : [];
  extras = extrasArray.map(x => ({
    id: String(x.id || ('x' + Math.random().toString(36).slice(2))),
    nombre: String(x.nombre || ''),
    precio: Math.max(0, Number(x.precio) || 0)
  })).filter(x => x.nombre);

  preciosExtras = {};
  nombresExtras = {};
  extras.forEach(x => {
    preciosExtras[x.id] = x.precio;
    nombresExtras[x.id] = x.nombre;
  });

  // Aplicar agotados del local
  aplicarAgotados(getLocalConfig()?.agotados || []);

  notificar();
  console.log('[MenuStore] Menú procesado:', { tamanos: Object.keys(tamanos), sabores: Object.keys(sabores).reduce((a,k)=>a+sabores[k].length,0), extras: extras.length });
}

// Aplicar sabores agotados (del config/local)
function aplicarAgotados(lista) {
  const agotadosSet = new Set(lista || []);
  // Marcar en cada sabor (normalizando si ya vienen como objeto)
  ['gourmet', 'especial', 'clasico'].forEach(cat => {
    sabores[cat] = sabores[cat].map(s => {
      const nombre = (s && typeof s === 'object') ? s.nombre : s;
      return { nombre, agotado: agotadosSet.has(nombre) };
    });
  });
  notificar();
}

// Escuchar cambios en agotados
window.addEventListener('config:local:agotados', (e) => {
  aplicarAgotados(e.detail);
});

// Escuchar el menú publicado desde config-listener (config/menu)
window.addEventListener('config:menu', (e) => {
  procesarMenuConfig(e.detail);
});

// Si config/menu ya llegó antes de cargar este módulo, procesarlo
const menuInicial = getMenuConfig();
if (menuInicial) procesarMenuConfig(menuInicial);

// Getters
function getState() {
  return {
    tamanos,
    sabores,
    extras,
    limiteSaboresPorTamano,
    preciosPorTamanoYCategoria,
    preciosExtras,
    nombresExtras,
    preciosBorde,
    nombresTamanos,
    nombresCortosTamanos
  };
}

export function getTamanos() { return tamanos; }
export function getSabores() { return sabores; }
export function getExtras() { return extras; }
export function getLimiteSabores(tamano) { return limiteSaboresPorTamano[tamano] || 1; }
export function getPrecio(tamano, categoria) { return preciosPorTamanoYCategoria[tamano]?.[categoria] || 0; }
export function getPrecioBorde(tamano) { return preciosBorde[tamano] || 0; }
export function getNombreTamano(tamano) { return nombresTamanos[tamano] || tamano; }
export function getNombreCortoTamano(tamano) { return nombresCortosTamanos[tamano] || tamano; }
export function getPrecioExtra(id) { return preciosExtras[id] || 0; }
export function getNombreExtra(id) { return nombresExtras[id] || id; }

// Calcular categoría de una lista de sabores (gourmet > especial > clasico)
export function calcularCategoriaSabores(listaSabores) {
  if (!listaSabores?.length) return 'clasico';
  const setGourmet = new Set(sabores.gourmet.map(s => typeof s === 'object' ? s.nombre : s));
  const setEspecial = new Set(sabores.especial.map(s => typeof s === 'object' ? s.nombre : s));
  for (const s of listaSabores) if (setGourmet.has(s)) return 'gourmet';
  for (const s of listaSabores) if (setEspecial.has(s)) return 'especial';
  return 'clasico';
}

// Calcular precio base de una pizza (sin borde)
export function calcularPrecioBase(tamano, listaSabores) {
  const cat = calcularCategoriaSabores(listaSabores);
  return getPrecio(tamano, cat);
}

// Calcular precio total de una pizza (con borde opcional)
export function calcularPrecioPizza(tamano, listaSabores, conBorde) {
  return calcularPrecioBase(tamano, listaSabores) + (conBorde ? getPrecioBorde(tamano) : 0);
}

// Alias usado por cart.js
export const getPrecioPizza = calcularPrecioPizza;

// Verificar si un sabor está agotado
export function estaAgotado(sabor) {
  const cat = ['gourmet', 'especial', 'clasico'].find(c => sabores[c].some(s => (typeof s === 'object' ? s.nombre : s) === sabor));
  if (!cat) return false;
  const found = sabores[cat].find(s => (typeof s === 'object' ? s.nombre : s) === sabor);
  return typeof found === 'object' ? found.agotado : false;
}

// Obtener sabores planos (solo nombres) para una categoría
export function getSaboresPlanos(categoria) {
  return (sabores[categoria] || []).map(s => typeof s === 'object' ? s.nombre : s);
}

// Obtener todos los sabores planos con su categoría
export function getTodosSaboresConCategoria() {
  const result = [];
  ['gourmet', 'especial', 'clasico'].forEach(cat => {
    getSaboresPlanos(cat).forEach(nombre => result.push({ nombre, categoria: cat }));
  });
  return result;
}