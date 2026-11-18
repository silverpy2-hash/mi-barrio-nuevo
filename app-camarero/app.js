/* ==========================================================================
   MI BARRIO — App Camarero
   Flujo: camarero arma un pedido -> escribe SOLICITUD en Firestore ->
   el TPV administrador valida, recalcula precios y confirma ->
   la app refleja el cambio en vivo (nunca antes).

   El camarero NO escribe pedidos, cuentas ni comandas, y NO puede cobrar.
   ========================================================================== */

import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  leerPerfil, esCamareroActivo
} from './js/firebase.js';
import { suscribirConfig, configuracion, iniciarConfig } from './js/config.js';
import { enviarSolicitud, escucharSolicitudes, escucharCuenta } from './js/cuentas.js';
import { precioPizza, generarOperacionId } from '../cuentas-mesa/core.js';
import {
  collection, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gs = (n) => Number(n || 0).toLocaleString('es-PY') + ' Gs';
const hora = (t) => t && t.toDate ? t.toDate().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }) : '';

let usuario = null;
let perfil = null;
let cuentas = {};
let solicitudes = [];
let mesaActual = null;
let stopCuenta = null;
let stopSolicitudes = null;
let cuentaActual = { cuenta: null, pedido: null, comandas: [] };
let enviando = false;
let operacionEnCurso = null;
let vista = 'login';

const pedido = {
  mesa: null,
  tamano: null,
  sabores: [],
  borde: false,
  pizzas: [],
  extras: {},
  notas: ''
};

/* --------------------------------------------------------------------------
   Navegación y sesión
   -------------------------------------------------------------------------- */

function mostrarVista(nombre) {
  vista = nombre;
  ['login', 'mesas', 'pedido', 'cuenta'].forEach(v => $('vista-' + v).classList.toggle('hidden', v !== nombre));
  window.scrollTo(0, 0);
}
function toast(texto) {
  const t = $('toast');
  t.textContent = texto;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), 3500);
}
function errorEn(id, texto) {
  const e = $(id);
  e.textContent = texto || '';
  e.classList.toggle('hidden', !texto);
}

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEn('login-error', '');
  const btn = $('login-enviar');
  btn.disabled = true; btn.textContent = 'Ingresando…';
  try {
    await signInWithEmailAndPassword(auth, $('login-email').value.trim(), $('login-pass').value);
  } catch (err) {
    errorEn('login-error', err.code === 'invalid-credential'
      ? 'Correo o contraseña incorrectos.'
      : 'No se pudo ingresar: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Ingresar';
  }
});

$('btn-salir').addEventListener('click', async () => {
  if (stopCuenta) { stopCuenta(); stopCuenta = null; }
  await signOut(auth);
});

document.querySelectorAll('[data-volver]').forEach(b => {
  b.addEventListener('click', () => {
    if (stopCuenta) { stopCuenta(); stopCuenta = null; }
    mostrarVista(b.dataset.volver);
    if (b.dataset.volver === 'mesas') pintarMesas();
  });
});

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    usuario = null; perfil = null;
    if (stopCuenta) { stopCuenta(); stopCuenta = null; }
    if (stopSolicitudes) { stopSolicitudes(); stopSolicitudes = null; }
    solicitudes = [];
    $('login-pass').value = '';
    mostrarVista('login');
    return;
  }
  try {
    const p = await leerPerfil(u.uid);
    if (!esCamareroActivo(p)) {
      await signOut(auth);
      errorEn('login-error', 'Ese usuario no tiene rol de camarero activo. Pedile al administrador que lo habilite en usuarios/{uid}.');
      return;
    }
    usuario = { uid: u.uid, email: u.email || '' };
    perfil = p;
    if (stopSolicitudes) stopSolicitudes();
    stopSolicitudes = escucharSolicitudes(usuario.uid, (lista) => {
      solicitudes = lista || [];
      pintarMesas();
      if (vista === 'cuenta') pintarCuenta();
      if (vista === 'pedido') pintarEstadoSolicitud();
    });
    mostrarVista('mesas');
    pintarMesas();
  } catch (e) {
    errorEn('login-error', 'No se pudo validar el rol: ' + e.message);
  }
});

