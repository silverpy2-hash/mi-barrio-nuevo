# AGENTS.md — Mi Barrio

## 1. IDENTIDAD DEL PROYECTO

Este proyecto es **Mi Barrio**, una aplicación/sistema para la pizzería Mi Barrio.

IMPORTANTE:

- Este es el **proyecto original/simple de Mi Barrio**.
- NO confundirlo con MONTA APP.
- NO trasladar arquitectura, módulos ni estructura de MONTA APP a este proyecto.
- Mantener la arquitectura actual siempre que sea posible.
- Priorizar cambios pequeños, concretos y seguros.

---

## 2. REGLA PRINCIPAL DE TRABAJO

### NO MODIFICAR CÓDIGO SIN AUTORIZACIÓN

Cuando el usuario pida revisar, analizar, investigar, auditar, comprobar o explicar algo:

1. Leer y analizar el código necesario.
2. Identificar exactamente dónde está el comportamiento.
3. Explicar qué ocurre actualmente.
4. Indicar la causa concreta si existe un problema.
5. Proponer el cambio.
6. ESPERAR autorización antes de modificar archivos.

No hacer cambios "para probar".

No refactorizar código que no esté relacionado con el problema.

No cambiar varios archivos cuando un cambio puntual sea suficiente.

---

## 3. PRINCIPIO DE CAMBIOS MÍNIMOS

Cuando el usuario autorice un cambio:

- Modificar únicamente los archivos necesarios.
- No reescribir archivos completos innecesariamente.
- No cambiar estilos, nombres, funciones o estructuras que no estén relacionados.
- No introducir frameworks.
- No migrar la aplicación a otra arquitectura.
- No crear módulos nuevos salvo que sean realmente necesarios.
- Preservar el comportamiento existente que ya funciona.

Después del cambio informar:

- archivos modificados;
- qué se cambió;
- por qué;
- pruebas realizadas;
- si hubo commit/push o no.

NO hacer commit ni push salvo autorización expresa del usuario.

---

## 4. ARCHIVOS IMPORTANTES

La estructura actualmente conocida incluye:

- `index.html`
- `panel_nuevo.html`
- `reglas_firestore (2).txt`

Puede haber otros archivos/directorios que no estén presentes en esta lista.

NO asumir que esta lista está completa.

Antes de trabajar sobre una función concreta, revisar los archivos realmente existentes en el proyecto.

---

## 5. FIREBASE

El proyecto utiliza Firebase/Firestore.

Existe un archivo con las reglas de Firestore:

`reglas_firestore (2).txt`

Cuando un problema pueda estar relacionado con permisos, lecturas, escrituras, estados o datos de Firestore:

1. Revisar primero el código que realiza la operación.
2. Revisar las reglas de Firestore relacionadas.
3. Explicar si el problema está en el frontend, en Firestore o en ambos.
4. No modificar las reglas sin autorización.

Nunca asumir que una operación de Firestore funciona simplemente porque el código la solicita.

---

## 6. FLUJO DE PEDIDOS

El sistema tiene un flujo de pedidos entre cliente, panel, preparación/cocina, delivery/entregador y cobro.

Al investigar un problema de pedidos, seguir el dato desde:

1. creación del pedido;
2. datos guardados en Firestore;
3. estado del pedido;
4. lectura por `panel_nuevo.html`;
5. cambios realizados por el panel;
6. actualización de Firestore;
7. aparición/desaparición del pedido en las distintas pestañas.

No analizar únicamente la interfaz.

Hay que comprobar qué valores se guardan realmente.

---

## 7. REGLA IMPORTANTE: PEDIDO COBRADO

El comportamiento solicitado por el usuario es:

**Cuando un pedido queda COBRADO, debe pasar directamente al flujo de ENTREGADOR**, independientemente de la pestaña/etapa anterior en la que se encuentre el pedido.

Si se investiga o modifica este comportamiento:

- comprobar primero cómo se representa actualmente `cobrado`;
- comprobar qué campos de estado existen;
- comprobar qué hace el panel cuando recibe un cambio de cobro;
- comprobar qué consulta/query utiliza cada pestaña;
- evitar solucionar el problema únicamente ocultando o moviendo visualmente el pedido.

