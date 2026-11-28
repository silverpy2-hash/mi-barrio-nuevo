# Caja, estadísticas y costos

## Activación

1. Publicar manualmente las reglas de `tpv-push-backend/firestore.rules.proposed.txt`: incluyen la protección económica y conservan el pase de cobro a entregador del TPV celular. `reglas_firestore (2).txt` también contiene la protección económica, pero no ese pase adicional.
2. Publicar juntos ambos TPV, `comercial/` y el cliente actualizado. No hubo publicación ni cambios en Firebase durante la implementación.
3. Entrar como administrador a **Caja → Costos e insumos**, revisar referencias y guardar la primera versión. Configurar corte de jornada (inicialmente 05:00, America/Asuncion).
4. Completar precios faltantes, densidad del aceite, rendimiento de masa, recetas por tamaño, sabores, bordes, extras y envases. Marcar una receta como completa solo después de comprobar todos sus ingredientes. Vacío o `?` es desconocido; `0` significa cero confirmado.

## Uso

- **Caja actual:** cobros reales separados de ventas, gastos clasificados y medio de salida. Un pedido entregado pero no cobrado permanece abierto. Antes de cerrar, finalizar/cancelar los pedidos en curso ya cobrados.
- **Cerrar:** se revalidan pedidos, gastos y fondo en una transacción. Un pedido/gasto no entra en dos cierres. La numeración continúa, evitando colisiones con pedidos nuevos. El efectivo contado es opcional. La confirmación de gastos completos se conserva en el cierre, no es una configuración global retroactiva.
- **Estadísticas:** fechas por jornada, comparación con período anterior, canales/modalidades/productos/categorías, promociones, regalos, sabores, demanda, clientes y márgenes. Filtro de producto selecciona pedidos completos; no prorratea gastos generales.
- **Cargar más:** páginas de 500 documentos por colección. No interpretar el historial parcial como total definitivo. Actualizar vuelve a cargar desde el principio. El Historial tradicional muestra hasta 200 cierres; Estadísticas permite cargar todas las páginas.
- **Compras:** registrar en Costos e insumos crea movimiento y gasto de compra atómicamente. No repetir esa compra en Caja. La compra afecta dinero/stock, no se vuelve a restar como costo consumido.
- **Reparto:** completar costo real desde Estadísticas → Pedidos → Completar. Para registrar su pago usar gasto **Pago de reparto ya imputado (solo caja)**: afecta caja, no duplica el costo. **Reparto no asignado** es un costo adicional no cargado en pedidos.
- **Stock:** cantidades en g/ml/unidades. Entradas y ajustes menos consumo capturado = saldo teórico. Conteo físico es una observación independiente; registrar ajuste por la diferencia si corresponde. Merma positiva produce salida negativa y costo no monetario automático (no salida de caja), con precio congelado o pendiente si falta. No sumar capacidades de productos que comparten stock.
- **Exportar:** CSV UTF-8 con separador `;`, importable en Excel, y JSON económico. Las filas de promociones pueden solaparse: no se suman como ventas independientes.

## Qué se conserva

`config/comercial` es privado. `comercial_config` conserva versiones inmutables; `comercial_pedidos/{pedidoId}` conserva precios, descuentos, líneas, categorías, recetas, precios de insumos, costos conocidos y jornada. Al cierre queda bloqueado junto con `cierres`. `comercial_stock` es un registro de movimientos sin borrado. Las reglas impiden reescribir/borrar cierres y economía cerrada; el TPV deshabilita el borrado masivo comercial.

Los pedidos nuevos del TPV guardan economía en la misma transacción. Web/QR guardan únicamente metadatos adicionales (origen, categoría y precio de extras): no cambian precios, promociones ni interfaz. El administrador captura sus costos al recibirlos. Si no hay una versión de costos comprobable anterior al pedido, no se inventa un costo histórico; se señala el faltante. El cliente sigue sin autoridad de servidor sobre precios, como antes: esto no introduce un backend de validación de ventas.

## Límites honestos

- Pedidos/cierres viejos sin desglose, categoría, estado anterior o fecha de cobro se muestran incompletos; no se reconstruyen con valores actuales. Los cierres originales siguen consultables y no se suman otra vez a los pedidos.
- Ventas se agrupan por jornada del pedido; cobros/devoluciones por fecha de registro. Los cobros antiguos sin fecha se informan sin asignar un día ficticio. No se implementa contabilidad fiscal ni pagos parciales.
- Mezclas sin proporciones confirmadas usan partes iguales **estimadas**. Regalos solo se cuentan cuando están registrados explícitamente o identificados en el nombre guardado de la promoción. No se inventa el precio de venta individual del regalo.
- Sin costos completos, costo de reparto de cada delivery y gastos certificados no se confirma ganancia neta ni punto de equilibrio. Margen de producto no es ganancia neta. Proyecciones son promedios del historial cargado, no pronósticos garantizados.
- El cierre transaccional está acotado a 440 escrituras (aproximadamente 200 pedidos con sus snapshots, según gastos) y tamaño seguro de documentos. No hay cierre distribuido de jornadas que excedan ese límite.
- Costos/versiones necesitan conexión y reglas nuevas. No hay movimientos monetarios offline ni dependencias pesadas. CSV compatible con Excel, no formato `.xlsx` nativo.
- Los costos de receta usan la versión de precios configurada; una compra no cambia automáticamente esos precios ni aplica FIFO/promedio ponderado. Los ajustes de inventario no generan una valorización automática. Gastos antiguos abiertos sin clase/medio deben completarse con **Editar**, sin suponer efectivo.

## Comprobación rápida

1. Crear un pedido TPV/WhatsApp con descuento y motivo, un retiro web y un delivery web. Confirmar que precios/promociones siguen iguales y que solo el delivery manual cobra siempre su tarifa.
2. Comparar bruto − descuento + delivery con total; comprobar precios de extras, regalos, pendiente y cobrado.
3. Registrar compra por transferencia y gasto en efectivo: solo el segundo reduce el arqueo efectivo. Completar reparto y pagar usando la clase correcta.
4. Cerrar caja desde dos terminales sobre los mismos pedidos: solo un cierre debe prosperar. Confirmar fondo, diferencia, gastos y pedidos pendientes conservados.
5. Cambiar precios de insumos: el cierre anterior y sus recetas/costos deben permanecer iguales. Revisar/exportar por fecha, canal y modalidad en PC y celular.
6. Verificar recetas incompletas: nunca deben aparecer como ganancia neta confirmada. Registrar entrada, merma y conteo físico; comparar contra saldo teórico.

Pruebas automáticas: `node --test tests/comercial.test.mjs tests/comercial-persistencia.test.mjs` (aritmética y adaptador transaccional en memoria). `tests/fixtures/comercial.html` es una demostración de interfaz con datos ficticios, sin Firebase. Las reglas se verifican estáticamente; no sustituye una prueba con el emulador de reglas ni la validación manual sobre Firebase.