/* --------------------------------------------------------------------------
   Configuración en vivo + cuentas (lectura)
   -------------------------------------------------------------------------- */

iniciarConfig();

suscribirConfig((cfg) => {
  $('aviso-red').classList.toggle('hidden', cfg.enLinea);
  if (!cfg.menu && cfg.enLinea) {
    $('mesas-resumen').textContent = 'Cargando menú desde Firestore…';
  }
  if (vista === 'pedido') renderPedido();
  pintarMesas();
});

onSnapshot(collection(db, 'cuentas_mesa'), (snap) => {
  cuentas = {};
  snap.forEach(d => { cuentas[String(d.data().mesa || d.id)] = { id: d.id, ...d.data() }; });
  pintarMesas();
  if (vista === 'cuenta') pintarCuenta();
}, () => {});

function estadoMesa(m) {
  const c = cuentas[String(m)];
  if (!c || !c.pedidoId || c.estado === 'cerrada') return { estado: 'libre', total: 0, cuenta: c || null };
  const total = Number(c.total || 0);
  const estado = c.estado === 'pendiente_cobro' ? 'pendiente' : 'ocupada';
  return { estado, total, cuenta: c };
}

function pintarMesas() {
  if (vista !== 'mesas') return;
  const cfg = configuracion();
  const lista = cfg.mesas || [];
  const libres = lista.filter(m => estadoMesa(m).estado === 'libre').length;
  const porCobrar = lista.filter(m => estadoMesa(m).estado === 'pendiente').length;
  $('mesas-resumen').textContent = lista.length
    ? lista.length + ' mesas · ' + libres + ' libres · ' + porCobrar + ' por cobrar'
    : 'No hay mesas configuradas en el TPV';

  $('mesas-grid').innerHTML = lista.length ? lista.map(m => {
    const e = estadoMesa(m);
    const pendientes = solicitudes.filter(s => Number(s.mesa) === Number(m) && s.estado === 'pendiente').length;
    const etiqueta = e.estado === 'libre' ? '🟢 Libre' : (e.estado === 'pendiente' ? '🔴 Por cobrar' : '🟡 Ocupada');
    return `<button type="button" class="mesa ${e.estado}" data-mesa="${esc(m)}">
      <div><div class="mesa-numero">${esc(m)}</div><span class="mesa-estado">${etiqueta}</span></div>
      <div><div class="mesa-total">${gs(e.total)}</div>
      ${pendientes ? `<div class="mesa-solicitud">📥 ${pendientes} solicitud(es) pendiente(s)</div>` : ''}</div>
    </button>`;
  }).join('') : '<p class="pista">Cuando el administrador agregue mesas en Configuración → 🪑 Mesas, aparecen acá automáticamente.</p>';
}

$('mesas-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mesa]');
  if (!b) return;
  abrirCuenta(Number(b.dataset.mesa));
});

function abrirCuenta(mesa) {
  mesaActual = mesa;
  if (stopCuenta) stopCuenta();
  stopCuenta = escucharCuenta(mesa, (datos) => {
    if (!datos) return;
    cuentaActual = datos;
    if (vista === 'cuenta') pintarCuenta();
  });
  $('cuenta-titulo').textContent = '🪑 Mesa ' + mesa;
  pintarCuenta();
  mostrarVista('cuenta');
}

