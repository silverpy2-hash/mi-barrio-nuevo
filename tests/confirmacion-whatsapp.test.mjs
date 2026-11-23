import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { page } from './helpers/pagina-cliente.mjs';

test('S1: pending TPV save does not open any popup or offer WhatsApp; acknowledgement enables a native link', async () => {
    const p = page(); p.run("seleccionarModalidad('retiro')");
    let release;
    p.context.window.guardarPedidoFirebase = d => { p.sent.push(d); return new Promise(r => { release = () => r({ id: d.intentoId }); }); };
    const pending = p.run("enviarPedido('efectivo')");
    try {
        assert.equal(p.sent.length, 1);
        assert.equal(p.opened.length, 0);
        assert.equal(p.get('confirmacion-whatsapp').style.display, 'none');
        assert.equal(p.run('abrirWhatsAppPedido()'), false);
    } finally { release(); await pending; }
    assert.equal(p.get('confirmacion-whatsapp').style.display, 'block');
    assert.match(p.get('confirmacion-whatsapp').href, /^https:\/\/wa\.me\/595986368904\?text=/);
    assert.match(decodeURIComponent(p.get('confirmacion-whatsapp').href), /Retiro en el local/);
    assert.equal(p.run('abrirWhatsAppPedido()'), true);
    assert.equal(p.opened.length, 0, 'the actual browser anchor, not script, navigates');
});
test('S2: sequential confirmation and message reopen reuse one stored attempt; new order is explicit', async () => {
    const p = page(); p.run("seleccionarModalidad('retiro')");
    await p.run("enviarPedido('efectivo')");
    const first = p.sent[0];
    await p.run("enviarPedido('efectivo')");
    p.run('abrirWhatsAppPedido()'); p.run('abrirWhatsAppPedido()');
    assert.equal(p.sent.length, 1);
    assert.equal(p.emails.length, 1);
    assert.match(first.mensaje, new RegExp(first.intentoId));
    p.context.confirm = () => false;
    p.run('iniciarNuevoPedido()');
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
    p.context.confirm = () => true;
    p.run('iniciarNuevoPedido()');
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 2);
    assert.notEqual(p.sent[1].intentoId, first.intentoId);
});
test('S2: same-tab reload recovers saved message without another write; failed retry keeps original ID and snapshot', async () => {
    const storage = new Map(), p = page({ storage }); p.run("seleccionarModalidad('retiro')");
    const original = p.context.window.guardarPedidoFirebase;
    const attempts = [];
    p.context.window.guardarPedidoFirebase = async d => { attempts.push(JSON.parse(JSON.stringify(d))); throw new Error('network'); };
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.run('window.PEDIDO_WEB_ENVIANDO'), false);
    assert.equal(p.get('confirmacion-whatsapp').style.display, 'none');
    const reloaded = page({ storage });
    reloaded.get('nombre').value = 'Changed after reload';
    reloaded.context.window.guardarPedidoFirebase = async d => { attempts.push(JSON.parse(JSON.stringify(d))); return { id: d.intentoId }; };
    await reloaded.run('reintentarConfirmacionPedido()');
    assert.equal(attempts[0].intentoId, attempts[1].intentoId);
    assert.equal(attempts[0].cliente.nombre, attempts[1].cliente.nombre);
    const saved = page({ storage });
    await saved.run("enviarPedido('efectivo')");
    assert.equal(saved.sent.length, 0);
    assert.equal(saved.emails.length, 0);
    assert.equal(saved.get('confirmacion-whatsapp').style.display, 'block');
    assert.equal(saved.run('abrirWhatsAppPedido()'), true);
});
test('S3: absent sessionStorage and popup support do not break a saved-order receipt or lock it', async () => {
    const p = page(); p.run("seleccionarModalidad('retiro')");
    p.context.window.sessionStorage = { getItem() { throw new Error('storage denied'); }, setItem() { throw new Error('storage denied'); } };
    p.context.window.open = () => { throw new Error('popups forbidden'); };
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
    assert.equal(p.run('window.PEDIDO_WEB_ENVIANDO'), false);
    assert.equal(p.run('abrirWhatsAppPedido()'), true);
    await p.run("enviarPedido('efectivo')");
    assert.equal(p.sent.length, 1);
});
test('S2: fixed-ID Firebase retry uses setDoc at the same document, never addDoc or private receipt fields', async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const a = html.indexOf('window.guardarPedidoFirebase ='), b = html.indexOf('    </script>', a);
    const calls = [], c = vm.createContext({ window: {}, db: {}, serverTimestamp: () => 'now', collection: () => 'pedidos',
        doc: (...v) => ({ id: v.at(-1), path: v.join('/') }),
        setDoc: async (ref, data) => { calls.push({ ref, data }); throw { code: 'permission-denied' }; },
        addDoc: async () => { throw new Error('addDoc must not run for a stable attempt'); } });
    vm.runInContext(html.slice(a, b), c);
    for (let i = 0; i < 2; i++) await assert.rejects(() => c.window.guardarPedidoFirebase({ intentoId: 'stable-attempt-123', tipo: 'retiro', total: 83000, costoDelivery: 0, mensaje: 'fake' }));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].ref.id, calls[1].ref.id);
    assert.equal('intentoId' in calls[0].data, false);
});
