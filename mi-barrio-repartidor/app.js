// Mi Barrio · Repartidor — aplicación solo lectura.
// Lee pedidos con estado "en_camino" en tiempo real. NO crea, NO cobra,
// NO cancela ni modifica nada (las reglas de Firestore tampoco lo permiten).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, query, where, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { renderListaHTML } from "./logica.js";

const APP_VERSION = '2026-11-17 #1 · repartidor PWA';

// Actualizar junto con panel_nuevo.html si el proyecto de Firebase cambia.
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
const vistaLogin = $('vista-login');
const vistaLista = $('vista-lista');
const listaEl = $('lista');
const vacioEl = $('vacio');
const avisoError = $('aviso-error');
const btnSalir = $('btn-salir');
const formLogin = $('form-login');

console.info('[Repartidor] versión:', APP_VERSION);

// ===== Login =====
let cancelarEscucha = null;

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    const btn = $('login-entrar');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
        await signInWithEmailAndPassword(auth, $('login-email').value.trim(), $('login-clave').value);
    } catch (ex) {
        console.error('[Repartidor] login:', ex && ex.code);
        err.textContent = 'No se pudo entrar. Revisá el correo y la contraseña.';
        err.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
    }
});

btnSalir.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.info('[Repartidor] sesión iniciada:', user.email);
        vistaLogin.classList.add('hidden');
        vistaLista.classList.remove('hidden');
        btnSalir.classList.remove('hidden');
        escucharPedidos();
    } else {
        vistaLogin.classList.remove('hidden');
        vistaLista.classList.add('hidden');
        btnSalir.classList.add('hidden');
        listaEl.innerHTML = '';
        vacioEl.classList.add('hidden');
        avisoError.classList.add('hidden');
        if (cancelarEscucha) { cancelarEscucha(); cancelarEscucha = null; }
    }
});

// ===== Pedidos en camino en tiempo real =====
// Solo se escuchan los documentos con estado en_camino. El TPV cambia el
// estado desde otro dispositivo; al cambiar de estado el pedido desaparece
// automáticamente de esta lista (o aparece si pasa a en_camino).
function escucharPedidos() {
    if (cancelarEscucha) return; // ya estamos escuchando
    const q = query(
        collection(db, 'pedidos'),
        where('estado', '==', 'en_camino'),
        limit(50)
    );
    cancelarEscucha = onSnapshot(q, (snap) => {
        avisoError.classList.add('hidden');
        const pedidos = snap.docs
            .map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
            .filter(p => p.estado === 'en_camino');
        pintarPedidos(pedidos);
    }, (error) => {
        console.error('[Repartidor] escucha:', error);
        avisoError.textContent = error && error.code === 'permission-denied'
            ? 'Este equipo no tiene permiso para ver los pedidos. Entrá con la cuenta de repartidor (el correo debe contener “delivery”).'
            : 'No se pudieron cargar los pedidos: ' + ((error && error.message) || 'error desconocido');
        avisoError.classList.remove('hidden');
        // Si la escucha muere, que pueda reintentar al volver a abrir el detalle de la cuenta.
        cancelarEscucha = null;
    });
}

function pintarPedidos(pedidos) {
    const { html, vacio } = renderListaHTML(pedidos);
    vacioEl.classList.toggle('hidden', !vacio);
    listaEl.classList.toggle('hidden', vacio);
    listaEl.innerHTML = vacio ? '' : html;
}

// ===== Detalle desplegable (delegación: funciona en cada render) =====
listaEl.addEventListener('click', (event) => {
    const b = event.target.closest('[data-accion="detalle"]');
    if (!b) return;
    const panel = b.nextElementSibling;
    if (!panel || !panel.id || panel.id !== b.getAttribute('aria-controls')) return;
    const abrir = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !abrir);
    b.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    b.querySelector('span:first-child').textContent = abrir ? 'Ocultar detalle' : 'Ver detalle';
});

// ===== PWA: service worker =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[Repartidor] SW:', e));
    });
}