El objetivo es que el estado real guardado y el flujo del panel sean coherentes.

---

## 8. NUEVO PEDIDO / LOCAL / RETIRO / DELIVERY

Existe lógica para crear pedidos manualmente desde el panel.

Hay que prestar especial atención a no confundir:

- pedido para consumir/en el local;
- retiro;
- delivery;
- pedido creado desde el cliente;
- pedido creado manualmente desde el panel.

Si un pedido aparece en una categoría incorrecta:

1. revisar primero qué valor se guarda al crear el pedido;
2. revisar los campos `origen`, modalidad/tipo y estado si existen;
3. revisar cómo el panel interpreta esos valores;
4. comprobar el flujo completo antes de modificarlo.

No solucionar únicamente la presentación visual si el dato original está mal guardado.

---

## 9. COMPATIBILIDAD CON EL PROYECTO ACTUAL

Este proyecto ya funciona y tiene lógica de negocio existente.

Por eso:

- NO reemplazar la lógica de pizzas por una estructura genérica.
- NO convertirlo en MONTA APP.
- NO introducir una SPA.
- NO agregar backend innecesariamente.
- NO migrar Firebase.
- NO cambiar nombres de campos de Firestore sin analizar todas sus referencias.
- NO eliminar funciones antiguas simplemente porque parezcan innecesarias.

Si una función parece redundante, primero explicar y pedir autorización.

---

## 10. FORMA DE ANALIZAR

Cuando el usuario diga:

> "Analizá"

significa:

**solo lectura.**

No modificar archivos.

Cuando diga:

> "Revisá"

también tratarlo como auditoría de solo lectura salvo que indique expresamente que quiere implementar algo.

Cuando diga:

> "Implementá", "hacé el cambio", "modificá", "arreglá"

entonces sí está autorizando el cambio solicitado, pero solamente el cambio necesario.

Si hay riesgo de afectar otra parte del sistema, avisar antes.

---

## 11. ANTES DE CAMBIAR

Antes de modificar:

- localizar la función exacta;
- localizar dónde se llama;
- comprobar qué datos recibe;
- comprobar qué datos produce;
- revisar las referencias relevantes;
- determinar el cambio mínimo.

Si el problema puede estar causado por más de un archivo, indicarlo antes de tocar código.

---

## 12. DESPUÉS DE CAMBIAR

Después de una modificación:

1. Revisar el diff.
2. Comprobar que no se modificaron archivos innecesarios.
3. Ejecutar las pruebas disponibles si corresponde.
4. Si no hay pruebas automatizadas para esa parte, hacer una comprobación razonable y decirlo.
5. Informar exactamente qué cambió.

No afirmar que algo fue probado si no se probó.

No afirmar que fue publicado si no se hizo commit/push/deploy.

---

## 13. GIT

El repositorio utiliza Git.

Reglas:

- No hacer `git reset`, `git checkout`, `git clean` destructivo ni borrar trabajo del usuario sin autorización.
- No sobrescribir modificaciones existentes sin avisar.
- Antes de cambios importantes revisar el estado del repositorio.
- Después de cambios revisar `git diff`.
- No hacer commit automáticamente.
- No hacer push automáticamente.

Si el usuario pide explícitamente commit/push, hacerlo y reportar el resultado real.

---

## 14. ESTILO DE RESPUESTA

El usuario prefiere respuestas:

- directas;
- prácticas;
- claras;
- sin explicaciones innecesariamente largas;
- con archivos y líneas/funciones concretas cuando sea posible.

Cuando haya un problema, explicar preferentemente así:

### Causa
Qué está ocurriendo realmente.

### Dónde
Archivo + función/línea aproximada.

### Solución
Qué cambio mínimo se propone.

### Riesgo
Qué otra cosa podría verse afectada, si corresponde.

No llenar la respuesta con teoría si basta con explicar el comportamiento concreto.

---

## 15. REGLA DE ORO

**Primero entender. Después explicar. Después pedir/recibir autorización. Finalmente modificar lo mínimo necesario.**

La prioridad es conservar el proyecto Mi Barrio original funcionando y evitar cambios innecesarios.