function pintarCuenta() {
  if (mesaActual === null) return;
  const { pedido: p, comandas } = cuentaActual;
  $('cuenta-estado').textContent = !p ? 'Sin cuenta abierta' : (p.pagado ? 'Cuenta cobrada' : (p.estado === 'entregado' ? 'Lista para cobrar' : 'Pedido en curso'));
  $('cuenta-total').textContent = gs(p ? p.total : 0);

  const consumo = p
    ? [
        ...(p.pizzas || []).map(z => `<div class="mini-item"><strong>🍕 ${esc(z.nombre || z.tamano)}</strong><span class="pista">${esc((z.sabores || []).join(' / '))}${z.borde ? ' · borde' : ''}</span></div>`),
        ...(p.extras || []).map(x => `<div class="mini-item"><strong>${esc(x.item)} × ${esc(x.cantidad)}</strong></div>`)
      ].join('')
    : '<p class="pista">Todavía no hay productos confirmados por el TPV.</p>';
  $('cuenta-consumo').innerHTML = consumo;

  $('cuenta-comandas').innerHTML = comandas.length
    ? comandas.map(c => `<div class="mini-item"><strong>Comanda ${esc(c.id.slice(0, 6))} · ${esc(hora(c.creado))}</strong>
        <span class="pista">${describirItems(c.items || {})} · ${gs(c.subtotal)}</span></div>`).join('')
    : '<p class="pista">Las comandas aparecen cuando el TPV confirma cada solicitud.</p>';

  const propias = solicitudes.filter(s => Number(s.mesa) === Number(mesaActual));
  $('cuenta-solicitudes').innerHTML = propias.length ? propias.map(s => {
    const etiquetas = {
      pendiente: '⏳ Enviada — esperando confirmación del TPV',
      confirmada: '✅ Confirmada — ya está en la cuenta',
      rechazada: '❌ Rechazada' + (s.motivo ? ': ' + s.motivo : '')
    };
    return `<div class="mini-item"><strong>Solicitud ${esc(s.id.slice(0, 6))} · ${esc(hora(s.creado))}</strong>
      <span class="pista">${describirItems(s.items || {})}</span>
      <div class="estado-envio ${esc(s.estado)}">${etiquetas[s.estado] || esc(s.estado)}</div></div>`;
  }).join('') : '<p class="pista">No enviaste solicitudes para esta mesa.</p>';
}

function describirItems(items) {
  const partes = [
    ...(items.pizzas || []).map(z => `${z.nombre || z.tamano} (${(z.sabores || []).join('/')})${z.borde ? ' +borde' : ''}`),
    ...(items.extras || []).map(x => `${x.item || x.id} x${x.cantidad}`)
  ];
  return esc(partes.join(' · ')) || 'Sin productos';
}

$('btn-agregar-productos').addEventListener('click', () => {
  iniciarPedido(mesaActual);
  mostrarVista('pedido');
});

/* --------------------------------------------------------------------------
   Tomar pedido
   -------------------------------------------------------------------------- */

function menu() { return configuracion().menu; }

function iniciarPedido(mesa) {
  pedido.mesa = mesa;
  pedido.sabores = [];
  pedido.pizzas = [];
  pedido.extras = {};
  pedido.notas = '';
  pedido.borde = false;
  const m = menu();
  pedido.tamano = m && m.tamanos ? Object.keys(m.tamanos)[0] : null;
  operacionEnCurso = null;
  errorEn('pedido-error', '');
  $('pedido-notas').value = '';
  $('pedido-borde').checked = false;
  $('pedido-titulo').textContent = 'Nuevo pedido · Mesa ' + mesa;
  $('pedido-subtitulo').textContent = 'El TPV confirma los precios finales';
  $('btn-enviar').disabled = false;
  $('btn-enviar').textContent = '📤 Enviar solicitud';
  $('pedido-estado').classList.add('hidden');
  renderPedido();
}

