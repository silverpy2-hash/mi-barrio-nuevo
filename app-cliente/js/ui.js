/* ==========================================================================
   MI BARRIO — UI Module
   Renderizado, binding de eventos, navegación entre páginas/pasos
   ========================================================================== */

import { suscribir as suscribirMenu, getTamanos, getSaboresPlanos, getExtras, getLimiteSabores, getPrecioBorde, getNombreTamano, getNombreCortoTamano, estaAgotado, calcularCategoriaSabores, getPrecioPizza, getNombreExtra, getPrecioExtra } from './menu-store.js';
import { suscribir as suscribirCart, getTipoPedido, getMesaActual, setTipoPedido, setMesaActual, setDescuento, agregarPizza, quitarPizza, limpiarPizzas, setExtraCantidad, cambiarExtraCantidad, limpiar, getExtrasCantidades, limpiarExtras, getTotalesConDelivery, getPizzas } from './cart.js';
import { getDeliveryState, programarCalculo, resetDelivery, formatearDeliveryInfo, coordsDeMaps } from './delivery.js';
import { getLocalConfig, getEstadoLocal, getMesasConfig } from './config-listener.js';
import { crearYEnviarPedido, generarResumenHTML } from './order.js';
import { normalizarCelularPY, formatearCelularPY, escaparHtml, formatearGs } from './firebase.js';

// Estado UI
let pasoActual = 1; // 1=tamaño, 2=sabores, 3=extras, 4=datos
let tamanoSeleccionado = null;
let saboresSeleccionados = [];
let bordeSeleccionado = false;
let formaPagoSeleccionada = 'efectivo';
let mapaInicializado = false;
let marcadorMapa = null;

// Elementos DOM cacheados
const els = {};

// Inicializar referencias DOM
function cacheElements() {
  // Páginas
  els.pages = {
    inicio: document.getElementById('page-inicio'),
    menu: document.getElementById('page-menu'),
    cart: document.getElementById('page-cart'),
    orders: document.getElementById('page-orders'),
    info: document.getElementById('page-info')
  };

  // Stepper
  els.stepperItems = document.querySelectorAll('#stepper-pedido .stepper-item');
  els.stepTamano = document.getElementById('step-tamano');
  els.stepSabores = document.getElementById('step-sabores');
  els.stepExtras = document.getElementById('step-extras');
  els.stepDatos = document.getElementById('step-datos');
  els.stepNav = document.getElementById('step-nav');
  els.btnPasoAnterior = document.getElementById('btn-paso-anterior');
  els.btnPasoSiguiente = document.getElementById('btn-paso-siguiente');

  // Grids
  els.gridTamanos = document.getElementById('grid-tamanos');
  els.gridGourmet = document.getElementById('grid-gourmet');
  els.gridEspecial = document.getElementById('grid-especial');
  els.gridClasico = document.getElementById('grid-clasico');
  els.contenedorBorde = document.getElementById('contenedor-borde');
  els.contadorSabores = document.getElementById('contador-sabores');
  els.btnAgregarPizza = document.getElementById('btn-agregar-pizza');
  els.btnCambiarTamano = document.getElementById('btn-cambiar-tamano');
  els.btnAgregarMasPizzas = document.getElementById('btn-agregar-mas-pizzas');
  els.listaExtras = document.getElementById('lista-extras');

  // Datos cliente
  els.inputNombre = document.getElementById('input-nombre');
  els.inputCelular = document.getElementById('input-celular');
  els.inputDireccion = document.getElementById('input-direccion');
  els.inputNotas = document.getElementById('input-notas');
  els.inputLatitud = document.getElementById('input-latitud');
  els.inputLongitud = document.getElementById('input-longitud');
  els.mapaCliente = document.getElementById('mapa-cliente');
  els.deliveryInfoCliente = document.getElementById('delivery-info-cliente');
  els.btnMiUbicacion = document.getElementById('btn-mi-ubicacion');
  els.pagoOpciones = document.getElementById('pago-opciones');

  // Totales
  els.totalFinal = document.getElementById('total-final');
  els.bottomTotal = document.getElementById('bottom-total');
  els.bottomBarTotal = document.querySelector('.bottom-bar-total');
  els.btnConfirmarPedido = document.getElementById('btn-confirmar-pedido');
  els.btnBottomContinuar = document.getElementById('btn-bottom-continuar');
  els.bottomBar = document.getElementById('bottom-bar');

  // Carrito / resumen del pedido
  els.cartItems = document.getElementById('cart-items');
  els.cartSubtotal = document.getElementById('cart-subtotal');
  els.cartDeliveryRow = document.getElementById('cart-delivery-row');
  els.cartDelivery = document.getElementById('cart-delivery');
  els.cartTotal = document.getElementById('cart-total');
  els.btnCartContinuar = document.getElementById('btn-cart-continuar');
  els.pedidoActual = document.getElementById('pedido-actual');
  els.pedidoActualWrap = document.getElementById('pedido-actual-wrap');
  els.pedidoContador = document.getElementById('pedido-contador');

  // Modal confirmar
  els.modalConfirmar = document.getElementById('modal-confirmar');
  els.modalConfirmarBody = document.getElementById('modal-confirmar-body');
  els.modalConfirmarCerrar = document.getElementById('modal-confirmar-cerrar');
  els.modalConfirmarCancelar = document.getElementById('modal-confirmar-cancelar');
  els.modalConfirmarEnviar = document.getElementById('modal-confirmar-enviar');

  // Toast
  els.toast = document.getElementById('toast');

  // Banner cerrado
  els.bannerCerrado = document.getElementById('banner-cerrado');
  els.cerradoTexto = document.getElementById('cerrado-texto');

  // Aviso mesa
  els.avisoMesa = document.getElementById('aviso-mesa');
  els.mesaTexto = document.getElementById('mesa-texto');

  // Hero
  els.heroBienvenida = document.getElementById('hero-bienvenida');

  // Botones navegación principal
  els.btnNuevoPedido = document.getElementById('btn-nuevo-pedido');
  els.btnMisPedidos = document.getElementById('btn-mis-pedidos');
  els.btnInfo = document.getElementById('btn-info');
}

