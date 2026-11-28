# Mi Barrio IA — asistente de pedidos del TPV Celular

Asistente que crea pedidos a partir de una instrucción escrita, dictada o una
captura de WhatsApp. Está integrado **solo** en `mi-barrio-tpv-celular/` y
reutiliza el alta manual existente. No modifica caja, estadísticas, inventario,
cocina ni impresión.

## Qué hace

1. El cajero toca el botón flotante **🤖 Mi Barrio IA**.
2. Escribe, dicta (micrófono del teclado / botón 🎤) o pega una captura de
   WhatsApp con algo como:
   *"dos muzza grandes con borde para retiro, paga en efectivo, Ana 0981 123 456"*.
3. La IA devuelve un pedido estructurado (productos, tipo, cliente, pago).
4. El TPV **valida contra el menú vivo** y calcula precios, descuentos y delivery
   con las mismas funciones del alta manual.
5. Se muestra el pedido completo y el total. Nada se guarda hasta tocar
   **✅ Confirmar pedido**.
6. Al confirmar se usa `guardarNuevo()`: numeración, memoria de clientes,
   snapshot comercial y comanda siguen exactamente el flujo actual.

Si la IA falla, el botón no aparece o el endpoint no responde, el alta manual
sigue funcionando igual. `ia.js` se carga con `import()` diferido.

## Privacidad y seguridad

- Las claves de OpenAI y Anthropic **nunca** llegan al navegador: viven en
  variables de entorno de Vercel.
- Cada consulta exige un **ID token de Firebase** y el endpoint verifica con
  Identity Toolkit que `localId === TPV_ADMIN_UID`.
- Solo se aceptan peticiones del mismo origen (o de `IA_ALLOWED_ORIGINS`).
- El navegador envía únicamente:
  - el catálogo compacto (ids, nombres, límites; **sin precios**),
  - el borrador actual (**sin el teléfono guardado del cliente**),
  - la última instrucción y las mesas disponibles.
- **Nunca** se envía la base de clientes ni el historial de conversación.
- El servidor registra en logs de Vercel el uid, proveedor, modelo, tokens y
  costo; no registra el texto del pedido ni datos del cliente.
- Hay límite de tamaño de cuerpo (32 KB), de instrucción (1200 caracteres) y de
  consultas por minuto (20 por administrador, en memoria del proceso).

## Configuración en Vercel

Variables obligatorias (comunes):

| Variable | Valor |
|----------|-------|
| `FIREBASE_WEB_API_KEY` | la misma `apiKey` pública del proyecto Firebase (`AIza...`) |
| `TPV_ADMIN_UID` | `e8czOfuF82VqPwNUZjMpOSMHUQo2` |

Variables de proveedor (elegí uno):

### OpenAI

| Variable | Valor |
|----------|-------|
| `IA_PROVIDER` | `openai` (default) |
| `OPENAI_API_KEY` | clave secreta de OpenAI |

### Anthropic (Claude)