function renderPedido() {
  if (vista !== 'pedido') return;
  const m = menu();
  if (!m) {
    errorEn('pedido-error', 'El menú todavía no cargó. Esperá la conexión e intentá de nuevo.');
    return;
  }
  errorEn('pedido-error', '');
  if (!m.tamanos[pedido.tamano]) pedido.tamano = Object.keys(m.tamanos)[0];

  $('pedido-tamanos').innerHTML = Object.entries(m.tamanos).map(([k, t]) =>
    `<button type="button" class="opcion ${k === pedido.tamano ? 'activa' : ''}" data-tamano="${esc(k)}">${esc(t.corto || t.nombre || k)}</button>`
  ).join('');

  const limite = Math.max(1, Number((m.tamanos[pedido.tamano] || {}).limite) || 1);
  $('sabores-limite').textContent = '· hasta ' + limite;
  const categorias = [
    ['gourmet', '⭐ Gourmet'], ['especial', '✨ Especiales'], ['clasico', '🍃 Clásicos']
  ];
  $('pedido-sabores').innerHTML = categorias.map(([k, titulo]) => {
    const lista = (m.sabores && m.sabores[k]) || [];
    return `<div><div class="categoria-titulo">${titulo}</div><div class="sabores">${lista.map(s =>
      `<button type="button" class="sabor ${pedido.sabores.includes(s) ? 'activo' : ''}" data-sabor="${esc(s)}">${esc(s)}</button>`
    ).join('')}</div></div>`;
  }).join('');

  $('pedido-elegidos').textContent = pedido.sabores.length
    ? pedido.sabores.length + '/' + limite + ' · ' + pedido.sabores.join(', ')
    : 'Sin sabores elegidos';

  $('pedido-extras').innerHTML = (m.extras || []).map(x => {
    const id = String(x.id);
    const cant = Number(pedido.extras[id] || 0);
    return `<div class="extra"><div><div class="extra-nombre">${esc(x.nombre || id)}</div><div class="extra-precio">${gs(x.precio)}</div></div>
      <div class="contador"><button type="button" data-extra-menos="${esc(id)}" ${cant ? '' : 'disabled'}>−</button><span>${cant}</span><button type="button" data-extra-mas="${esc(id)}">＋</button></div></div>`;
  }).join('') || '<p class="pista">No hay extras configurados.</p>';

  const bruto = pedido.pizzas.reduce((a, z) => a + z.precio, 0) +
    (m.extras || []).reduce((a, x) => a + Number(pedido.extras[String(x.id)] || 0) * Number(x.precio || 0), 0);
  $('resumen-pizzas').textContent = pedido.pizzas.length;
  $('resumen-extras').textContent = Object.values(pedido.extras).reduce((a, b) => a + Number(b), 0);
  $('resumen-total').textContent = gs(bruto);
  $('pedido-pizzas-lista').innerHTML = pedido.pizzas.map((z, i) =>
    `<div class="mini-item"><strong>${i + 1}. ${esc(z.nombre || z.tamano)} · ${gs(z.precio)}</strong><span class="pista">${esc(z.sabores.join(' / '))}${z.borde ? ' · borde' : ''} <button type="button" data-quitar-pizza="${i}" class="btn btn-chico">Quitar</button></span></div>`
  ).join('');
}

$('pedido-tamanos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tamano]'); if (!b) return;
  pedido.tamano = b.dataset.tamano;
  pedido.sabores = [];
  renderPedido();
});

$('pedido-sabores').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sabor]'); if (!b) return;
  const s = b.dataset.sabor;
  const limite = Math.max(1, Number((menu().tamanos[pedido.tamano] || {}).limite) || 1);
  if (pedido.sabores.includes(s)) pedido.sabores = pedido.sabores.filter(x => x !== s);
  else if (pedido.sabores.length >= limite) { toast('Ese tamaño admite hasta ' + limite + ' sabores.'); return; }
  else pedido.sabores.push(s);
  renderPedido();
});

$('pedido-extras').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.extraMas) pedido.extras[b.dataset.extraMas] = Math.min(99, Number(pedido.extras[b.dataset.extraMas] || 0) + 1);
  else if (b.dataset.extraMenos) pedido.extras[b.dataset.extraMenos] = Math.max(0, Number(pedido.extras[b.dataset.extraMenos] || 0) - 1);
  else return;
  renderPedido();
});

$('pedido-pizzas-lista').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quitar-pizza]'); if (!b) return;
  pedido.pizzas.splice(Number(b.dataset.quitarPizza), 1);
  renderPedido();
});

$('pedido-borde').addEventListener('change', (e) => { pedido.borde = e.target.checked; });

