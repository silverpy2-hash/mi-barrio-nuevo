/* ==========================================================================
   MI BARRIO — Firestore en memoria para pruebas (Etapa 1)
   --------------------------------------------------------------------------
   No reemplaza al emulador oficial de Firebase. Implementa lo mínimo para
   probar la orquestación de cuentas por mesa con concurrencia optimista:
     - versiona cada documento leído,
     - si otro "dispositivo" lo modificó antes del commit, reintenta la
       transacción completa (igual que runTransaction de Firestore).
   ========================================================================== */

function clonar(valor) {
  if (valor === undefined) return undefined;
  return JSON.parse(JSON.stringify(valor));
}

export class FirestoreEnMemoria {
  constructor() {
    this.documentos = new Map(); // "coleccion/id" -> { datos, version }
    this.secuencia = 0;
    this.intentos = 0;
  }

  sembrar(coleccion, id, datos) {
    this.documentos.set(coleccion + '/' + id, { datos: clonar(datos), version: 1 });
    return this;
  }

  leer(coleccion, id) {
    const doc = this.documentos.get(coleccion + '/' + id);
    return doc ? clonar(doc.datos) : null;
  }

  listar(coleccion) {
    const prefijo = coleccion + '/';
    return [...this.documentos.entries()]
      .filter(([clave]) => clave.startsWith(prefijo))
      .map(([clave, doc]) => ({
        id: clave.slice(prefijo.length),
        ...clonar(doc.datos)
      }));
  }

  contar(coleccion) {
    return this.listar(coleccion).length;
  }

  claves() {
    return [...this.documentos.keys()];
  }

  // Solo para preparar escenarios de prueba (simula lo que haría el TPV).
  modificar(coleccion, id, datos) {
    const clave = coleccion + '/' + id;
    const actual = this.documentos.get(clave);
    this.documentos.set(clave, {
      datos: { ...(actual ? actual.datos : {}), ...clonar(datos) },
      version: (actual ? actual.version : 0) + 1
    });
    return this;
  }

  async transaccion(fn, { maxIntentos = 50 } = {}) {
    let ultimoConflicto = '';
    for (let intento = 0; intento < maxIntentos; intento++) {
      this.intentos++;
      const leidos = new Map();
      const escrituras = [];

      const tx = {
        leer: async (coleccion, id) => {
          // Cede el turno para que dos transacciones puedan intercalarse.
          await Promise.resolve();
          const clave = coleccion + '/' + id;
          const actual = this.documentos.get(clave);
          leidos.set(clave, actual ? actual.version : 0);
          return actual
            ? { existe: true, datos: clonar(actual.datos) }
            : { existe: false, datos: null };
        },
        nuevoId: (coleccion) => {
          this.secuencia += 1;
          return coleccion + '-' + this.secuencia;
        },
        // Igual que tx.set() de Firestore: reemplaza el documento completo.
        guardar: (coleccion, id, datos) => {
          escrituras.push({ tipo: 'guardar', coleccion, id, datos: clonar(datos) });
        },
        // Igual que tx.set(..., { merge: true }): mezcla con lo existente.
        actualizar: (coleccion, id, datos) => {
          escrituras.push({ tipo: 'actualizar', coleccion, id, datos: clonar(datos) });
        }
      };

      const resultado = await fn(tx);

      let conflicto = false;
      for (const [clave, version] of leidos) {
        const actual = this.documentos.get(clave);
        const versionActual = actual ? actual.version : 0;
        if (versionActual !== version) {
          conflicto = true;
          ultimoConflicto = clave + ' (leída v' + version + ', actual v' + versionActual + ')';
          break;
        }
      }

      if (conflicto) continue; // reintenta con una lectura nueva

      for (const escritura of escrituras) {
        const clave = escritura.coleccion + '/' + escritura.id;
        const actual = this.documentos.get(clave);
        if (escritura.tipo === 'guardar') {
          this.documentos.set(clave, {
            datos: clonar(escritura.datos),
            version: (actual ? actual.version : 0) + 1
          });
        } else {
          this.documentos.set(clave, {
            datos: { ...(actual ? actual.datos : {}), ...clonar(escritura.datos) },
            version: (actual ? actual.version : 0) + 1
          });
        }
      }

      return resultado;
    }

    throw new Error('FirestoreEnMemoria: la transacción agotó los reintentos (' + ultimoConflicto + ')');
  }
}
