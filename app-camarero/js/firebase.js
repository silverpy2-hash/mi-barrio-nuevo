/* ==========================================================================
   MI BARRIO — App Camarero · Firebase
   Auth + Firestore. Mismo proyecto y versión de SDK que el TPV y la App Cliente.
   ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBczdHiqe4fO6XThYRQky-WBlwgdhWDYCI",
  authDomain: "mi-barrio-pedidos.firebaseapp.com",
  projectId: "mi-barrio-pedidos",
  storageBucket: "mi-barrio-pedidos.firebasestorage.app",
  messagingSenderId: "495947210483",
  appId: "1:495947210483:web:949ae24ccf15bd025a6186"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Sesión persistente: el camarero no debe iniciar sesión a cada rato en el celular.
setPersistence(auth, browserLocalPersistence).catch(() => {});

export { onAuthStateChanged, signInWithEmailAndPassword, signOut };

/** Perfil de usuario. La autorización sale de usuarios/{uid}, nunca del email. */
export async function leerPerfil(uid) {
  const snap = await getDoc(doc(db, 'usuarios', uid));
  return snap.exists() ? snap.data() : null;
}

export function esCamareroActivo(perfil) {
  return !!perfil && perfil.rol === 'camarero' && perfil.activo === true;
}