$('btn-agregar-pizza').addEventListener('click', () => {
  const m = menu();
  if (!m) return;
  const limite = Math.max(1, Number((m.tamanos[pedido.tamano] || {}).limite) || 1);
  if (!pedido.sabores.length) { toast('Elegí al menos un sabor.'); return; }
  if (pedido.sabores.length > limite) { toast('Demasiados sabores para ese tamaño.'); return; }
  const t = m.tamanos[pedido.tamano];
  const precio = precioPizza(m, pedido.tamano, pedido.sabores, pedido.borde);
  pedido.pizzas.push({
    tamano: pedido.tamano,
    nombre: t.nombre || pedido.tamano,
    sabores: [...pedido.sabores],
    borde: !!pedido.borde,
    precio
  });
  pedido.sabores = [];
  pedido.borde = false;
  $('pedido-borde').checked = false;
  renderPedido();
});

$('btn-enviar').addEventListener('click', async () => {
  if (enviando || !usuario) return;
  pedido.notas = $('pedido-notas').value.trim();
  const extras = (menu().extras || [])
    .filter(x => Number(pedido.extras[String(x.id)] || 0) > 0)
    .map(x => ({ id: String(x.id), cantidad: Number(pedido.extras[String(x.id)]) }));
  if (!pedido.pizzas.length && !extras.length) { toast('Agregá al menos una pizza o un extra.'); return; }
  if (!configuracion().enLinea) {
    $('pedido-estado').className = 'estado-envio pendiente';
    $('pedido-estado').textContent = '⚠️ Sin Internet: el pedido TODAVÍA NO se envió. No lo consideres confirmado.';
    $('pedido-estado').classList.remove('hidden');
    return;
  }
  enviando = true;
  $('btn-enviar').disabled = true;
  $('btn-enviar').textContent = 'Enviando…';
  errorEn('pedido-error', '');
  try {
    // Un mismo operacionId para reintentos del mismo envío: evita duplicados.
    operacionEnCurso = operacionEnCurso || generarOperacionId();
    await enviarSolicitud({
      mesa: pedido.mesa,
      items: { pizzas: pedido.pizzas, extras },
      actor: { uid: usuario.uid, email: usuario.email, nombre: perfil.nombre || perfil.email || '' },
      operacionId: operacionEnCurso
    });
    $('pedido-estado').className = 'estado-envio pendiente';
    $('pedido-estado').textContent = '📤 Solicitud enviada. Esperando a que el TPV la confirme…';
    $('pedido-estado').classList.remove('hidden');
    toast('Solicitud enviada al TPV');
  } catch (e) {
    errorEn('pedido-error', e.code === 'permission-denied'
      ? 'Firestore no permitió enviar la solicitud. Pedile al administrador que publique las reglas de la Etapa 2.'
      : 'No se pudo enviar: ' + e.message + '. Seguí sin conexión: volvé a tocar Enviar cuando tengas Internet.');
  } finally {
    enviando = false;
    $('btn-enviar').disabled = false;
    $('btn-enviar').textContent = '📤 Enviar solicitud';
  }
});

function pintarEstadoSolicitud() {
  if (!operacionEnCurso) return;
  const s = solicitudes.find(x => x.id === operacionEnCurso);
  if (!s) return;
  const el = $('pedido-estado');
  el.classList.remove('hidden');
  if (s.estado === 'confirmada') {
    el.className = 'estado-envio confirmada';
    el.textContent = '✅ Pedido confirmado por el TPV. Ya está en la cuenta de la mesa.';
  } else if (s.estado === 'rechazada') {
    el.className = 'estado-envio rechazada';
    el.textContent = '❌ Solicitud rechazada por el TPV' + (s.motivo ? ': ' + s.motivo : '');
  } else {
    el.className = 'estado-envio pendiente';
    el.textContent = '⏳ Solicitud enviada, esperando confirmación del TPV.';
  }
}

/* --------------------------------------------------------------------------
   Registro del service worker
   -------------------------------------------------------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
