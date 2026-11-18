/* ==========================================================================
   MI BARRIO — App Camarero · solicitudes y cuentas
   IMPORTANTE: el camarero NO escribe pedidos, cuentas ni comandas.
   Solo crea solicitudes en estado 'pendiente' en solicitudes_mesa/{id}.
   El TPV administrador valida, recalcula precios y confirma desde Firestore.
   ========================================================================== */

import { db } from './firebase.js';
import { generarOperacionId } from '../../cuentas-mesa/core.js';
import {
  collection, doc, setDoc, onSnapshot, query, where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/**
 * Envía una solicitud de pedido o ampliación. El id de operación se genera
 * una sola vez por envío, así que un doble toque no crea dos solicitudes.
 */
export function enviarSolicitud({ mesa, items, actor, operacionId }) {
  const id = operacionId || generarOperacionId();
  const datos = {
    operacionId: id,
    mesa: Number(mesa),
    origen: 'camarero',
    actorUid: actor.uid,
    actorEmail: String(actor.email || ''),
    actorNombre: String(actor.nombre || ''),
    items: {
      pizzas: (items.pizzas || []).map(z => ({
        tamano: z.tamano,
        sabores: z.sabores,
        borde: !!z.borde
      })),
      extras: (items.extras || []).map(x => ({ id: x.id, cantidad: x.cantidad }))
    },
    estado: 'pendiente',
    creado: serverTimestamp()
  };
  return setDoc(doc(db, 'solicitudes_mesa', id), datos).then(() => id);
}

/** Solicitudes del camarero autenticado, en vivo. */
export function escucharSolicitudes(uid, fn) {
  const q = query(collection(db, 'solicitudes_mesa'), where('actorUid', '==', uid));
  return onSnapshot(q, (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ma = a.creado && a.creado.toMillis ? a.creado.toMillis() : 0;
        const mb = b.creado && b.creado.toMillis ? b.creado.toMillis() : 0;
        return mb - ma;
      });
    fn(lista);
  }, () => fn(null));
}

/**
 * Escucha la cuenta de una mesa. Devuelve { cuenta, pedido, comandas }.
 * No escribe nada: solo refleja lo que el TPV confirmó en Firestore.
 */
export function escucharCuenta(mesa, fn) {
  const resultado = { cuenta: null, pedido: null, comandas: [] };
  let stopPedido = null;
  let stopComandas = null;

  const notificar = () => fn({ ...resultado });

  const stopCuenta = onSnapshot(doc(db, 'cuentas_mesa', String(mesa)), (snap) => {
    if (stopPedido) { stopPedido(); stopPedido = null; }
    if (stopComandas) { stopComandas(); stopComandas = null; }
    resultado.cuenta = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    resultado.pedido = null;
    resultado.comandas = [];
    notificar();

    const pedidoId = resultado.cuenta && resultado.cuenta.pedidoId;
    if (pedidoId) {
      stopPedido = onSnapshot(doc(db, 'pedidos', pedidoId), (s) => {
        resultado.pedido = s.exists() ? { id: s.id, ...s.data() } : null;
        notificar();
      }, () => {});
    }
    stopComandas = onSnapshot(query(collection(db, 'comandas'), where('mesa', '==', Number(mesa))), (s) => {
      resultado.comandas = s.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ma = a.creado && a.creado.toMillis ? a.creado.toMillis() : 0;
          const mb = b.creado && b.creado.toMillis ? b.creado.toMillis() : 0;
          return ma - mb;
        });
      notificar();
    }, () => {});
  }, () => fn(null));

  return () => {
    stopCuenta();
    if (stopPedido) stopPedido();
    if (stopComandas) stopComandas();
  };
}
