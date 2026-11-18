/* ==========================================================================
   MI BARRIO — Cuentas por mesa · adaptador Firestore (Etapa 1)
   --------------------------------------------------------------------------
   Envuelve el núcleo puro (core.js) en una transacción de Firestore.
   Todas las lecturas se hacen antes de las escrituras, como exige
   runTransaction. Firestore reintenta solo si otro dispositivo modifica
   cuentas_mesa/{mesa} al mismo tiempo.

   Uso previsto (Etapa 3, App Camarero):
     import { crearOAmpliarCuenta } from '../cuentas-mesa/firebase.js';
     await crearOAmpliarCuenta(db, {
       mesa: 5,
       items: { pizzas: [{ tamano: 'grande', sabores: ['Muzza'], borde: false }],
                extras: [{ id: 'coca-15l', cantidad: 2 }] },
       actor: { uid: user.uid, email: user.email, nombre: perfil.nombre },
       operacionId: generarOperacionId(),
       pedidoIdEsperado: cuentaActual && cuentaActual.pedidoId
     });
   ========================================================================== */

import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import { ErrorCuenta, ejecutarOperacionCuenta } from './core.js';

/**
 * Crea o amplía la cuenta de una mesa de forma atómica.
 *
 * @param {import('firebase/firestore').Firestore} db
 * @param {object} opciones
 * @param {number|string} opciones.mesa
 * @param {{pizzas?: Array, extras?: Array}} opciones.items  productos sin precios
 * @param {{uid: string, email?: string, nombre?: string}} opciones.actor
 * @param {string} opciones.operacionId
 * @param {string} [opciones.pedidoIdEsperado] si se está ampliando una cuenta concreta
 * @returns {Promise<object>} resultado de ejecutarOperacionCuenta
 */
export async function crearOAmpliarCuenta(db, {
  mesa,
  items,
  actor,
  operacionId,
  pedidoIdEsperado = null
}) {
  return runTransaction(db, async (tx) => {
    const adaptador = {
      leer: async (coleccion, id) => {
        const snap = await tx.get(doc(db, coleccion, id));
        return snap.exists()
          ? { existe: true, datos: snap.data() }
          : { existe: false, datos: null };
      },
      nuevoId: (coleccion) => doc(collection(db, coleccion)).id,
      guardar: (coleccion, id, datos) => tx.set(doc(db, coleccion, id), datos),
      actualizar: (coleccion, id, datos) => tx.set(doc(db, coleccion, id), datos, { merge: true })
    };

    return ejecutarOperacionCuenta(adaptador, {
      mesa,
      payload: items,
      actor,
      operacionId,
      pedidoIdEsperado,
      marcaTiempo: () => serverTimestamp()
    });
  });
}

/**
 * Lee una solicitud de mesa (solicitudes_mesa/{operacionId}).
 */
export async function leerSolicitud(db, operacionId) {
  const snap = await getDoc(doc(db, 'solicitudes_mesa', operacionId));
  if (!snap.exists()) {
    throw new Error('Solicitud no encontrada: ' + operacionId);
  }
  return { id: operacionId, ...snap.data() };
}

/**
 * Procesa una solicitud pendiente: valida contra config/mesas + config/menu
 * y consolida la cuenta de la mesa (crea o amplía) en UNA transacción.
 * El actor de la operación es el camarero que la originó.
 *
 * Si la solicitud ya fue procesada (comanda con ese operacionId existe) o su
 * estado ya no es 'pendiente', devuelve el resultado correspondiente sin escribir.
 */
export async function procesarSolicitud(db, operacionId) {
  const solicitud = await leerSolicitud(db, operacionId);

  if (solicitud.estado === 'confirmada') {
    return { accion: 'ya-confirmada', solicitud };
  }
  if (solicitud.estado === 'rechazada') {
    return { accion: 'ya-rechazada', solicitud };
  }

  const cuentaSnap = await getDoc(doc(db, 'cuentas_mesa', String(solicitud.mesa)));
  const pedidoIdEsperado = cuentaSnap.exists ? (String(cuentaSnap.data().pedidoId) || null) : null;

  const resultado = await crearOAmpliarCuenta(db, {
    mesa: solicitud.mesa,
    items: solicitud.items,
    actor: {
      uid: solicitud.actorUid,
      email: solicitud.actorEmail || '',
      nombre: solicitud.actorNombre || ''
    },
    operacionId,
    pedidoIdEsperado
  });

  await updateDoc(doc(db, 'solicitudes_mesa', operacionId), {
    estado: 'confirmada',
    procesadaEn: serverTimestamp()
  });

  return { ...resultado, solicitud };
}

/**
 * Rechaza una solicitud (producto inválido, mesa ocupada, etc.). El pedido
 * NO se crea: solo cambia el estado de la solicitud.
 */
export async function rechazarSolicitud(db, operacionId, motivo) {
  const solicitud = await leerSolicitud(db, operacionId);
  if (solicitud.estado === 'confirmada' || solicitud.estado === 'rechazada') {
    return { accion: 'ya-' + solicitud.estado, solicitud };
  }
  await updateDoc(doc(db, 'solicitudes_mesa', operacionId), {
    estado: 'rechazada',
    motivo,
    procesadaEn: serverTimestamp()
  });
  return { accion: 'rechazada', solicitud };
}
