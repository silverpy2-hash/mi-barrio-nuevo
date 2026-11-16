/* ==========================================================================
   MI BARRIO — App Bootstrap
   Punto de entrada principal: inicializa todos los módulos en orden
   ========================================================================== */

import { iniciarConfigListeners } from './config-listener.js';
import { initUI } from './ui.js';

// Estado de inicialización
let modulosListos = {
  firebase: false,
  config: false,
  ui: false
};

function verificarTodoListo() {
  if (modulosListos.firebase && modulosListos.config && modulosListos.ui) {
    console.log('[App] Todos los módulos inicializados ✓');
    window.dispatchEvent(new CustomEvent('app:ready'));
  }
}

// Esperar a que Firebase esté listo (se exporta desde firebase.js como módulo)
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[App] Iniciando Mi Barrio Cliente v1...');

  try {
    // 1. Inicializar listeners de config (Firestore)
    // firebase.js ya se ejecuta primero por orden de import en index.html
    modulosListos.firebase = true;
    verificarTodoListo();

    iniciarConfigListeners();
    modulosListos.config = true;
    verificarTodoListo();

    // 2. Inicializar UI (render, bindings, etc.)
    initUI();
    modulosListos.ui = true;
    verificarTodoListo();

    // 3. Manejar botón de tema (header)
    const btnTema = document.getElementById('btn-tema');
    const temas = ['clasico', 'bonito', 'noche'];
    let temaActualIdx = 0;
    btnTema?.addEventListener('click', () => {
      temaActualIdx = (temaActualIdx + 1) % temas.length;
      if (window.aplicarTemaCliente) window.aplicarTemaCliente(temas[temaActualIdx]);
      // Actualizar icono del botón
      const iconos = {
        clasico: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
        bonito: '<path d="M12 3v1M12 20v1M4.22 4.22l.71.71M19.07 19.07l.71.71M1 12h1M22 12h1M4.22 19.78l.71-.71M19.07 4.93l.71-.71"/><circle cx="12" cy="12" r="4"/>',
        noche: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
      };
      btnTema.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconos[temas[temaActualIdx]]}</svg>`;
    });

    // 4. Service Worker update notification
    if ('serviceWorker' in navigator) {
      // En la primera visita el SW recién se instala y toma control: no hay que recargar.
      const teniaControlador = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!teniaControlador || refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }

    // 5. Manejar botón "back" del navegador para navegación interna
    window.addEventListener('popstate', async (e) => {
      if (e.state?.page) {
        const { navegarA } = await import('./ui.js');
        navegarA(e.state.page);
      }
    });

    // 6. Prevenir zoom en inputs en iOS
    document.addEventListener('touchstart', () => {}, { passive: true });

    console.log('[App] Bootstrap completado');
  } catch (err) {
    console.error('[App] Error en bootstrap:', err);
    // Mostrar error amigable
    document.body.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4 bg-card">
        <div class="text-center max-w-md">
          <div class="text-6xl mb-4">😕</div>
          <h1 class="text-xl font-bold text-ink mb-2">No se pudo cargar la app</h1>
          <p class="text-muted mb-6">Ocurrió un error al inicializar. Verificá tu conexión e intentá de nuevo.</p>
          <button onclick="location.reload()" class="btn btn-primary">Reintentar</button>
        </div>
      </div>
    `;
  }
});

// Exportar para debugging en consola
window.MiBarrioApp = {
  getState: () => modulosListos,
  reiniciar: () => location.reload()
};