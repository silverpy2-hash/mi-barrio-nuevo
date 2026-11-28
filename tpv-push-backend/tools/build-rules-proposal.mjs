// Generates firestore.rules.proposed.txt from the original rules file by
// copying it verbatim and splicing in exactly the S4 helper and the single
// alternative `allow update` inside `match /pedidos/{id}`.
// Run from the repository root: node tpv-push-backend/tools/build-rules-proposal.mjs
// This NEVER edits, moves or publishes the original rules file.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const originalPath = repoRoot + 'reglas_firestore (2).txt';
const proposedPath = fileURLToPath(new URL('../firestore.rules.proposed.txt', import.meta.url));

const original = readFileSync(originalPath, 'utf8').replace(/\r\n/g, '\n');

const eol = original.includes('\r\n') ? '\r\n' : '\n';
const withEol = (text) => text.replaceAll('\n', eol);
const helper = withEol(`
    // PROPOSED (S4, NOT APPLIED): narrow administrator paid-order handoff to
    // en_camino. Added by the TPV push backend proposal only. The original
    // transitions and the original esAdmin() update rule remain unchanged.
    // Requires: exact admin identity, previously unpaid order (missing pagado
    // counts as unpaid), target state en_camino, payment in efectivo/
    // transferencia/pos, cobradoEn == request.time, only payment/status
    // metadata keys changed, and sound recibido/vuelto for cash.
    // Grants nothing to any other role. Must be reviewed, applied and
    // emulator-verified manually before any client can use it.
    function esAdminCobroHandoff() {
      let prev = resource.data;
      let next = request.resource.data;
      return esAdmin()
        && prev.estado in ['nuevo', 'preparacion', 'en_camino', 'entregado']
        && next.estado == 'en_camino'
        && prev.get('pagado', false) == false
        && next.pagado == true
        && next.pago in ['efectivo', 'transferencia', 'pos']
        && next.cobradoEn == request.time
        && next.diff(prev).affectedKeys().hasOnly(['estado', 'pago', 'pagado', 'cobradoEn', 'recibido', 'vuelto'])
        && (next.pago == 'efectivo'
            ? (next.recibido is number && next.recibido >= next.total
               && next.vuelto is number && next.vuelto == next.recibido - next.total)
            : (next.recibido == null && next.vuelto == null));
    }
`);

const anchorCamarero = withEol(
  '        && get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.activo == true;\n    }\n');
const adminUpdate = withEol(
  '      allow update: if esAdmin()\n'
  + '                    && resource.data.get(\'cierreId\', null) == null\n'
  + '                    && (request.resource.data.estado == resource.data.estado\n'
  + '                        || estadoPermitido(resource.data.estado, request.resource.data.estado));\n');
const altUpdate = withEol(
  '      // PROPOSED (S4, NOT APPLIED): administrator paid-order handoff. See esAdminCobroHandoff().\n'
  + '      allow update: if esAdminCobroHandoff();\n');

if (!original.includes(anchorCamarero)) throw new Error('camarero anchor not found in original rules');
if (!original.includes(adminUpdate)) throw new Error('admin update anchor not found in original rules');

let proposed = original.replace(anchorCamarero, anchorCamarero + helper);
proposed = proposed.replace(adminUpdate, adminUpdate + altUpdate);
writeFileSync(proposedPath, proposed);
console.log(`wrote ${proposedPath} (${proposed.length} bytes); original untouched`);
