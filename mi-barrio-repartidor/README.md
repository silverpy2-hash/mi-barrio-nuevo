# Mi Barrio · Repartidor

Aplicación móvil mínima para repartidores de Mi Barrio. **Solo lectura**: muestra los pedidos `en_camino` del TPV en tiempo real.

No crea, no cobra, no cancela ni modifica pedidos de ninguna manera (las reglas de Firestore tampoco lo permiten: escribe solo el administrador).

## Requisitos de Firebase (ya existen en el proyecto `mi-barrio-pedidos`)

- Cuenta de Firebase Authentication para cada repartidor, con correo que **contenga `delivery`** (ej. `delivery@mibarrio...`).
- Reglas de Firestore (`reglas_firestore (2).txt` en la raíz del proyecto): la lectura de `pedidos` está permitida para administradores y para correos `.*delivery.*`; la escritura solo para el administrador y con transiciones de estado hacia adelante/cancelar.

## Cómo levantarla en local

Es una app estática sin build. Desde la carpeta `mi-barrio-repartidor`:

```powershell
python -m http.server 8088
# o: npx serve -l 8088
```

Y abrí `http://localhost:8088/` en el navegador.

Requiere HTTPS (o localhost) para que funcionen el service worker y la instalación como PWA. Para usarla desde un celular en la misma red conviene hostearla en un dominio HTTPS (Firebase Hosting, por ejemplo).

## Instalación en el celular (antes del APK)

Chrome en Android → menú ⋮ → «Añadir a pantalla de inicio». Se abre en pantalla completa como una app.

## Enviar el resumen de un pedido por WhatsApp

1. Tocá **Enviar resumen** en el pedido correspondiente.
2. Revisá los datos y escribí el destinatario: un número paraguayo (por ejemplo, `0981 123456`) o un número internacional con código de país (por ejemplo, `+54 9 11 1234 5678`). No se selecciona automáticamente el teléfono del cliente.
3. Tocá **Abrir WhatsApp con el resumen** y confirmá el envío dentro de WhatsApp.

Incluye los datos registrados: número/fecha/estado/modalidad, mesa/origen si existen, cliente y contacto, dirección y ubicación, pizzas/sabores/borde, extras, delivery, importes, pago/cobro, recibido/vuelto y notas. No agrega precios que no estén guardados ni comparte identificadores internos. El texto se actualiza con la última lectura disponible y se elimina al cerrar la ventana, salir de la sesión o desaparecer el pedido.

El botón **WhatsApp** anterior conserva su aviso al cliente. El resumen es otra acción, permite cualquier destinatario válido y no modifica Firestore ni envía mensajes automáticamente. Revisá el número: el resumen contiene datos personales del cliente. La cuenta de destino debe usar WhatsApp; esta app no comprueba si está registrada.

## Pruebas

```powershell
node test.mjs
node --test resumen.test.mjs
```

Verifica: lógica de presentación (escapado, formato de moneda, ubicación, orden), consulta solo lectura sin funciones de escritura, manifest/iconos válidos, sintaxis de los tres scripts y requisitos mínimos de PWA.

## Empaquetado Android (APK/AAB)

### Opción A: PWA con Bubblewrap (recomendada)

La app ya es una PWA válida (`manifest.json`, iconos 192/512 + maskable, service worker, `theme-color`, `display: standalone`). Bubblewrap (Google) la empaqueta en un APK/AAB nativo sin cambiar el código:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://tu-dominio.https/mi-barrio-repartidor/manifest.json
bubblewrap build
```

Necesitás que esté hospedada en una URL HTTPS pública. El instalador genera el AAB listo para Play Store o sideloading.

### Opción B: Capacitor

```bash
npm init -y && npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npx cap init "Mi Barrio Repartidor" com.mibarrio.repartidor --web-dir=.
npx cap add android
npx cap sync android
npx cap open android   # compilar el APK en Android Studio
```

## Estructura

| Archivo | Rol |
|---|---|
| `index.html` | Login (Firebase Auth) + lista de entregas |
| `app.js` | Firebase init, auth, `onSnapshot` de `pedidos` filtrado por `estado == 'en_camino'` |
| `logica.js` | Funciones puras sin Firebase (formateo, ubicación, tarjetas) |
| `styles.css` | Diseño móvil, botones ≥ 56 px, sin frameworks |
| `manifest.json` / `sw.js` | PWA: instalación + shell offline (Firebase nunca se cachea) |
| `icon.svg` + PNG | Iconos 192 / 512 / maskable / apple-touch-icon |
| `test.mjs` | Pruebas automáticas (Node) |

## Datos mostrados (y por qué)

Sale del documento `pedidos` que escribe el TPV: número (`numero`), cliente (`cliente.nombre`, `cliente.celular`, `cliente.direccion`, `cliente.lat/lng`, `cliente.mapa`, `cliente.notas`), `total`, forma de pago (`pago`), estado de cobro (`pagado`), `creado` para ordenar por llegada, y los productos: `pizzas[]` (`nombre/tamano`, `sabores`, `borde`, `precio`), `extras[]` (`item`, `cantidad`) y `costoDelivery`. El detalle se despliega con el botón «Ver detalle» (cerrado por defecto). El enlace «Ver ubicación» solo aparece si hay alguna de las tres fuentes; Llamar/WhatsApp solo si el celular es válido (se normaliza a formato `595XXXXXXXXX`).