// Navegación entre páginas
export function navegarA(pageId) {
  Object.values(els.pages).forEach(p => p?.classList.remove('active'));
  const page = els.pages[pageId];
  if (page) {
    page.classList.add('active');
    window.scrollTo(0, 0);
  }
  // La barra inferior de totales solo tiene sentido mientras se arma el pedido
  if (els.bottomBar) els.bottomBar.classList.toggle('hidden', pageId !== 'menu');
  // Actualizar URL sin recargar (conservando ?mesa= del QR)
  const url = new URL(window.location.href);
  if (pageId === 'inicio') url.searchParams.delete('page');
  else url.searchParams.set('page', pageId);
  history.pushState({ page: pageId }, '', url.pathname + url.search);
}

function navegarPaso(paso) {
  pasoActual = Math.max(1, Math.min(4, paso));
  // Ocultar todos
  [els.stepTamano, els.stepSabores, els.stepExtras, els.stepDatos].forEach(el => el?.classList.add('hidden'));
  // Mostrar actual
  const stepEl = [els.stepTamano, els.stepSabores, els.stepExtras, els.stepDatos][pasoActual - 1];
  stepEl?.classList.remove('hidden');
  stepEl?.classList.add('animate-slide-up');

  // Actualizar stepper
  els.stepperItems.forEach((item, i) => {
    item.classList.toggle('active', i === pasoActual - 1);
    item.classList.toggle('completed', i < pasoActual - 1);
  });

  // Mostrar/ocultar navegación de pasos
  els.stepNav.classList.toggle('hidden', pasoActual === 1);

  // En el paso 4 la acción final ocupa la barra inferior (donde estaba "Continuar →")
  if (els.btnBottomContinuar) {
    const esPaso4 = pasoActual === 4;
    els.btnBottomContinuar.textContent = esPaso4 ? '🚀 Confirmar y enviar por WhatsApp' : 'Continuar →';
    els.btnBottomContinuar.classList.toggle('flex-1', esPaso4);
    els.bottomBarTotal?.classList.toggle('hidden', esPaso4);
    // Evita duplicar la acción: en el paso 4 solo se usa el botón inferior
    els.btnConfirmarPedido?.classList.toggle('hidden', esPaso4);
  }

  // Actualizar botón siguiente
  if (pasoActual === 4) {
    els.btnPasoSiguiente.textContent = 'Confirmar';
    els.btnPasoSiguiente.classList.add('btn-primary');
    els.btnPasoSiguiente.classList.remove('btn-secondary');
  } else {
    els.btnPasoSiguiente.textContent = 'Siguiente →';
    els.btnPasoSiguiente.classList.remove('btn-primary');
    els.btnPasoSiguiente.classList.add('btn-secondary');
  }

  // En el paso 4 la única acción final es "Confirmar y enviar por WhatsApp"
  els.btnPasoSiguiente.classList.toggle('hidden', pasoActual === 4);

  // Reevaluar el estado del botón "Siguiente" según el paso en el que estamos
  const validadores = [validarPaso1, validarPaso2, validarPaso3, validarPaso4];
  validadores[pasoActual - 1]();

  // Inicializar el mapa al entrar al paso de datos (solo delivery)
  if (pasoActual === 4 && getTipoPedido() === 'delivery') initMapa();
}

