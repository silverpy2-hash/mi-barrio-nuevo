// Pruebas de Mi Barrio · Repartidor (node test.mjs)
// Lógica real de logica.js + chequeos estáticos de seguridad (solo lectura) y PWA.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');

let fallas = 0;
const check = (nombre, cond, extra = '') => {
    if (!cond) { fallas++; console.log('✖ ' + nombre + (extra ? ' → ' + extra : '')); }
    else console.log('✔ ' + nombre);
};

// ===== 1. Lógica real =====
const logica = await import('./logica.js');
const MSJ = logica.MENSAJE_WHATSAPP;

check('esc escapa HTML', logica.esc('<b>&') === '&lt;b&gt;&amp;');
check('esc tolera null', logica.esc() === '' && logica.esc(null) === '');
check('gs formatea guaraníes', logica.gs(45000) === '45.000 Gs');
check('gs tolera undefined', logica.gs(undefined) === '0 Gs');
check('numeroCorto con número', logica.numeroCorto({ numero: 12 }) === '#12');
check('numeroCorto sin número', logica.numeroCorto({}) === '#--');
check('pagoTexto efectivo', logica.pagoTexto({ pago: 'efectivo' }).includes('Efectivo'));
check('pagoTexto transferencia', logica.pagoTexto({ pago: 'transferencia' }).includes('Transferencia'));
check('pagoTexto pos', logica.pagoTexto({ pago: 'pos' }).includes('POS'));
check('pagoTexto sin definir', logica.pagoTexto({}).includes('sin definir'));
check('cobroTexto pagado', logica.cobroTexto({ pagado: true }).includes('Cobrado'));
check('cobroTexto por cobrar', logica.cobroTexto({ pagado: false }).includes('cobrar'));
check('telNumero limpia', logica.telNumero('0981 123-456') === '0981123456');

// Celular paraguayo → formato internacional
check('waNumeroPy: local con 0', logica.waNumeroPy('0981 123-456') === '595981123456');
check('waNumeroPy: local sin 0', logica.waNumeroPy('981 234 567') === '595981234567');
check('waNumeroPy: internacional completo', logica.waNumeroPy('+595 981 234 567') === '595981234567');
check('waNumeroPy: con 00595', logica.waNumeroPy('00595981234567') === '595981234567');
check('waNumeroPy: 595 con doble cero', logica.waNumeroPy('5950981234567') === '595981234567');
check('waNumeroPy: fijo Asunción', logica.waNumeroPy('021 123 456') === '59521123456');
check('waNumeroPy: inválido', logica.waNumeroPy('123') === '' && logica.waNumeroPy('') === '');
check('waNumeroPy: basura', logica.waNumeroPy('abcdef') === '');

// Enlace WhatsApp oficial, con mensaje codificado y sin envío automático
check('whatsappUrl: formato wa.me', /^https:\/\/wa\.me\/595981123456\?text=/.test(logica.whatsappUrl('0981 123-456')));
check('whatsappUrl: mensaje exacto codificado',
    decodeURIComponent(logica.whatsappUrl('0981123456').split('?text=')[1]) === MSJ);
check('whatsappUrl: mensaje contiene el texto requerido',
    MSJ.includes('Soy el repartidor de Mi Barrio') && MSJ.includes('ya está en camino'));
check('whatsappUrl: número inválido da cadena vacía', logica.whatsappUrl('123') === '' && logica.whatsappUrl() === '');

check('creadoMs con toMillis', logica.creadoMs({ creado: { toMillis: () => 1234 } }) === 1234);
check('creadoMs con ms directo', logica.creadoMs({ creado: 777 }) === 777);
check('creadoMs sin dato da 0', logica.creadoMs({}) === 0 && logica.creadoMs(null) === 0);

