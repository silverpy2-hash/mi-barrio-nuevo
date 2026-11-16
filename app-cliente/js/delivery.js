/* ==========================================================================
   MI BARRIO — Delivery Calculator
   Cálculo de costo de delivery usando OSRM (rutas reales) + fallback haversine
   ========================================================================== */

import { getTramosDelivery, costoDeliveryPorKm } from './config-listener.js';

const LOCAL_LAT = -25.4677519;
const LOCAL_LNG = -56.0124691;

let deliveryKm = null;
let deliveryCosto = 0;
let deliveryFuera = false;
let deliveryTimer = null;
let deliverySeq = 0;

// Haversine (línea recta)
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Aplicar costo basado en km
function aplicarCosto(km) {
  deliveryKm = km;
  const c = costoDeliveryPorKm(km);
  deliveryCosto = c || 0;
  deliveryFuera = (c === null);
  window.dispatchEvent(new CustomEvent('delivery:calculado', {
    detail: { km: deliveryKm, costo: deliveryCosto, fuera: deliveryFuera }
  }));
}

// Calcular delivery con OSRM (ruta real por calles)
export async function calcularDelivery(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return;

  const seq = ++deliverySeq;

  // Estimación inmediata (haversine × 1.3 factor ruta) para UI responsiva
  const kmEstimado = haversineKm(LOCAL_LAT, LOCAL_LNG, lat, lng) * 1.3;
  aplicarCosto(kmEstimado);

  // Ruta real con OSRM
  let kmReal = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const url = `https://router.project-osrm.org/route/v1/driving/${LOCAL_LNG},${LOCAL_LAT};${lng},${lat}?overview=false`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await resp.json();
    if (data && data.routes && data.routes[0]) {
      kmReal = data.routes[0].distance / 1000;
    }
  } catch (e) {
    // Silencioso: usar estimado
  }

  if (kmReal != null && seq === deliverySeq) {
    aplicarCosto(kmReal);
  }
}

// Estimación inmediata (igual que index.html al confirmar sin cálculo previo)
export function estimarDelivery(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return getDeliveryState();
  const km = haversineKm(LOCAL_LAT, LOCAL_LNG, lat, lng) * 1.3;
  aplicarCosto(km);
  return getDeliveryState();
}

// Programar cálculo con debounce
export function programarCalculo(lat, lng) {
  clearTimeout(deliveryTimer);
  deliveryTimer = setTimeout(() => calcularDelivery(lat, lng), 700);
}

// Getters
export function getDeliveryKm() { return deliveryKm; }
export function getDeliveryCosto() { return deliveryCosto; }
export function getDeliveryFuera() { return deliveryFuera; }
export function getDeliveryState() {
  return { km: deliveryKm, costo: deliveryCosto, fuera: deliveryFuera };
}

// Reset (al cambiar tipo de pedido o limpiar carrito)
export function resetDelivery() {
  deliveryKm = null;
  deliveryCosto = 0;
  deliveryFuera = false;
  clearTimeout(deliveryTimer);
  deliverySeq++;
  window.dispatchEvent(new CustomEvent('delivery:reset'));
}

// Formatear para UI
export function formatearDeliveryInfo() {
  if (deliveryFuera && deliveryKm != null) {
    const tramos = getTramosDelivery();
    const maxKm = tramos.length ? tramos[tramos.length - 1].max : 0;
    return { tipo: 'fuera', texto: `❌ Zona no cubierta (${deliveryKm.toFixed(1)} km). El delivery llega hasta ${maxKm} km.`, clase: 'text-red-600' };
  }
  if (deliveryKm == null) {
    return { tipo: 'calculando', texto: '🛵 Calculando costo de delivery...', clase: 'text-muted' };
  }
  return { tipo: 'ok', texto: `🛵 Delivery: ${deliveryCosto.toLocaleString('es-PY')} Gs (${deliveryKm.toFixed(1)} km)`, clase: 'text-green-700' };
}

// Extraer coordenadas de link Google Maps (copiado de index.html/panel)
export function coordsDeMaps(texto) {
  if (!texto) return null;
  let s = String(texto);
  try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) {}
  let m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s);
  if (!m) m = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (!m) m = /[?&](?:q|ll|query|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (!m) m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Geolocalización del usuario (GPS)
export function obtenerUbicacionActual() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        if (accuracy > 50) { // Precisión razonable
          console.warn('[Delivery] GPS precision baja:', accuracy, 'm');
        }
        resolve({ lat, lng });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

console.log('[Delivery] Inicializado');