// Renderizar tamaños
function renderTamanos() {
  const tamanos = getTamanos();
  const claves = Object.keys(tamanos);
  if (!claves.length) return;

  // Seleccionar primero si no hay selección
  if (!tamanoSeleccionado && claves.length) tamanoSeleccionado = claves[0];

  els.gridTamanos.innerHTML = claves.map(k => {
    const t = tamanos[k];
    const on = k === tamanoSeleccionado;
    return `
      <button type="button" class="radio-card ${on ? 'border-accent bg-accent/5' : 'border-line'}" data-tamano="${k}" role="radio" aria-checked="${on}">
        <div class="font-bold text-center leading-tight">${escaparHtml(t.nombre)}</div>
        <div class="text-xs text-center text-muted mt-1">Hasta ${t.limiteSabores} variedades</div>
        <div class="text-[11px] text-center text-muted leading-snug mt-1">
          Clásico: <strong class="text-accent">${formatearGs(t.clasico)}</strong><br>
          Especial: <strong class="text-accent">${formatearGs(t.especial)}</strong><br>
          Gourmet: <strong class="text-accent">${formatearGs(t.gourmet)}</strong>
        </div>
      </button>
    `;
  }).join('');

  // Bind clicks
  els.gridTamanos.querySelectorAll('[data-tamano]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nuevo = btn.dataset.tamano;
      const cambio = nuevo !== tamanoSeleccionado;
      if (cambio) {
        tamanoSeleccionado = nuevo;
        // Igual que index.html: solo se limpian los sabores si se supera el nuevo límite
        if (saboresSeleccionados.length > getLimiteSabores(tamanoSeleccionado)) {
          saboresSeleccionados = [];
        }
        // El borde se reinicia al cambiar de tamaño (index.html: actualizarInterfaz)
        bordeSeleccionado = false;
        renderTamanos();
        renderSabores();
        renderBorde();
        actualizarTotales();
      }
      // Al elegir tamaño en el paso 1, avanzar siempre a sabores (aunque ya estuviera activo)
      if (pasoActual === 1) navegarPaso(2);
      else validarPaso2();
    });
  });

  // Al primer render el tamaño queda autoseleccionado: habilitar "Siguiente"
  if (pasoActual === 1) validarPaso1();
}

// Renderizar sabores por categoría
function renderSabores() {
  if (!tamanoSeleccionado) return;
  // Igual que index.html: si un sabor pasa a agotado, se destilda
  saboresSeleccionados = saboresSeleccionados.filter(s => !estaAgotado(s));
  const limite = getLimiteSabores(tamanoSeleccionado);
  const cats = ['gourmet', 'especial', 'clasico'];
  const contenedores = {
    gourmet: els.gridGourmet,
    especial: els.gridEspecial,
    clasico: els.gridClasico
  };

  cats.forEach(cat => {
    const cont = contenedores[cat];
    if (!cont) return;
    const lista = getSaboresPlanos(cat);
    cont.innerHTML = lista.map(s => {
      const agotado = estaAgotado(s);
      const marcado = saboresSeleccionados.includes(s);
      const disabled = agotado || (!marcado && saboresSeleccionados.length >= limite);
      return `
        <button type="button" class="inline-check ${marcado ? 'bg-accent/10 border-accent' : 'border-line'} rounded-lg p-2 ${agotado ? 'opacity-50 line-through' : ''} ${disabled ? 'cursor-not-allowed' : ''}" data-sabor="${escaparHtml(s)}" data-cat="${cat}" ${disabled ? 'disabled' : ''} role="checkbox" aria-checked="${marcado}" aria-disabled="${disabled}">
          <input type="checkbox" class="radio-circle" data-cat="${cat}" ${marcado ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-hidden="true">
          <span class="font-semibold text-sm">${escaparHtml(s)}</span>
          ${agotado ? '<span class="badge badge-cancel">AGOTADO</span>' : ''}
        </button>
      `;
    }).join('');
  });

  // Bind clicks
  ['gourmet', 'especial', 'clasico'].forEach(cat => {
    const cont = contenedores[cat];
    cont?.querySelectorAll('[data-sabor]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const sabor = btn.dataset.sabor;
        const idx = saboresSeleccionados.indexOf(sabor);
        if (idx >= 0) {
          saboresSeleccionados.splice(idx, 1);
        } else if (saboresSeleccionados.length < getLimiteSabores(tamanoSeleccionado)) {
          saboresSeleccionados.push(sabor);
        }
        renderSabores();
        renderBorde();
        actualizarTotales();
        validarPaso2();
      });
    });
  });

  // Actualizar contador
  els.contadorSabores.textContent = `Seleccionados: ${saboresSeleccionados.length} / ${limite}`;
}