| Variable | Valor |
|----------|-------|
| `IA_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | clave secreta de Anthropic |

Variables opcionales (ambas):

| Variable | Default OpenAI | Default Anthropic | Uso |
|----------|----------------|-------------------|-----|
| `OPENAI_MODEL` | `gpt-4o-mini` | — | modelo OpenAI |
| `ANTHROPIC_MODEL` | — | `claude-3-5-haiku-20241022` | modelo Anthropic |
| `OPENAI_PRICE_INPUT_PER_1M` | tabla interna | — | USD por 1M tokens entrada |
| `OPENAI_PRICE_OUTPUT_PER_1M` | tabla interna | — | USD por 1M tokens salida |
| `ANTHROPIC_PRICE_INPUT_PER_1M` | — | tabla interna | USD por 1M tokens entrada |
| `ANTHROPIC_PRICE_OUTPUT_PER_1M` | — | tabla interna | USD por 1M tokens salida |
| `OPENAI_MAX_OUTPUT_TOKENS` | `700` | — | tope respuesta OpenAI |
| `ANTHROPIC_MAX_OUTPUT_TOKENS` | — | `700` | tope respuesta Anthropic |
| `IA_ALLOWED_ORIGINS` | vacío | vacío | orígenes extra separados por coma |

El endpoint es `api/mi-barrio-ia.js` y se publica con el resto del sitio en
Vercel. `vercel.json` le da 30 segundos de ejecución. Si el proyecto se sirve
desde otro dominio, cambiá `endpoint` en `mi-barrio-tpv-celular/ia-config.js`.

### Desactivar sin tocar código

En `mi-barrio-tpv-celular/ia-config.js`:

```js
window.MBIA_CONFIG = Object.freeze({ endpoint: '/api/mi-barrio-ia', enabled: false });
```

El botón no se crea y el TPV sigue igual.

## Costo

Cada respuesta incluye `uso.tokensEntrada`, `uso.tokensSalida` y `uso.costoUsd`.
El celular acumula consultas, tokens y costo en `localStorage` y los muestra al
pie del asistente. Si el modelo no está en la tabla de precios, muestra
"costo no configurado" en vez de inventar un número.

El catálogo se envía en cada consulta porque es la fuente de verdad del menú
vigente; es pequeño (tamaños, sabores y extras) y no incluye precios.

### Precios de referencia (USD por 1M tokens)

**OpenAI** (actualizados 2025):
- gpt-4o-mini: entrada 0.15 / salida 0.60
- gpt-4.1-mini: entrada 0.40 / salida 1.60
- gpt-4.1-nano: entrada 0.10 / salida 0.40

**Anthropic** (actualizados 2025):
- claude-3-5-haiku-20241022: entrada 0.25 / salida 1.25
- claude-3-5-sonnet-20241022: entrada 3.00 / salida 15.00
- claude-3-7-sonnet-20250219: entrada 3.00 / salida 15.00
- claude-3-opus-20240229: entrada 15.00 / salida 75.00

## Prueba manual (cuando se autorice publicar)

1. Publicar el sitio con las variables de Vercel cargadas.
2. Entrar al TPV con el correo del administrador.
3. Tocar **🤖 Mi Barrio IA** y probar, en este orden:
   - retiro simple: *"una muzza grande, retiro, efectivo"*;
   - local: *"dos calabresa medianas para la mesa 2"*;
   - delivery con link largo de Google Maps;
   - un sabor inexistente (debe avisar, no inventar);
   - un pedido ya cobrado sin medio de pago (debe pedirlo).
4. Verificar que el total del asistente coincide con el del formulario manual.
5. Confirmar un pedido de prueba y comprobar numeración, comanda y cobro normal.
6. Revisar en los logs de Vercel el evento `mi_barrio_ia` con proveedor,
   modelo, tokens y costo.

No se hicieron pedidos reales, llamadas a IA, despliegues ni cambios de
reglas de Firestore durante la implementación.

## Archivos

- `mi-barrio-tpv-celular/ia.js` — UI, catálogo compacto, validación y cotización.
- `mi-barrio-tpv-celular/ia-config.js` — endpoint público y switch.
- `mi-barrio-tpv-celular/index.html` — botón flotante, adaptadores y llamada a `guardarNuevo`.
- `mi-barrio-tpv-celular/mobile.css` — estilos `mbia-*` acotados al TPV.
- `api/mi-barrio-ia.js` — endpoint Vercel (auth, OpenAI/Anthropic, esquema, costo).
- `tests/mi-barrio-ia.test.mjs` — pruebas sin red ni Firebase.

## Límites

- Solo crea pedidos. No cobra, no cambia estados, no cancela pedidos existentes.
- No aplica promociones web automáticamente: igual que el alta manual, solo
  acepta un descuento explícito con motivo.
- El dictado depende del navegador; si no hay reconocimiento de voz, se usa el
  micrófono del teclado.
- La calidad de interpretación depende del modelo elegido; el TPV siempre
  revalida productos, sabores, mesa, pago y delivery antes de mostrar el total.