// Ubicación (formato que guarda el TPV)
check('ubicación: URL de Maps en mapa', logica.ubicacionCliente({ mapa: 'https://maps.google.com/?q=test' }) === 'https://maps.google.com/?q=test');
check('ubicación: coordenadas', logica.ubicacionCliente({ lat: '25.29', lng: '-57.63' }) === 'https://maps.google.com/?q=25.29,-57.63');
check('ubicación: dirección como búsqueda', logica.ubicacionCliente({ direccion: 'Av. España 1234' }) === 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Av. España 1234'));
check('ubicación: sin datos da vacío', logica.ubicacionCliente({}) === '');

const p = {
    id: 'abc', numero: 7, estado: 'en_camino', total: 85000, pago: 'efectivo', pagado: false,
    cliente: { nombre: 'Ana <script>', celular: '0981123456', direccion: 'Av. España 1234' },
    creado: { toMillis: () => 1763300000000 }
};
const card = logica.renderTarjetaHTML(p);
check('tarjeta incluye número', card.includes('#7'));
check('tarjeta escapa nombre', card.includes('Ana &lt;script&gt;') && !card.includes('<script>Ana'));
check('tarjeta botón llamar internacional', card.includes('href="tel:+595981123456"'));
check('tarjeta botón WhatsApp', card.includes('https://wa.me/595981123456?text='));
check('tarjeta botón mapa', card.includes('maps/search'));
check('tarjeta muestra total', card.includes('85.000 Gs'));
check('tarjeta muestra pago', card.includes('Efectivo') && card.includes('Por cobrar'));
check('tarjeta pagada', logica.renderTarjetaHTML({ ...p, pagado: true }).includes('Cobrado'));

check('lista: ordena por creación (viejo primero)', (() => {
    const out = logica.ordenarPorCreacion([
        { id: 'nuevo', creado: { toMillis: () => 3000 } },
        { id: 'viejo', creado: { toMillis: () => 1000 } },
        { id: 'medio', creado: { toMillis: () => 2000 } }
    ]).map(x => x.id).join(',');
    return out === 'viejo,medio,nuevo';
})());

const vacio = logica.renderListaHTML([]);
check('sin pedidos: estado vacío', vacio.vacio === true && vacio.html === '');
check('con pedidos: sin estado vacío', logica.renderListaHTML([p]).vacio === false);

// Número inválido/ausente: sin Llamar y sin WhatsApp (el mapa no depende del teléfono)
const pTelefonoRaro = { ...p, cliente: { ...p.cliente, celular: '123' } };
const cardRaro = logica.renderTarjetaHTML(pTelefonoRaro);
check('teléfono inválido: sin botón llamar', !cardRaro.includes('href="tel:'));
check('teléfono inválido: sin botón WhatsApp', !cardRaro.includes('wa.me'));
check('teléfono inválido: mapa sigue visible', cardRaro.includes('maps'));
const pSinCel = { ...p, cliente: { nombre: 'Pedro', direccion: 'Calle Falsa 123' } };
const cardSin = logica.renderTarjetaHTML(pSinCel);
check('sin celular: sin llamar ni WhatsApp', !cardSin.includes('tel:') && !cardSin.includes('wa.me'));

// ===== Detalle desplegable =====
const pDetalle = {
    ...p,
    pizzas: [
        { tamano: 'grande', nombre: 'Grande + Mediana muzza gratis', sabores: ['Muzza', 'Fugazza'], borde: true, precio: 60000 },
        { tamano: 'mediano', nombre: 'Mediana', sabores: ['Calabresa'], borde: false, precio: 30000 }
    ],
    extras: [{ item: 'Coca Cola 1.5LT', cantidad: 1 }, { item: 'Papas', cantidad: 2 }],
    costoDelivery: 15000,
    cliente: { ...p.cliente, notas: 'Timbre roto' }
};
const cardDet = logica.renderTarjetaHTML(pDetalle);
check('detalle: botón Ver detalle presente', cardDet.includes('data-accion="detalle"'));
check('detalle: cerrado por defecto', /class="detalle hidden"/.test(cardDet) && /aria-expanded="false"/.test(cardDet));
check('detalle: pizzas reales', cardDet.includes('Pizza 1 – Grande + Mediana muzza gratis') && cardDet.includes('Pizza 2 – Mediana'));
check('detalle: sabores', cardDet.includes('Muzza, Fugazza') && cardDet.includes('Calabresa'));
check('detalle: borde relleno', (cardDet.match(/Borde relleno/g) || []).length === 1);
check('detalle: precios por pizza', cardDet.includes('60.000 Gs') && cardDet.includes('30.000 Gs'));
check('detalle: extras con cantidades', cardDet.includes('Coca Cola 1.5LT x1') && cardDet.includes('Papas x2'));
check('detalle: costo de delivery', cardDet.includes('Costo de delivery') && cardDet.includes('15.000 Gs'));
check('detalle: notas del cliente', cardDet.includes('Timbre roto'));
check('detalle: escapa HTML en sabores', logica.renderTarjetaHTML({ ...pDetalle, pizzas: [{ nombre: '<img src=x>', sabores: ['<b>'], precio: 1 }] }).includes('&lt;img src=x&gt;'));

const cardVacio = logica.renderTarjetaHTML({ ...p, pizzas: undefined, extras: undefined, costoDelivery: 0, cliente: { nombre: 'Sin detalle', celular: '0981123456' } });
check('detalle: pedido sin productos → mensaje neutro', cardVacio.includes('Sin detalle disponible'));

// ===== 2. Seguridad: la app solo lee =====
const appJs = leer('app.js');
const PROHIBIDAS = ['updateDoc', 'setDoc', 'addDoc', 'deleteDoc', 'runTransaction', 'writeBatch', 'getDocs', 'increment'];
PROHIBIDAS.forEach((fn) => check('app.js no usa ' + fn, !appJs.includes(fn)));
// serverTimestamp como función de escritura (el flag `serverTimestamps: 'estimate'` es lectura y es válido).
check('app.js no importa serverTimestamp', !/\bserverTimestamp\b/.test(appJs.replace(/serverTimestamps\s*:/g, '')));
check('app.js consulta estado en_camino', /where\(\s*['"]estado['"]\s*,\s*['"]==['"]\s*,\s*['"]en_camino['"]\s*\)/.test(appJs));
check('app.js no filtra por otro estado', !/['"](nuevo|preparacion|entregado|cancelado|archivado)['"]/.test(appJs.replace(/\/\/.*$/gm, '')));
const htmlRefs = [leer('index.html'), appJs, leer('logica.js')];
check('index.html no tiene botones para crear/cobrar/cancelar',
    !/crear pedido|cobrar|cancelar pedido|marcar entregado/i.test(htmlRefs[0]));
check('app.js: delegación del botón detalle', appJs.includes('[data-accion="detalle"]') && appJs.includes('aria-expanded'));

// ===== 3. PWA: manifest + iconos + sw =====
let manifest = null;
try { manifest = JSON.parse(leer('manifest.json')); } catch (e) { console.log('✖ manifest.json no es JSON válido:', e.message); fallas++; }
if (manifest) {
    check('manifest: nombre', typeof manifest.name === 'string' && manifest.name.length > 0);
    check('manifest: start_url y scope', manifest.start_url === '/mi-barrio-repartidor/' && manifest.scope === '/mi-barrio-repartidor/');
    check('manifest: display standalone', manifest.display === 'standalone');
    check('manifest: tema y fondo', !!manifest.theme_color && !!manifest.background_color);
    const iconos = manifest.icons || [];
    const hay192 = iconos.some((i) => i.sizes === '192x192' && existsSync(join(RAIZ, i.src)) && statSync(join(RAIZ, i.src)).size > 0);
    const hay512 = iconos.some((i) => i.sizes === '512x512' && existsSync(join(RAIZ, i.src)) && statSync(join(RAIZ, i.src)).size > 0);
    const hayMask = iconos.some((i) => i.purpose === 'maskable' && existsSync(join(RAIZ, i.src)) && statSync(join(RAIZ, i.src)).size > 0);
    check('manifest: icono 192x192 presente', hay192);
    check('manifest: icono 512x512 presente', hay512);
    check('manifest: icono maskable presente', hayMask);
    check('manifest: icon.svg presente', existsSync(join(RAIZ, 'icon.svg')));
}
check('apple-touch-icon.png presente', existsSync(join(RAIZ, 'apple-touch-icon.png')) && statSync(join(RAIZ, 'apple-touch-icon.png')).size > 0);

const indice = leer('index.html');
check('index.html: manifest enlazado', indice.includes('<link rel="manifest" href="./manifest.json">'));
check('index.html: theme-color', /<meta name="theme-color" content="#0b1728">/.test(indice));
check('index.html: viewport con viewport-fit', indice.includes('viewport-fit=cover'));
check('index.html: estado vacío presente', indice.includes('No hay pedidos en camino'));
check('index.html: formulario de login', indice.includes('id="form-login"'));
check('index.html: botón llamar usa tel:', leer('logica.js').includes('tel:'));
check('index.html: botón mapa abre Maps', leer('logica.js').includes('maps'));

const sw = leer('sw.js');
check('sw.js: no intercepta orígenes externos (Firebase)', sw.includes('url.origin !== self.location.origin'));
check('sw.js: cache del shell', sw.includes('./index.html') && sw.includes('./app.js') && sw.includes('./logica.js'));

// Sintaxis de app.js y sw.js (via copia temporal en .mjs)
for (const f of ['app.js', 'logica.js', 'sw.js']) {
    const tmp = join(RAIZ, f + '.check.mjs');
    writeFileSync(tmp, leer(f), 'utf8');
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); console.log('✔ ' + f + ': sintaxis válida'); }
    catch (e) { fallas++; console.log('✖ ' + f + ': error de sintaxis\n' + String(e.stderr)); }
    try { rmSync(tmp); } catch (e) { /* no es crítico */ }
}

console.log(fallas === 0 ? '\nTODO OK' : '\nFALLAS: ' + fallas);
process.exit(fallas === 0 ? 0 : 1);