// Renderizar borde relleno
function renderBorde() {
  if (!tamanoSeleccionado) { els.contenedorBorde.classList.add('hidden'); return; }
  const precioBorde = getPrecioBorde(tamanoSeleccionado);
  if (precioBorde <= 0) { els.contenedorBorde.classList.add('hidden'); return; }

  els.contenedorBorde.classList.remove('hidden');
  els.contenedorBorde.innerHTML = `
    <label class="inline-check cursor-pointer w-full">
      <input type="checkbox" class="checkbox-square" id="chk-borde" ${bordeSeleccionado ? 'checked' : ''}>
      <span class="font-medium">Añadir Borde Relleno (${getNombreCortoTamano(tamanoSeleccionado)})</span>
      <span class="ml-auto font-bold text-accent">+${formatearGs(precioBorde)}</span>
    </label>
  `;
  const chk = document.getElementById('chk-borde');
  chk?.addEventListener('change', () => {
    bordeSeleccionado = chk.checked;
    actualizarTotales();
    validarPaso2();
  });
}

// Renderizar extras
function renderExtras() {
  const extras = getExtras();
  if (!extras.length) { els.listaExtras.innerHTML = '<p class="text-sm text-muted text-center py-4">Sin extras disponibles</p>'; return; }

  els.listaExtras.innerHTML = extras.map(x => {
    const cant = getExtrasCantidades()[x.id] || 0;
    return `
      <div class="list-item">
        <div class="list-item-content">
          <div class="list-item-title">${escaparHtml(x.nombre)}</div>
          <div class="list-item-subtitle">${formatearGs(x.precio)} c/u</div>
        </div>
        <div class="counter">
          <button type="button" class="counter-btn" data-extra="${x.id}" data-delta="-1" ${cant === 0 ? 'disabled' : ''} aria-label="Restar">−</button>
          <span class="counter-value">${cant}</span>
          <button type="button" class="counter-btn counter-btn-primary" data-extra="${x.id}" data-delta="1" aria-label="Sumar">+</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind
  els.listaExtras.querySelectorAll('[data-extra]').forEach(btn => {
    btn.addEventListener('click', () => {
      cambiarExtraCantidad(btn.dataset.extra, Number(btn.dataset.delta));
      renderExtras();
      actualizarTotales();
    });
  });
}

// Renderizar el pedido armado (pizzas + extras) con opción de quitar
function renderCarrito() {
  const pizzas = getPizzas();
  const extrasLista = Object.entries(getExtrasCantidades()).filter(([, c]) => c > 0);

  const htmlPizzas = pizzas.map((p, i) => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">Pizza ${i + 1} – ${escaparHtml(getNombreTamano(p.tamano))}</div>
        <div class="list-item-subtitle">${p.sabores.map(escaparHtml).join(', ')}${p.borde ? ' · Borde relleno' : ''}</div>
        <div class="text-sm font-bold text-accent">${formatearGs(p.precio)}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-quitar-pizza="${i}" aria-label="Quitar pizza ${i + 1}">Quitar</button>
    </div>`).join('');

  const htmlExtras = extrasLista.map(([id, cant]) => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${escaparHtml(getNombreExtra(id))} <span class="text-muted">x${cant}</span></div>
        <div class="list-item-subtitle">${formatearGs(getPrecioExtra(id) * cant)}</div>
      </div>
    </div>`).join('');

  const vacio = `
    <div class="empty-state">
      <div class="empty-icon">🍕</div>
      <h3 class="empty-title">Tu pedido está vacío</h3>
      <p class="empty-message">Agregá pizzas y extras para ver el resumen aquí.</p>
    </div>`;

  const hayItems = pizzas.length > 0 || extrasLista.length > 0;
  if (els.cartItems) els.cartItems.innerHTML = hayItems ? htmlPizzas + htmlExtras : vacio;
  if (els.pedidoActual) els.pedidoActual.innerHTML = htmlPizzas || '<p class="text-sm text-muted">Todavía no agregaste ninguna pizza.</p>';
  if (els.pedidoActualWrap) els.pedidoActualWrap.classList.toggle('hidden', !hayItems);
  if (els.pedidoContador) els.pedidoContador.textContent = `${pizzas.length} ${pizzas.length === 1 ? 'pizza' : 'pizzas'}`;
}

// Validaciones por paso
function validarPaso1() {
  els.btnPasoSiguiente.disabled = !tamanoSeleccionado;
  els.btnBottomContinuar.disabled = !tamanoSeleccionado;
}

function validarPaso2() {
  const limite = tamanoSeleccionado ? getLimiteSabores(tamanoSeleccionado) : 0;
  const pizzaValida = saboresSeleccionados.length > 0 && saboresSeleccionados.length <= limite;
  const puedeSeguir = pizzaValida || getPizzas().length > 0;
  els.btnAgregarPizza.disabled = !pizzaValida;
  els.btnPasoSiguiente.disabled = !puedeSeguir;
  els.btnBottomContinuar.disabled = !puedeSeguir;
}

function validarPaso3() {
  // Extras opcional, siempre válido
  els.btnPasoSiguiente.disabled = false;
  els.btnBottomContinuar.disabled = false;
}

function validarPaso4() {
  const tipo = getTipoPedido();
  const nombre = els.inputNombre.value.trim();
  const celular = normalizarCelularPY(els.inputCelular.value);
  const direccion = els.inputDireccion.value.trim();
  const lat = els.inputLatitud.value;
  const lng = els.inputLongitud.value;

  let valido = true;

  if (tipo === 'delivery') {
    const delivery = getDeliveryState();
    valido = !!nombre && !!celular && !!direccion && !!lat && !!lng
      && delivery.km != null && !delivery.fuera;
  } else if (tipo === 'local') {
    // En mesa (QR) no se piden datos del cliente, igual que index.html
    valido = !!getMesaActual();
  } else {
    valido = !!nombre;
  }

  els.btnConfirmarPedido.disabled = !valido;
  els.btnBottomContinuar.disabled = !valido;
  els.btnPasoSiguiente.disabled = !valido;
}

// Actualizar totales en UI
function actualizarTotales() {
  const { subtotal, envio, total } = getTotalesConDelivery();
  // Igual que index.html: mientras se configura, la pizza actual ya cuenta en el total
  let pizzaActual = 0;
  if (tamanoSeleccionado && saboresSeleccionados.length) {
    pizzaActual = getPrecioPizza(tamanoSeleccionado, saboresSeleccionados, bordeSeleccionado);
  }
  const totalConPizzaActual = total + pizzaActual;

  els.totalFinal.textContent = formatearGs(totalConPizzaActual);
  els.bottomTotal.textContent = formatearGs(totalConPizzaActual);

  if (els.cartSubtotal) els.cartSubtotal.textContent = formatearGs(subtotal);
  if (els.cartDelivery) els.cartDelivery.textContent = formatearGs(envio);
  if (els.cartDeliveryRow) els.cartDeliveryRow.classList.toggle('hidden', envio <= 0);
  if (els.cartTotal) els.cartTotal.textContent = formatearGs(total);

  renderCarrito();
}

// Getters de cart (importados al inicio del módulo)

// Inicializar mapa Leaflet
function initMapa() {
  if (mapaInicializado) return;
  const map = L.map('mapa-cliente').setView([-25.4677519, -56.0124691], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  marcadorMapa = L.marker([-25.4677519, -56.0124691], { draggable: true }).addTo(map);

  marcadorMapa.on('dragend', (e) => {
    const pos = marcadorMapa.getLatLng();
    actualizarCoordenadas(pos.lat, pos.lng);
  });

  map.on('click', (e) => {
    marcadorMapa.setLatLng(e.latlng);
    actualizarCoordenadas(e.latlng.lat, e.latlng.lng);
  });

  mapaInicializado = true;
  // Trigger resize después de mostrar
  setTimeout(() => map.invalidateSize(), 100);
}

function actualizarCoordenadas(lat, lng) {
  els.inputLatitud.value = lat;
  els.inputLongitud.value = lng;
  programarCalculo(lat, lng);
  validarPaso4();
}

// Geolocalización
async function usarMiUbicacion() {
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    });
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (accuracy > 50) { console.warn('GPS precision baja:', accuracy); }
    if (mapaInicializado && marcadorMapa) {
      const map = marcadorMapa._map;
      map.setView([lat, lng], 16);
      marcadorMapa.setLatLng([lat, lng]);
    }
    actualizarCoordenadas(lat, lng);
  } catch (e) {
    mostrarToast('No se pudo obtener tu ubicación. Arrastra el marcador en el mapa.', 'error');
  }
}

// Binding de eventos
function bindEvents() {
  // Navegación principal
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page === 'menu') reiniciarPedido();
      navegarA(page);
    });
  });

  // Stepper navegación
  els.btnPasoAnterior?.addEventListener('click', () => navegarPaso(pasoActual - 1));
  els.btnPasoSiguiente?.addEventListener('click', () => {
    if (pasoActual === 1) { if (!els.btnPasoSiguiente.disabled) navegarPaso(2); }
    else if (pasoActual === 2) {
      if (els.btnPasoSiguiente.disabled) return;
      continuarDesdeSabores();
    }
    else if (pasoActual === 3) { navegarPaso(4); }
    else if (pasoActual === 4) { abrirModalConfirmar(); }
  });

  // Agregar pizza
  els.btnAgregarPizza?.addEventListener('click', () => {
    continuarDesdeSabores();
  });

  // Añadir más pizzas (volver a tamaños desde extras)
  els.btnAgregarMasPizzas?.addEventListener('click', () => {
    navegarPaso(1);
  });

  // Cambiar tamaño (volver al paso 1 desde sabores)
  els.btnCambiarTamano?.addEventListener('click', () => {
    navegarPaso(1);
  });

  // Forma de pago
  els.pagoOpciones?.querySelectorAll('.segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.pagoOpciones.querySelectorAll('.segmented-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
      formaPagoSeleccionada = btn.dataset.pago;
    });
  });

  // Inputs cliente
  [els.inputNombre, els.inputCelular, els.inputDireccion, els.inputNotas].forEach(el => {
    el?.addEventListener('input', validarPaso4);
  });
  els.inputDireccion?.addEventListener('input', (e) => {
    const coords = coordsDeMaps(e.target.value);
    if (coords) {
      actualizarCoordenadas(coords.lat, coords.lng);
      if (mapaInicializado && marcadorMapa) {
        marcadorMapa.setLatLng([coords.lat, coords.lng]);
      }
    }
  });

  // Botón mi ubicación
  els.btnMiUbicacion?.addEventListener('click', usarMiUbicacion);

  // Quitar pizzas desde el resumen del pedido (paso extras o página carrito)
  [els.cartItems, els.pedidoActual].forEach(cont => {
    cont?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quitar-pizza]');
      if (!btn) return;
      quitarPizza(Number(btn.dataset.quitarPizza));
      actualizarTotales();
      validarPaso2();
    });
  });

  // Continuar desde la página carrito
  els.btnCartContinuar?.addEventListener('click', () => navegarA('menu'));

  // Tipo de pedido (cambia desde botones en page-menu o page-inicio)
  // Se maneja en reiniciarPedido()

  // Modal confirmar
  els.modalConfirmarCerrar?.addEventListener('click', cerrarModalConfirmar);
  els.modalConfirmarCancelar?.addEventListener('click', cerrarModalConfirmar);
  els.modalConfirmar?.addEventListener('click', (e) => { if (e.target === els.modalConfirmar) cerrarModalConfirmar(); });
  els.modalConfirmarEnviar?.addEventListener('click', confirmarYEnviar);

  // Botones confirmar
  els.btnConfirmarPedido?.addEventListener('click', abrirModalConfirmar);
  els.btnBottomContinuar?.addEventListener('click', () => {
    if (pasoActual === 2) {
      if (els.btnBottomContinuar.disabled) return;
      continuarDesdeSabores();
      return;
    }
    if (pasoActual < 4) navegarPaso(pasoActual + 1);
    else abrirModalConfirmar();
  });

  // Toast auto-hide
  window.addEventListener('toast:show', (e) => mostrarToast(e.detail.message, e.detail.type));
}

// Agregar pizza actual al carrito
function agregarPizzaActual() {
  if (!tamanoSeleccionado || !saboresSeleccionados.length) return;
  agregarPizza(tamanoSeleccionado, saboresSeleccionados, bordeSeleccionado);
  // Reset para siguiente pizza
  saboresSeleccionados = [];
  bordeSeleccionado = false;
  renderSabores();
  renderBorde();
  validarPaso2();
  actualizarTotales();
  mostrarToast('Pizza agregada al pedido', 'success');
}

// Avanzar de sabores a extras: agrega la pizza configurada y continúa
function continuarDesdeSabores() {
  if (saboresSeleccionados.length) {
    agregarPizzaActual();
  } else if (!getPizzas().length) {
    mostrarToast('Elegí al menos un sabor para tu pizza.', 'error');
    return;
  }
  navegarPaso(3);
}

// Abrir modal confirmar
function abrirModalConfirmar() {
  if (!getEstadoLocal().abierto) {
    mostrarToast('⛔ El local está cerrado en este momento. No podemos tomar pedidos ahora.', 'error');
    return;
  }
  if (!getPizzas().length) {
    mostrarToast('Agregá al menos una pizza antes de confirmar.', 'error');
    return;
  }
  const datosCliente = {
    nombre: els.inputNombre.value.trim(),
    direccion: els.inputDireccion.value.trim(),
    celular: els.inputCelular.value.trim(),
    notas: els.inputNotas.value.trim(),
    lat: els.inputLatitud.value ? Number(els.inputLatitud.value) : null,
    lng: els.inputLongitud.value ? Number(els.inputLongitud.value) : null
  };
  els.modalConfirmarBody.innerHTML = generarResumenHTML(datosCliente, formaPagoSeleccionada);
  els.modalConfirmar.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function cerrarModalConfirmar() {
  els.modalConfirmar.classList.add('hidden');
  document.body.style.overflow = '';
}

async function confirmarYEnviar() {
  const datosCliente = {
    nombre: els.inputNombre.value.trim(),
    direccion: els.inputDireccion.value.trim(),
    celular: els.inputCelular.value.trim(),
    notas: els.inputNotas.value.trim(),
    lat: els.inputLatitud.value ? Number(els.inputLatitud.value) : null,
    lng: els.inputLongitud.value ? Number(els.inputLongitud.value) : null
  };

  els.modalConfirmarEnviar.disabled = true;
  els.modalConfirmarEnviar.textContent = 'Enviando...';

  const result = await crearYEnviarPedido(datosCliente, formaPagoSeleccionada);

  els.modalConfirmarEnviar.disabled = false;
  els.modalConfirmarEnviar.textContent = '✅ Sí, enviar por WhatsApp';

  if (result.ok) {
    cerrarModalConfirmar();
    limpiarPedidoCompleto();
    navegarA('inicio');
    if (result.guardadoEnPanel === false) {
      mostrarToast('Pedido enviado por WhatsApp, pero no se pudo registrar en el panel', 'warning');
    } else {
      mostrarToast('¡Pedido enviado por WhatsApp!', 'success');
    }
  } else {
    mostrarToast(result.error || 'Error al enviar pedido', 'error');
  }
}

// Mesa desde el QR (?mesa=N), igual que index.html
function mesaDeUrl() {
  try { return parseInt(new URLSearchParams(window.location.search).get('mesa'), 10) || 0; } catch (e) { return 0; }
}

// Define el modo del pedido: mesa (QR) o delivery por defecto.
// En modo mesa no se piden datos de entrega (index.html oculta la sección cliente).
function aplicarModoPedido() {
  const mesa = mesaDeUrl();
  const esMesa = mesa > 0;

  limpiar();
  setTipoPedido(esMesa ? 'local' : 'delivery');
  if (esMesa) setMesaActual(mesa);

  if (els.avisoMesa) els.avisoMesa.classList.toggle('hidden', !esMesa);
  if (esMesa && els.mesaTexto) els.mesaTexto.textContent = `🪑 Pedido para la mesa ${mesa}`;
  if (esMesa) els.heroBienvenida?.classList.add('hidden');

  const grupos = [els.inputNombre, els.inputCelular, els.inputDireccion, els.inputNotas, els.mapaCliente]
    .map(el => el?.closest('.input-group'));
  grupos.forEach(g => { if (g) g.classList.toggle('hidden', esMesa); });

  const titulo = els.stepDatos?.querySelector('.card-title');
  if (titulo) titulo.textContent = esMesa ? '🪑 Pedido para la mesa' : '👤 Datos para el delivery';

  return esMesa;
}

// Reiniciar pedido completo (nuevo pedido)
export function reiniciarPedido() {
  const esMesa = aplicarModoPedido();

  // Reset UI state
  pasoActual = 1;
  tamanoSeleccionado = null;
  saboresSeleccionados = [];
  bordeSeleccionado = false;
  formaPagoSeleccionada = 'efectivo';
  resetDelivery();

  // Reset form
  [els.inputNombre, els.inputCelular, els.inputDireccion, els.inputNotas].forEach(el => { if (el) el.value = ''; });
  els.inputLatitud.value = '';
  els.inputLongitud.value = '';

  // Reset pago UI
  els.pagoOpciones?.querySelectorAll('.segmented-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pago === 'efectivo');
    btn.setAttribute('aria-checked', btn.dataset.pago === 'efectivo');
  });

  // Render inicial
  navegarPaso(1);
  renderTamanos();
  renderSabores();
  renderBorde();
  renderExtras();
  actualizarTotales();
  validarPaso1();

  // Ocultar hero y mostrar stepper
  if (!esMesa) els.heroBienvenida?.classList.add('hidden');
  els.stepNav?.classList.add('hidden');

  // Reset mapa (sin fijar coordenadas: el cliente debe marcar su ubicación)
  if (mapaInicializado && marcadorMapa) {
    marcadorMapa.setLatLng([-25.4677519, -56.0124691]);
    marcadorMapa._map?.setView([-25.4677519, -56.0124691], 15);
  }
}

function limpiarPedidoCompleto() {
  reiniciarPedido();
  if (!mesaDeUrl()) els.heroBienvenida?.classList.remove('hidden');
}

// Toast
function mostrarToast(mensaje, tipo = 'info') {
  const toast = els.toast;
  toast.textContent = mensaje;
  toast.className = 'toast show';
  if (tipo === 'success') toast.classList.add('toast-success');
  else if (tipo === 'error') toast.classList.add('toast-error');
  else if (tipo === 'warning') toast.classList.add('toast-warning');
  setTimeout(() => { toast.classList.remove('show'); }, 4000);
}

// Suscribirse a cambios de carrito (se registra en initUI, cuando el DOM ya está cacheado)

// Suscribirse a delivery
window.addEventListener('delivery:calculado', () => {
  const info = formatearDeliveryInfo();
  els.deliveryInfoCliente.textContent = info.texto;
  els.deliveryInfoCliente.className = `mt-2 text-xs font-semibold ${info.clase}`;
  actualizarTotales();
  validarPaso4();
});

window.addEventListener('delivery:reset', () => {
  els.deliveryInfoCliente.textContent = '🛵 Calculando costo de delivery...';
  els.deliveryInfoCliente.className = 'mt-2 text-xs font-semibold text-muted';
  actualizarTotales();
});

// Suscribirse a config/local (estado abierto/cerrado, tema, agotados)
window.addEventListener('config:local', (e) => {
  const cfg = e.detail;
  // Banner cerrado
  const estado = getEstadoLocal();
  if (!estado.abierto) {
    els.bannerCerrado.classList.remove('hidden');
    els.cerradoTexto.textContent = cfg.mensaje || 'Por el momento no estamos tomando pedidos. ¡Gracias por visitarnos!';
    document.body.style.overflow = 'hidden';
  } else {
    els.bannerCerrado.classList.add('hidden');
    document.body.style.overflow = '';
  }
});

window.addEventListener('config:local:estado', (e) => {
  const estado = e.detail;
  if (!estado.abierto) {
    els.bannerCerrado.classList.remove('hidden');
    const cfg = getLocalConfig();
    els.cerradoTexto.textContent = cfg.mensaje || 'Por el momento no estamos tomando pedidos. ¡Gracias por visitarnos!';
    document.body.style.overflow = 'hidden';
  } else {
    els.bannerCerrado.classList.add('hidden');
    document.body.style.overflow = '';
  }
});

window.addEventListener('config:local:tema', (tema) => {
  // Tema ya se aplica via firebase.js script inline
});

// Suscribirse a mesas (para QR)
window.addEventListener('config:mesas', (e) => {
  // Si hay parámetro ?mesa=N en URL
  const urlParams = new URLSearchParams(window.location.search);
  const mesaParam = parseInt(urlParams.get('mesa'), 10);
  if (mesaParam && e.detail.includes(mesaParam)) {
    setTipoPedido('local');
    setMesaActual(mesaParam);
    els.avisoMesa.classList.remove('hidden');
    els.mesaTexto.textContent = `🪑 Pedido para la mesa ${mesaParam}`;
    els.heroBienvenida?.classList.add('hidden');
    // Saltar directamente al menú
    navegarA('menu');
  }
});

// Inicialización
export function initUI() {
  cacheElements();
  bindEvents();

  // Suscribirse a menú para render inicial
  suscribirMenu((state) => {
    if (Object.keys(state.tamanos).length) {
      renderTamanos();
      renderSabores();
      renderBorde();
      renderExtras();
      actualizarTotales();
      const statTamanos = document.getElementById('stat-tamanos');
      const statSabores = document.getElementById('stat-pizzas');
      if (statTamanos) statTamanos.textContent = Object.keys(state.tamanos).length;
      if (statSabores) statSabores.textContent = getSaboresPlanos('gourmet').length + getSaboresPlanos('especial').length + getSaboresPlanos('clasico').length;
    }
  });

  // Suscribirse a carrito
  suscribirCart(() => {
    actualizarTotales();
  });

  // Modo mesa desde el QR (?mesa=N): no depende de config/mesas
  if (mesaDeUrl()) {
    aplicarModoPedido();
    renderTamanos();
    renderSabores();
    renderBorde();
    renderExtras();
    actualizarTotales();
    validarPaso1();
    navegarA('menu');
  }

  // Verificar parámetro ?page= al cargar
  const urlParams = new URLSearchParams(window.location.search);
  const pageParam = urlParams.get('page');
  if (pageParam && els.pages[pageParam]) {
    navegarA(pageParam);
  }

  // Verificar parámetro ?mesa= (ya lo hace config:mesas listener)

  console.log('[UI] Inicializado');
}

// Helpers de exportación para uso en otros módulos
export function getPasoActual() { return pasoActual; }
export function getTamanoSeleccionado() { return tamanoSeleccionado; }
export function getSaboresSeleccionados() { return [...saboresSeleccionados]; }
export function getBordeSeleccionado() { return bordeSeleccionado; }
export function getFormaPago() { return formaPagoSeleccionada; }