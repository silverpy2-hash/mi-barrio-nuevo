/* Copia las reglas propuestas (raíz del repo) al directorio del emulador.
   El emulador de Firebase exige que el archivo de reglas esté dentro de su
   propio directorio de proyecto, por eso no puede apuntar a ../../
   Este archivo generado NO es el original: el original es
   reglas_firestore_etapa1.txt en la raíz del repositorio. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const origen = fileURLToPath(new URL('../../reglas_firestore_etapa1.txt', import.meta.url));
const destino = fileURLToPath(new URL('../pruebas-reglas/firestore.rules', import.meta.url));

writeFileSync(destino, readFileSync(origen, 'utf8'), 'utf8');
console.log('[reglas] sincronizadas desde reglas_firestore_etapa1.txt');
