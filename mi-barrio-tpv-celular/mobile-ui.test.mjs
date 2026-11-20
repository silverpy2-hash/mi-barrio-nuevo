// Mi Barrio - TPV Celular · Mobile navigation shell tests (S5 / T5).
// Run: node --test mi-barrio-tpv-celular/mobile-ui.test.mjs
//
// No DOM package is installed in this repository and no framework may be added, so this
// file ships a tiny, deterministic DOM fixture implementing only the APIs the controller
// uses. That gives real event dispatch / MutationObserver behaviour without a browser:
// original control listeners, bubbling clicks, attribute observation, focus and inert.
//
// The tests are behavioural: they build the real control structure (same ids/classes as
// index.html), mount the module, then interact through clicks/keyboard and assert the
// observable effects. Source-level checks only guard the integration seams.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    MOBILE_BREAKPOINT,
    NAV_ITEMS,
    TOOL_ITEMS,
    EMPTY_MESSAGES,
    mirrorToolState,
    classifyListState,
    buildStatus,
    nextFocusTarget,
    isMobileViewport,
    initializeMobileUi,
} from './mobile-ui.js';

import {
    CASES,
    FRAME_WIDTHS,
    buildPreviewHtml,
    buildFramesHtml,
    resolvePreviewDir,
    generatePreview,
} from './tools/preview-mobile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = HERE;
const REPO_ROOT = resolve(HERE, '..');
const read = (p) => readFileSync(join(APP_ROOT, p), 'utf8');

// ===========================================================================
// Tiny DOM fixture
// ===========================================================================
class FakeClassList {
    constructor(el) { this.el = el; }
    _read() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    add(...names) {
        const set = new Set(this._read());
        names.forEach((n) => { if (n) set.add(n); });
        this._write([...set]);
    }
    remove(...names) {
        const set = new Set(this._read());
        names.forEach((n) => set.delete(n));
        this._write([...set]);
    }
    toggle(name, force) {
        const has = this.contains(name);
        const next = force === undefined ? !has : !!force;
        if (next === has) return next;
        if (next) this.add(name); else this.remove(name);
        return next;
    }
    contains(name) { return this._read().includes(name); }
    _write(names) {
        const value = names.join(' ');
        if (value === (this.el.getAttribute('class') || '')) return;
        this.el._setAttrRaw('class', value);
        this.el._notify('attributes', 'class');
    }
}

class FakeElement {
    constructor(doc, tagName) {
        this.ownerDocument = doc;
        this.tagName = tagName;
        this._attrs = new Map();
        this._children = [];
        this._text = '';
        this._html = null;
        this._listeners = new Map();
        this._disabled = false;
        this._inert = false;
        this._hidden = false;
        this.parentNode = null;
        this.classList = new FakeClassList(this);
    }
    get id() { return this._attrs.get('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this._attrs.get('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    // A real DOM returns an HTMLCollection: iterable and indexable, but WITHOUT
    // find/filter/map. `_htmlCollection` opts an element into that stricter shape so the
    // fixture can catch controller code that treats .children as an Array.
    get children() {
        if (!this._htmlCollection) return this._children;
        const list = this._children;
        const collection = { length: list.length };
        list.forEach((child, index) => { collection[index] = child; });
        collection[Symbol.iterator] = () => list[Symbol.iterator]();
        return collection;
    }
    get textContent() {
        return String(this._text) + this._children.map((c) => c.textContent).join('');
    }
    set textContent(value) {
        this._text = String(value == null ? '' : value);
        this._html = null;
        this._children.forEach((c) => { c.parentNode = null; });
        this._children = [];
        this._notify('childList');
        this._notify('characterData');
    }
    get innerHTML() { return this._html == null ? this.textContent : this._html; }
    set innerHTML(value) {
        this._html = String(value);
        this._text = '';
        this._children.forEach((c) => { c.parentNode = null; });
        this._children = [];
        this._notify('childList');
    }
    get hidden() { return this._hidden; }
    set hidden(value) {
        const next = !!value;
        if (next === this._hidden) return;
        this._hidden = next;
        this._notify('attributes', 'hidden');
    }
    get disabled() { return this._disabled; }
    set disabled(value) {
        const next = !!value;
        if (next === this._disabled) return;
        this._disabled = next;
        this._notify('attributes', 'disabled');
    }
    get inert() { return this._inert; }
    set inert(value) { this._inert = !!value; }
    setAttribute(name, value) {
        const key = String(name);
        const text = String(value);
        this._setAttrRaw(key, text);
        if (key === 'id') this.ownerDocument._registerId(this, text);
        if (key === 'class') {
            // classList reads lazily from the attribute, nothing else to sync.
        }
        this._notify('attributes', key);
    }
    _setAttrRaw(name, value) {
        if (value == null) this._attrs.delete(name);
        else this._attrs.set(name, String(value));
    }
    getAttribute(name) {
        const key = String(name);
        if (key === 'class') return this._attrs.get('class') || '';
        if (key === 'hidden') return this._hidden ? '' : null;
        if (key === 'disabled') return this._disabled ? '' : null;
        return this._attrs.has(key) ? this._attrs.get(key) : null;
    }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    removeAttribute(name) {
        const key = String(name);
        if (key === 'hidden') { this.hidden = false; return; }
        if (key === 'disabled') { this.disabled = false; return; }
        if (!this._attrs.has(key)) return;
        this._setAttrRaw(key, null);
        this._notify('attributes', key);
    }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, ref) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const index = ref ? this._children.indexOf(ref) : -1;
        if (index === -1) this._children.push(child);
        else this._children.splice(index, 0, child);
        child.parentNode = this;
        this._html = null;
        this._notify('childList');
        return child;
    }
    removeChild(child) {
        const index = this._children.indexOf(child);
        if (index === -1) return child;
        this._children.splice(index, 1);
        child.parentNode = null;
        this._notify('childList');
        return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(node) {
        if (this === node) return true;
        return this._children.some((c) => c.contains(node));
    }
    addEventListener(type, fn) {
        const list = this._listeners.get(type) || [];
        if (!list.includes(fn)) list.push(fn);
        this._listeners.set(type, list);
    }
    removeEventListener(type, fn) {
        const list = this._listeners.get(type) || [];
        this._listeners.set(type, list.filter((x) => x !== fn));
    }
    dispatchEvent(event) {
        event.target = event.target || this;
        let node = this;
        while (node) {
            event.currentTarget = node;
            const list = node._listeners.get(event.type) || [];
            for (const fn of [...list]) fn.call(node, event);
            if (event._stopped) break;
            node = node.parentNode;
        }
        return !event.defaultPrevented;
    }
    click() {
        const event = makeEvent('click');
        return this.dispatchEvent(event);
    }
    focus() { this.ownerDocument._active = this; }
    blur() { if (this.ownerDocument._active === this) this.ownerDocument._active = null; }
    scrollIntoView() { this.ownerDocument._lastScrolled = this; }
    _notify(kind, name) { this.ownerDocument._notify(this, kind, name); }
}

function makeEvent(type, extra = {}) {
    const event = {
        type,
        bubbles: true,
        defaultPrevented: false,
        _stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this._stopped = true; },
        ...extra,
    };
    return event;
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.target = null;
        this.options = {};
        this._active = false;
    }
    observe(target, options) {
        this.target = target;
        this.options = options || {};
        this._active = true;
        target.ownerDocument._observers.add(this);
    }
    disconnect() {
        this._active = false;
        if (this.target) this.target.ownerDocument._observers.delete(this);
    }
    takeRecords() { return []; }
}

class FakeDocument {
    constructor() {
        this._byId = new Map();
        this._observers = new Set();
        this._listeners = new Map();
        this._active = null;
        this._lastScrolled = null;
        this.readyState = 'complete';
        this.defaultView = null;
        this.documentElement = this.createElement('html');
        this.body = this.createElement('body');
        this.documentElement.appendChild(this.body);
    }
    createElement(tag) { return new FakeElement(this, String(tag).toUpperCase()); }
    createTextNode(text) {
        const el = this.createElement('#text');
        el.textContent = text;
        return el;
    }
    getElementById(id) {
        const node = this._byId.get(String(id));
        return node && this.documentElement.contains(node) ? node : null;
    }
    contains(node) { return this.documentElement.contains(node); }
    addEventListener(type, fn) {
        const list = this._listeners.get(type) || [];
        if (!list.includes(fn)) list.push(fn);
        this._listeners.set(type, list);
    }
    removeEventListener(type, fn) {
        const list = this._listeners.get(type) || [];
        this._listeners.set(type, list.filter((x) => x !== fn));
    }
    dispatchEvent(event) {
        const list = this._listeners.get(event.type) || [];
        for (const fn of [...list]) fn.call(this, event);
        return !event.defaultPrevented;
    }
    get activeElement() { return this._active; }
    _registerId(el, id) { if (id) this._byId.set(String(id), el); }
    _notify(el, kind, name) {
        for (const observer of [...this._observers]) {
            if (!observer._active || !observer.target) continue;
            const target = observer.target;
            const opts = observer.options || {};
            const inTree = target === el || (opts.subtree && target.contains(el));
            if (!inTree) continue;
            if (kind === 'attributes' && !opts.attributes) continue;
            if (kind === 'childList' && !opts.childList) continue;
            if (kind === 'characterData' && !opts.characterData) continue;
            if (kind === 'attributes' && opts.attributeFilter && name
                && !opts.attributeFilter.includes(name)) continue;
            observer.callback([{ type: kind, target: el, attributeName: name }], observer);
        }
    }
}

class FakeWindow {
    constructor(doc) {
        this.document = doc;
        this.innerWidth = 390;
        this.navigator = { onLine: true };
        this._listeners = new Map();
        this.warnings = [];
        this.MutationObserver = FakeMutationObserver;
        this.console = { warn: (...args) => this.warnings.push(args.join(' ')), info() {}, error() {} };
        doc.defaultView = this;
    }
    addEventListener(type, fn) {
        const list = this._listeners.get(type) || [];
        if (!list.includes(fn)) list.push(fn);
        this._listeners.set(type, list);
    }
    removeEventListener(type, fn) {
        const list = this._listeners.get(type) || [];
        this._listeners.set(type, list.filter((x) => x !== fn));
    }
    dispatch(type, extra = {}) {
        const event = makeEvent(type, extra);
        for (const fn of [...(this._listeners.get(type) || [])]) fn.call(this, event);
        return event;
    }
}

// ===========================================================================
// App fixture (same ids/classes as the real panel)
// ===========================================================================
const ADMIN_TOOL_IDS = [
    'btn-local', 'btn-local-auto', 'btn-autoprint', 'btn-agotados', 'btn-config',
    'btn-cocina', 'btn-rapida', 'btn-sonido', 'btn-notif', 'btn-salir', 'btn-apariencia',
    'btn-nuevo', 'btn-caja',
];

function el(doc, tag, attrs = {}, className = '') {
    const node = doc.createElement(tag);
    if (attrs.id) node.id = attrs.id;
    if (attrs.type) node.setAttribute('type', attrs.type);
    if (attrs.aria) for (const [k, v] of Object.entries(attrs.aria)) node.setAttribute(k, v);
    if (className) node.className = className;
    return node;
}

function buildAppDom({ panelHidden = false, localOpen = true } = {}) {
    const doc = new FakeDocument();
    const win = new FakeWindow(doc);
    const counts = {};
    let lastDispatchSheetHidden = null;
    let lastDispatchActiveInsideSheet = null;

    const bump = (id) => { counts[id] = (counts[id] || 0) + 1; lastDispatchSheetHidden = doc.getElementById('tpv-tools-sheet') ? doc.getElementById('tpv-tools-sheet').hidden : null; const sheet = doc.getElementById('tpv-tools-sheet'); lastDispatchActiveInsideSheet = sheet ? sheet.hidden === false && sheet.contains(doc.activeElement) : null; };

    // login (must never receive mobile chrome)
    const login = el(doc, 'section', { id: 'login' }, 'min-h-screen flex items-center justify-center px-4');
    const form = el(doc, 'form', { id: 'form-login' });
    form.appendChild(el(doc, 'input', { id: 'email' }));
    login.appendChild(form);
    doc.body.appendChild(login);

    // panel
    const panel = el(doc, 'section', { id: 'panel' }, panelHidden ? 'hidden' : '');
    const headerPanel = el(doc, 'header', { id: 'header-panel' }, 'bg-red-700 text-white');
    const firstRow = el(doc, 'div', {}, 'w-full flex items-center justify-between');
    firstRow.appendChild(el(doc, 'h1', { id: 'titulo-panel' })).textContent = '🍕 Mi Barrio - TPV Celular';
    firstRow.appendChild(el(doc, 'p', { id: 'contador' })).textContent = 'Cargando...';
    const acciones = el(doc, 'div', { id: 'acciones-panel' }, 'flex items-center gap-2');
    const version = el(doc, 'span', { id: 'version-panel' });
    acciones.appendChild(version);

    const buttons = new Map();
    for (const id of ADMIN_TOOL_IDS) {
        const b = el(doc, 'button', { id, type: 'button' });
        b.textContent = id;
        if (id === 'btn-apariencia') b.classList.add('hidden');
        if (id === 'btn-local-auto') b.classList.add('hidden');
        if (id === 'btn-notif') {
            b.textContent = '🔔 Notif. activas';
            b.setAttribute('aria-pressed', 'true');
            b.setAttribute('data-push-estado', 'active');
        }
        b.addEventListener('click', () => bump(id));
        buttons.set(id, b);
        acciones.appendChild(b);
    }
    const mas = el(doc, 'button', { id: 'btn-mas', type: 'button', aria: { 'aria-expanded': 'false' } });
    mas.textContent = '⋯ Más';
    acciones.appendChild(mas);
    firstRow.appendChild(acciones);
    headerPanel.appendChild(firstRow);
    const menuMas = el(doc, 'div', { id: 'menu-mas' }, 'hidden');
    menuMas.appendChild(el(doc, 'div', { id: 'menu-mas-cuerpo' }));
    headerPanel.appendChild(menuMas);
    const filtros = el(doc, 'nav', { id: 'filtros' });
    for (const [key, label] of [['todos', 'Todos'], ['nuevo', 'Nuevos'], ['preparacion', 'En prep.']]) {
        const f = el(doc, 'button', { type: 'button' }, 'shrink-0');
        f.setAttribute('data-filtro', key);
        f.textContent = label;
        filtros.appendChild(f);
    }
    headerPanel.appendChild(filtros);
    panel.appendChild(headerPanel);

    const main = el(doc, 'main', {}, 'w-full');
    const avisoError = el(doc, 'p', { id: 'aviso-error' }, 'hidden');
    main.appendChild(avisoError);
    const lista = el(doc, 'div', { id: 'lista' });
    main.appendChild(lista);
    panel.appendChild(main);

    // local state label (original writes .local-estado/.local-modo through innerHTML)
    const localEstado = el(doc, 'span', {}, 'local-estado');
    localEstado.textContent = localOpen ? '🟢 ABIERTO' : '🔴 CERRADO';
    const localModo = el(doc, 'span', {}, 'local-modo block');
    localModo.textContent = 'Automático';
    buttons.get('btn-local').appendChild(localEstado);
    buttons.get('btn-local').appendChild(localModo);

    doc.body.appendChild(panel);

    // Original modals (outside #panel, like the real app)
    const modals = {};
    for (const id of ['modal-nuevo', 'modal-caja', 'modal-config', 'modal-apariencia', 'modal-agotados', 'vista-cocina']) {
        const m = el(doc, 'div', { id }, 'hidden');
        // mock open/close wiring, mirroring the original listeners' visible effect
        if (id === 'modal-nuevo') buttons.get('btn-nuevo').addEventListener('click', () => m.classList.remove('hidden'));
        if (id === 'modal-caja') buttons.get('btn-caja').addEventListener('click', () => m.classList.remove('hidden'));
        if (id === 'modal-config') buttons.get('btn-config').addEventListener('click', () => m.classList.remove('hidden'));
        if (id === 'modal-apariencia') buttons.get('btn-apariencia').addEventListener('click', () => m.classList.remove('hidden'));
        if (id === 'modal-agotados') buttons.get('btn-agotados').addEventListener('click', () => m.classList.remove('hidden'));
        if (id === 'vista-cocina') buttons.get('btn-cocina').addEventListener('click', () => m.classList.remove('hidden'));
        if (id === 'modal-nuevo') {
            const c = el(doc, 'button', { id: 'nuevo-cerrar', type: 'button' });
            c.addEventListener('click', () => m.classList.add('hidden'));
            m.appendChild(c);
        }
        modals[id] = m;
        doc.body.appendChild(m);
    }

    doc.body.classList.add('tpv-mobile-ui');

    return {
        doc, win, panel, login, headerPanel, acciones, menuMas, filtros, lista, avisoError,
        buttons, mas, modals, counts,
        dispatchSnapshot: () => ({ sheetHidden: lastDispatchSheetHidden, activeInsideSheet: lastDispatchActiveInsideSheet }),
    };
}

function mount(dom) {
    const controller = initializeMobileUi({ document: dom.doc, window: dom.win });
    assert.ok(controller, 'controller should mount against the fixture');
    return controller;
}

function renderEmpty(doc, text = EMPTY_MESSAGES[0]) {
    const list = doc.getElementById('lista');
    list.innerHTML = '';
    const p = doc.createElement('p');
    p.className = 'text-center text-neutral-500 py-10';
    p.textContent = text;
    list.appendChild(p);
    return p;
}

function renderCards(doc, n = 2) {
    const list = doc.getElementById('lista');
    list.innerHTML = '';
    const cards = [];
    for (let i = 0; i < n; i += 1) {
        const article = doc.createElement('article');
        article.className = 'bg-white rounded-2xl shadow-sm border pedido-card';
        article.setAttribute('data-estado', 'nuevo');
        const head = doc.createElement('div');
        head.className = 'pedido-head';
        head.textContent = `Pizza ${i + 1} · Cliente de prueba con nombre largo`;
        article.appendChild(head);
        list.appendChild(article);
        cards.push(article);
    }
    return cards;
}

// ===========================================================================
// Pure helpers
// ===========================================================================
test('NAV_ITEMS exposes the four mobile destinations with Spanish labels', () => {
    assert.deepEqual(NAV_ITEMS.map((i) => i.nav), ['pedidos', 'nuevo', 'caja', 'mas']);
    assert.deepEqual(NAV_ITEMS.map((i) => i.label), ['Pedidos', 'Nuevo', 'Caja', 'Más']);
    assert.equal(NAV_ITEMS.find((i) => i.nav === 'nuevo').targetId, 'btn-nuevo');
    assert.equal(NAV_ITEMS.find((i) => i.nav === 'caja').targetId, 'btn-caja');
    assert.equal(MOBILE_BREAKPOINT, 899);
});

test('TOOL_ITEMS keeps every original administrator control reachable', () => {
    const ids = TOOL_ITEMS.map((t) => t.targetId);
    for (const id of ADMIN_TOOL_IDS) {
        assert.ok(ids.includes(id), `the More sheet must proxy ${id}`);
    }
    assert.equal(new Set(ids).size, ids.length, 'no duplicate targets');
    const labels = Object.fromEntries(TOOL_ITEMS.map((t) => [t.targetId, t.label]));
    assert.equal(labels['btn-config'], 'Configuración');
    assert.equal(labels['btn-notif'], 'Notificaciones');
    assert.equal(labels['btn-local'], 'Estado del local');
    assert.equal(labels['btn-salir'], 'Salir');
});

test('mirrorToolState reads permission/disabled/aria-pressed state only', () => {
    const doc = new FakeDocument();
    const visible = doc.createElement('button');
    assert.deepEqual(mirrorToolState(visible), { hidden: false, disabled: false, pressed: null });

    const byClass = doc.createElement('button');
    byClass.classList.add('hidden');
    assert.equal(mirrorToolState(byClass).hidden, true);

    const byAttr = doc.createElement('button');
    byAttr.hidden = true;
    assert.equal(mirrorToolState(byAttr).hidden, true);

    const byAria = doc.createElement('button');
    byAria.setAttribute('aria-hidden', 'true');
    assert.equal(mirrorToolState(byAria).hidden, true);

    const disabled = doc.createElement('button');
    disabled.disabled = true;
    assert.equal(mirrorToolState(disabled).disabled, true);

    const pressed = doc.createElement('button');
    pressed.setAttribute('aria-pressed', 'true');
    assert.equal(mirrorToolState(pressed).pressed, true);
    pressed.setAttribute('aria-pressed', 'false');
    assert.equal(mirrorToolState(pressed).pressed, false);

    assert.equal(mirrorToolState(null).hidden, true);
    assert.equal(mirrorToolState(undefined).disabled, true);
});

test('classifyListState distinguishes loading, empty, orders and error', () => {
    const doc = new FakeDocument();
    const make = (tag, text) => {
        const n = doc.createElement(tag);
        n.textContent = text;
        return n;
    };
    assert.equal(classifyListState({ listChildren: [] }), 'loading');
    assert.equal(classifyListState({ listChildren: [make('p', EMPTY_MESSAGES[0])] }), 'empty');
    assert.equal(classifyListState({ listChildren: [make('p', EMPTY_MESSAGES[1])] }), 'empty');
    assert.equal(classifyListState({ listChildren: [make('article', 'pedido')] }), 'orders');
    assert.equal(classifyListState({ listChildren: [make('p', 'texto nuevo del render')] }), 'other');
    assert.equal(classifyListState({ listChildren: [], errorText: 'sin permiso' }), 'error');
    assert.equal(classifyListState({ listChildren: [make('article', 'pedido')], errorText: 'sin permiso' }), 'error');
    // A decoration CTA alone never counts as content.
    const cta = make('button', '➕ Nuevo pedido');
    cta.setAttribute('data-tpv-empty-cta', '1');
    assert.equal(classifyListState({ listChildren: [cta] }), 'loading');
});

test('buildStatus never claims Firebase connectivity and separates offline/error/loading', () => {
    const offline = buildStatus({ online: false });
    assert.equal(offline.tone, 'offline');
    assert.match(offline.text, /Sin conexión/);
    assert.doesNotMatch(offline.text, /Conectado|Firebase|online/i);

    const online = buildStatus({ online: true });
    assert.equal(online.tone, 'none');
    assert.equal(online.text, '');

    const error = buildStatus({ online: true, errorText: 'Falló Firestore' });
    assert.equal(error.tone, 'error');
    assert.match(error.text, /Error/);

    const loading = buildStatus({ online: true, loading: true });
    assert.equal(loading.tone, 'loading');
    assert.match(loading.text, /Cargando pedidos/);

    const local = buildStatus({ online: true, localText: '🟢 ABIERTO' });
    assert.equal(local.tone, 'local');
    assert.match(local.text, /🟢 ABIERTO/);

    const both = buildStatus({ online: false, localText: '🔴 CERRADO', loading: true });
    assert.equal(both.tone, 'offline');
    assert.match(both.text, /Sin conexión/);
    assert.match(both.text, /🔴 CERRADO/);
});

test('nextFocusTarget traps Tab inside the sheet', () => {
    const items = ['close', 'a', 'b'];
    assert.equal(nextFocusTarget(items, 2, false), 'close');
    assert.equal(nextFocusTarget(items, 0, true), 'b');
    assert.equal(nextFocusTarget(items, -1, false), 'close');
    assert.equal(nextFocusTarget(items, -1, true), 'b');
    assert.equal(nextFocusTarget(items, 1, false), null);
    assert.equal(nextFocusTarget([], 0, false), null);
});

test('isMobileViewport uses the 899px shared breakpoint', () => {
    assert.equal(isMobileViewport({ innerWidth: 320 }), true);
    assert.equal(isMobileViewport({ innerWidth: 768 }), true);
    assert.equal(isMobileViewport({ innerWidth: 899 }), true);
    assert.equal(isMobileViewport({ innerWidth: 900 }), false);
    assert.equal(isMobileViewport({ innerWidth: 1280 }), false);
    assert.equal(isMobileViewport({}), true);
});

// ===========================================================================
// Mount / structure
// ===========================================================================
test('mount builds header, bottom navigation and accessible More sheet inside #panel', () => {
    const dom = buildAppDom();
    mount(dom);
    const doc = dom.doc;

    const header = doc.getElementById('tpv-mobile-header');
    assert.ok(header, 'mobile header exists');
    assert.ok(dom.panel.contains(header), 'header lives inside #panel (login gate intact)');
    assert.ok(!dom.login.contains(header), 'login must never receive the mobile chrome');
    assert.ok(header.textContent.includes('Mi Barrio'));
    assert.ok(header.textContent.includes('TPV administrador'));
    assert.ok(header.children.some((c) => c.classList.contains('tpv-brand')));
    assert.ok(header.children.some((c) => c.classList.contains('tpv-status')));
    assert.equal(doc.getElementById('tpv-mobile-status').getAttribute('role'), 'status');

    const nav = doc.getElementById('tpv-mobile-nav');
    assert.ok(dom.panel.contains(nav));
    const navButtons = nav.children.filter((c) => c.classList.contains('tpv-nav-item'));
    assert.deepEqual(navButtons.map((b) => b.getAttribute('data-nav')), ['pedidos', 'nuevo', 'caja', 'mas']);
    assert.deepEqual(navButtons.map((b) => b.textContent.replace(/\s+/g, ' ').trim()), ['Pedidos', 'Nuevo', 'Caja', 'Más']);
    assert.equal(navButtons[0].getAttribute('aria-current'), 'page');
    for (const b of navButtons) {
        assert.ok(b.children.some((c) => c.classList.contains('tpv-icon')), 'inline icon present');
        assert.ok(b.children.some((c) => c.classList.contains('tpv-nav-label')));
    }

    const sheet = doc.getElementById('tpv-tools-sheet');
    const backdrop = doc.getElementById('tpv-tools-backdrop');
    assert.ok(sheet && backdrop);
    assert.ok(dom.panel.contains(sheet) && dom.panel.contains(backdrop));
    assert.equal(sheet.hidden, true);
    assert.equal(backdrop.hidden, true);
    assert.equal(sheet.getAttribute('role'), 'dialog');
    assert.equal(sheet.getAttribute('aria-modal'), 'true');
    assert.equal(sheet.getAttribute('aria-labelledby'), 'tpv-tools-title');
    assert.equal(doc.getElementById('tpv-tools-title').textContent, 'Más herramientas');
    assert.ok(doc.getElementById('tpv-tools-close'));

    const grid = doc.getElementById('tpv-tools-grid');
    const proxies = grid.children.filter((c) => c.classList.contains('tpv-tool'));
    for (const tool of TOOL_ITEMS) {
        const proxy = proxies.find((p) => p.getAttribute('data-tool-target') === tool.targetId);
        assert.ok(proxy, `proxy for ${tool.targetId}`);
        assert.ok(proxy.children.some((c) => c.classList.contains('tpv-icon')));
        assert.ok(proxy.children.some((c) => c.classList.contains('tpv-tool-label')));
    }
    assert.equal(proxies.length, TOOL_ITEMS.length);
});

test('ready marker is added only after a successful mount; missing panel falls back', () => {
    const dom = buildAppDom();
    assert.equal(dom.doc.body.classList.contains('tpv-mobile-ready'), false);
    mount(dom);
    assert.equal(dom.doc.body.classList.contains('tpv-mobile-ready'), true);
    assert.equal(dom.doc.body.classList.contains('tpv-mobile-ui'), true);
    assert.equal(dom.doc.body.getAttribute('data-tpv-mobile-ui'), 'ready');

    const bare = new FakeDocument();
    const bareWin = new FakeWindow(bare);
    bare.body.classList.add('tpv-mobile-ui');
    const none = initializeMobileUi({ document: bare, window: bareWin });
    assert.equal(none, null);
    assert.equal(bare.body.classList.contains('tpv-mobile-ready'), false);
});

test('mount never reparents original controls', () => {
    const dom = buildAppDom();
    const before = new Map([...dom.buttons].map(([id, node]) => [id, node.parentNode]));
    mount(dom);
    for (const [id, node] of dom.buttons) {
        assert.equal(node.parentNode, before.get(id), `${id} keeps its original parent`);
    }
});

// ===========================================================================
// Permission / state mirroring
// ===========================================================================
test('hidden and disabled originals stay visible-but-blocked proxies', () => {
    const dom = buildAppDom();
    const { doc, buttons } = dom;
    mount(dom);
    const grid = doc.getElementById('tpv-tools-grid');
    const apariencia = grid.children.find((p) => p.getAttribute('data-tool-target') === 'btn-apariencia');
    assert.equal(apariencia.hidden, true, 'role-hidden tool is hidden, not lying');
    assert.equal(apariencia.disabled, true);

    const config = grid.children.find((p) => p.getAttribute('data-tool-target') === 'btn-config');
    assert.equal(config.hidden, false);
    assert.equal(config.disabled, false);

    buttons.get('btn-config').classList.add('hidden');
    assert.equal(config.hidden, true, 'observer mirrors permission changes');

    const configNode = doc.getElementById('tpv-tools-grid').children.find((p) => p.getAttribute('data-tool-target') === 'btn-config');
    const before = dom.counts['btn-config'] || 0;
    configNode.click();
    assert.equal(dom.counts['btn-config'] || 0, before, 'blocked proxy dispatches nothing');

    buttons.get('btn-config').classList.remove('hidden');
    assert.equal(config.hidden, false);

    buttons.get('btn-caja').disabled = true;
    const caja = grid.children.find((p) => p.getAttribute('data-tool-target') === 'btn-caja');
    assert.equal(caja.disabled, true);
    const cajaBefore = dom.counts['btn-caja'] || 0;
    caja.click();
    assert.equal(dom.counts['btn-caja'] || 0, cajaBefore);
    buttons.get('btn-caja').disabled = false;
});

test('notifications readiness and local state are mirrored, not invented', () => {
    const dom = buildAppDom({ localOpen: true });
    const { doc, buttons } = dom;
    mount(dom);
    const grid = doc.getElementById('tpv-tools-grid');
    const notif = grid.children.find((p) => p.getAttribute('data-tool-target') === 'btn-notif');
    assert.equal(notif.getAttribute('aria-pressed'), 'true');
    assert.match(notif.textContent, /Notif\. activas/);
    assert.match(notif.getAttribute('aria-label'), /Notificaciones/);

    const local = grid.children.find((p) => p.getAttribute('data-tool-target') === 'btn-local');
    assert.match(local.textContent, /🟢 ABIERTO/);
    assert.match(doc.getElementById('tpv-mobile-status').textContent, /ABIERTO/);

    // The original paints new copies through innerHTML; the observer must follow.
    const estado = buttons.get('btn-local').children.find((c) => c.classList.contains('local-estado'));
    estado.textContent = '🔴 CERRADO';
    assert.match(doc.getElementById('tpv-mobile-status').textContent, /CERRADO/);
    assert.match(local.textContent, /🔴 CERRADO/);

    buttons.get('btn-notif').textContent = '🔔 Notif.: falta configurar';
    buttons.get('btn-notif').setAttribute('aria-pressed', 'false');
    buttons.get('btn-notif').setAttribute('data-push-estado', 'pending');
    assert.equal(notif.getAttribute('aria-pressed'), 'false');
    assert.match(notif.textContent, /falta configurar/);
});

// ===========================================================================
// Navigation / dispatch
// ===========================================================================
test('each nav destination dispatches its original control exactly once', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    const nav = doc.getElementById('tpv-mobile-nav');
    const byNav = (name) => nav.children.find((c) => c.getAttribute('data-nav') === name);

    byNav('nuevo').click();
    assert.equal(dom.counts['btn-nuevo'], 1);
    assert.equal(dom.modals['modal-nuevo'].classList.contains('hidden'), false);
    byNav('nuevo').click();
    assert.equal(dom.counts['btn-nuevo'], 2);

    byNav('caja').click();
    assert.equal(dom.counts['btn-caja'], 1, 'Caja dispatches once');

    byNav('pedidos').click();
    assert.equal(doc.activeElement, doc.getElementById('lista'), 'Pedidos focuses the list');
    assert.equal(doc.getElementById('lista').getAttribute('tabindex'), '-1');
    // Existing filter state is not silently reset.
    assert.deepEqual(dom.filtros.children.map((f) => f.getAttribute('data-filtro')), ['todos', 'nuevo', 'preparacion']);
    assert.equal(dom.filtros.children[0].className, 'shrink-0');
});

test('Nuevo/Caja are transient actions, not the permanently selected page', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    const nav = doc.getElementById('tpv-mobile-nav');
    const nuevo = nav.children.find((c) => c.getAttribute('data-nav') === 'nuevo');
    const pedidos = nav.children.find((c) => c.getAttribute('data-nav') === 'pedidos');

    nuevo.click();
    assert.equal(nuevo.getAttribute('aria-expanded'), 'true');
    assert.equal(pedidos.getAttribute('aria-current'), 'page');

    dom.modals['modal-nuevo'].classList.add('hidden');
    assert.equal(nuevo.getAttribute('aria-expanded'), 'false');
    assert.equal(pedidos.getAttribute('aria-current'), 'page');
    assert.equal(nuevo.hasAttribute('aria-current'), false);
});

test('the More sheet opens from the bottom bar and every proxy reaches its control', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    const nav = doc.getElementById('tpv-mobile-nav');
    const mas = nav.children.find((c) => c.getAttribute('data-nav') === 'mas');
    mas.click();
    const sheet = doc.getElementById('tpv-tools-sheet');
    assert.equal(sheet.hidden, false);

    const expected = {
        'btn-config': 'btn-config', 'btn-cocina': 'btn-cocina', 'btn-rapida': 'btn-rapida',
        'btn-agotados': 'btn-agotados', 'btn-sonido': 'btn-sonido', 'btn-notif': 'btn-notif',
        'btn-salir': 'btn-salir', 'btn-local': 'btn-local', 'btn-local-auto': 'btn-local-auto',
        'btn-autoprint': 'btn-autoprint', 'btn-apariencia': 'btn-apariencia',
        'btn-nuevo': 'btn-nuevo', 'btn-caja': 'btn-caja',
    };
    for (const [target] of Object.entries(expected)) {
        const proxy = doc.getElementById('tpv-tools-grid').children
            .find((p) => p.getAttribute('data-tool-target') === target);
        assert.ok(proxy, `proxy ${target}`);
        if (proxy.hidden || proxy.disabled) continue; // role hidden or disabled: never dispatch
        const before = dom.counts[target] || 0;
        if (!proxy.hidden) { mas.click(); proxy.click(); }
        assert.equal(dom.counts[target] || 0, before + 1, `${target} dispatched exactly once through the sheet`);
        // Close whatever the fixture opened so the next tool starts from the list.
        for (const m of Object.values(dom.modals)) m.classList.add('hidden');
    }
});

test('sheet closes before the original action runs so the original modal owns focus', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'mas').click();
    const proxy = doc.getElementById('tpv-tools-grid').children.find((p) => p.getAttribute('data-tool-target') === 'btn-config');
    proxy.click();
    const snap = dom.dispatchSnapshot();
    assert.equal(snap.sheetHidden, true, 'sheet is closed before target.click()');
    assert.equal(snap.activeInsideSheet, false, 'focus is not trapped in the closed sheet');
    assert.equal(doc.getElementById('tpv-tools-sheet').hidden, true);
    assert.equal(doc.getElementById('header-panel').inert, false, 'background unlocked before the original modal');
});

// ===========================================================================
// Sheet accessibility: focus entry/trap/return, Escape, backdrop, inert
// ===========================================================================
test('opening the sheet traps focus, inerts the background and Escape restores focus', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    const mas = doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'mas');
    mas.focus();
    mas.click();

    const sheet = doc.getElementById('tpv-tools-sheet');
    const backdrop = doc.getElementById('tpv-tools-backdrop');
    assert.equal(sheet.hidden, false);
    assert.equal(backdrop.hidden, false);
    assert.equal(doc.body.classList.contains('tpv-sheet-open'), true);
    assert.equal(doc.activeElement, doc.getElementById('tpv-tools-close'), 'focus enters the sheet');
    for (const node of [dom.headerPanel, dom.panel.children.find((c) => c.tagName === 'MAIN'), doc.getElementById('tpv-mobile-header'), doc.getElementById('tpv-mobile-nav')]) {
        assert.equal(node.inert, true, 'background is inert while the sheet is visible');
    }
    assert.equal(sheet.inert, false);

    // Unrelated modal open (cannot normally happen, but must not be closed by the sheet).
    dom.modals['modal-config'].classList.remove('hidden');

    const escape = makeEvent('keydown', { key: 'Escape' });
    doc.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(sheet.hidden, true);
    assert.equal(backdrop.hidden, true);
    assert.equal(doc.activeElement, mas, 'focus returns to the Más button');
    assert.equal(doc.body.classList.contains('tpv-sheet-open'), false);
    for (const node of [dom.headerPanel, doc.getElementById('tpv-mobile-nav')]) assert.equal(node.inert, false);
    assert.equal(dom.modals['modal-config'].classList.contains('hidden'), false, 'unrelated modal untouched');
});

test('backdrop click closes the sheet and restores focus', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    const mas = doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'mas');
    mas.focus();
    mas.click();
    doc.getElementById('tpv-tools-backdrop').click();
    assert.equal(doc.getElementById('tpv-tools-sheet').hidden, true);
    assert.equal(doc.activeElement, mas);
});

test('Tab cycles inside the sheet instead of escaping to the page', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'mas').click();
    const close = doc.getElementById('tpv-tools-close');
    const enabled = doc.getElementById('tpv-tools-grid').children.filter((p) => !p.hidden && !p.disabled);
    const last = enabled[enabled.length - 1];
    last.focus();
    const forward = makeEvent('keydown', { key: 'Tab' });
    doc.dispatchEvent(forward);
    assert.equal(forward.defaultPrevented, true);
    assert.equal(doc.activeElement, close, 'Tab from the last control wraps to the close button');

    close.focus();
    const backward = makeEvent('keydown', { key: 'Tab', shiftKey: true });
    doc.dispatchEvent(backward);
    assert.equal(backward.defaultPrevented, true);
    assert.equal(doc.activeElement, last, 'Shift+Tab from the first control wraps to the last');
});

test('opening the sheet twice does not duplicate listeners or state', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    const controller = mount(dom);
    const mas = doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'mas');
    mas.click();
    controller.openSheet();
    assert.equal(doc.getElementById('tpv-tools-sheet').hidden, false);
    doc.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));
    assert.equal(doc.getElementById('tpv-tools-sheet').hidden, true, 'one Escape closes once');
});

// ===========================================================================
// Empty / loading / error states
// ===========================================================================
test('the real no-orders render is decorated, never replaced', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    assert.match(doc.getElementById('tpv-mobile-status').textContent, /Cargando pedidos/);

    const p = renderEmpty(doc);
    assert.equal(p.classList.contains('tpv-empty-state'), true, 'empty node is decorated in place');
    const cta = doc.getElementById('lista').children.find((c) => c.classList.contains('tpv-empty-cta'));
    assert.ok(cta, 'CTA added next to the real empty node');
    assert.equal(p.parentNode, doc.getElementById('lista'));
    assert.match(doc.getElementById('tpv-mobile-status').textContent, /ABIERTO/);
    assert.doesNotMatch(doc.getElementById('tpv-mobile-status').textContent, /Cargando pedidos/);

    const before = dom.counts['btn-nuevo'] || 0;
    cta.click();
    assert.equal(dom.counts['btn-nuevo'] || 0, before + 1, 'CTA dispatches the original Nuevo control');
    assert.deepEqual(dom.filtros.children.map((f) => f.getAttribute('data-filtro')), ['todos', 'nuevo', 'preparacion']);
});

test('cards are left byte-for-byte alone and never show an empty state', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    const cards = renderCards(doc, 3);
    const snapshot = cards.map((c) => ({ node: c, parent: c.parentNode, className: c.className, text: c.textContent }));
    dom.doc.getElementById('lista').children.forEach(() => {});
    // Force a sync through an observed mutation.
    doc.getElementById('aviso-error').classList.remove('hidden');
    doc.getElementById('aviso-error').textContent = '';
    doc.getElementById('aviso-error').classList.add('hidden');
    const list = doc.getElementById('lista');
    assert.equal(list.children.filter((c) => c.classList.contains('tpv-empty-state')).length, 0);
    assert.equal(list.children.filter((c) => c.classList.contains('tpv-empty-cta')).length, 0);
    snapshot.forEach((s) => {
        assert.equal(s.node.parentNode, s.parent);
        assert.equal(s.node.className, s.className);
        assert.equal(s.node.textContent, s.text);
    });
});

test('mount survives real HTMLCollection children (no Array methods on .children)', () => {
    const dom = buildAppDom();
    const doc = dom.doc;
    const empty = renderEmpty(doc);
    const lista = doc.getElementById('lista');
    lista._htmlCollection = true;
    assert.equal(typeof lista.children.find, 'undefined', 'the fixture really behaves like an HTMLCollection');
    assert.equal(typeof lista.children.filter, 'undefined');

    const controller = initializeMobileUi({ document: doc, window: dom.win });
    assert.ok(controller, 'mount must not throw when .children is an HTMLCollection');
    assert.equal(doc.body.classList.contains('tpv-mobile-ready'), true);
    assert.equal(empty.classList.contains('tpv-empty-state'), true, 'empty node decorated in place');
    assert.ok(lista._children.some((n) => n.classList.contains('tpv-empty-cta')), 'CTA added');
    assert.ok(lista._children.includes(empty), 'the real empty node is never removed');
    assert.match(doc.getElementById('tpv-mobile-status').textContent, /ABIERTO|Cargando/);
});

test('loading and error states are distinguishable and never claim zero orders', () => {
    const dom = buildAppDom();
    const { doc } = dom;
    mount(dom);
    const list = doc.getElementById('lista');
    assert.equal(list.children.length, 0);
    assert.equal(list.children.filter((c) => c.classList.contains('tpv-empty-cta')).length, 0);
    assert.match(doc.getElementById('tpv-mobile-status').textContent, /Cargando pedidos/);

    const aviso = doc.getElementById('aviso-error');
    aviso.classList.remove('hidden');
    aviso.textContent = 'No se pudieron cargar los pedidos: permission-denied';
    assert.match(doc.getElementById('tpv-mobile-status').textContent, /Error al cargar los pedidos/);
    assert.equal(list.children.filter((c) => c.classList.contains('tpv-empty-cta')).length, 0);

    aviso.classList.add('hidden');
    renderEmpty(doc);
    assert.equal(list.children.filter((c) => c.classList.contains('tpv-empty-cta')).length, 1);
});

test('offline is explicit and never derived into a fake connected state', () => {
    const dom = buildAppDom();
    const { doc, win } = dom;
    win.navigator.onLine = false;
    mount(dom);
    const status = doc.getElementById('tpv-mobile-status');
    assert.equal(status.getAttribute('data-tone'), 'offline');
    assert.match(status.textContent, /Sin conexión/);
    assert.doesNotMatch(status.textContent, /Conectado|Firebase|online/i);

    win.navigator.onLine = true;
    win.dispatch('online');
    assert.equal(status.getAttribute('data-tone'), 'local');
    assert.doesNotMatch(status.textContent, /Conectado|Firebase/);
});

// ===========================================================================
// Theme / reparent robustness, idempotency, cleanup
// ===========================================================================
test('theme moves and hidden toolbar ancestors do not break proxies', () => {
    const dom = buildAppDom();
    const { doc, buttons } = dom;
    mount(dom);
    const proxy = () => doc.getElementById('tpv-tools-grid').children.find((p) => p.getAttribute('data-tool-target') === 'btn-config');

    // Theme "moderno" moves originals into #menu-mas-cuerpo; identity is stable.
    const menuBody = doc.getElementById('menu-mas-cuerpo');
    menuBody.appendChild(buttons.get('btn-config'));
    // The CSS hides the original action row on mobile; that must NOT disable proxies.
    dom.acciones.classList.add('hidden');
    assert.equal(proxy().hidden, false, 'ancestor CSS hiding is not a permission signal');
    assert.equal(proxy().disabled, false);
    const before = dom.counts['btn-config'] || 0;
    proxy().click();
    assert.equal(dom.counts['btn-config'] || 0, before + 1);

    // Observer still follows the moved node.
    buttons.get('btn-config').disabled = true;
    assert.equal(proxy().disabled, true);
    buttons.get('btn-config').disabled = false;
    assert.equal(proxy().disabled, false);
});

test('initialize is idempotent and dispose fully restores the original page', () => {
    const dom = buildAppDom();
    const first = mount(dom);
    const second = initializeMobileUi({ document: dom.doc, window: dom.win });
    assert.equal(second, first, 'second mount returns the same controller');
    assert.equal(dom.panel.children.filter((c) => c.id === 'tpv-mobile-nav').length, 1);

    const nav = dom.doc.getElementById('tpv-mobile-nav');
    nav.children.find((c) => c.getAttribute('data-nav') === 'nuevo').click();
    assert.equal(dom.counts['btn-nuevo'], 1, 'no duplicated listeners');

    dom.doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'mas').click();
    first.dispose();
    assert.equal(dom.doc.getElementById('tpv-mobile-header'), null);
    assert.equal(dom.doc.getElementById('tpv-mobile-nav'), null);
    assert.equal(dom.doc.getElementById('tpv-tools-sheet'), null);
    assert.equal(dom.doc.getElementById('tpv-tools-backdrop'), null);
    assert.equal(dom.doc.body.classList.contains('tpv-mobile-ready'), false);
    assert.equal(dom.doc.getElementById('header-panel').inert, false, 'inert cleared');
    assert.equal(dom.doc.getElementById('lista').getAttribute('tabindex'), null);
    assert.doesNotThrow(() => first.dispose());

    const again = initializeMobileUi({ document: dom.doc, window: dom.win });
    assert.ok(again && again !== first);
    dom.doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'nuevo').click();
    assert.equal(dom.counts['btn-nuevo'], 2);
});

test('resizing to a desktop width closes the sheet and unlocks the page', () => {
    const dom = buildAppDom();
    const { doc, win } = dom;
    mount(dom);
    doc.getElementById('tpv-mobile-nav').children.find((c) => c.getAttribute('data-nav') === 'mas').click();
    assert.equal(doc.getElementById('tpv-tools-sheet').hidden, false);

    win.innerWidth = 1280;
    win.dispatch('resize');
    assert.equal(doc.getElementById('tpv-tools-sheet').hidden, true);
    assert.equal(doc.body.classList.contains('tpv-sheet-open'), false);
    assert.equal(doc.getElementById('header-panel').inert, false);

    win.innerWidth = 390;
    win.dispatch('resize');
    assert.equal(doc.getElementById('tpv-tools-sheet').hidden, true, 'resizing back does not reopen anything');
});

// ===========================================================================
// Integration seams: index wiring, service worker, preview tool, no business code
// ===========================================================================
test('index.html loads the mobile stylesheet last, the standalone module and the body marker', () => {
    const html = read('index.html');
    const head = html.slice(0, html.indexOf('</head>'));
    const lastLink = head.lastIndexOf('<link');
    assert.ok(lastLink > -1);
    const lastLinkTag = head.slice(lastLink, head.indexOf('>', lastLink) + 1);
    assert.match(lastLinkTag, /rel="stylesheet"/);
    assert.match(lastLinkTag, /href="\.\/mobile\.css"/);
    assert.ok(html.includes('<body class="bg-neutral-100 text-neutral-800 antialiased tpv-mobile-ui">'));
    assert.ok(html.includes('<script type="module" src="./mobile-ui.js"></script>'));
    // Original business/auth/push module is still the app's only inline module.
    assert.ok(html.includes('import { initializeApp }'));
    assert.ok(html.includes('resolveAdminAccess'));
    assert.ok(html.includes("navigator.serviceWorker.register('./sw.js')"));
});

test('mobile-ui.js is presentation only: no Firebase, network or business writes', () => {
    const source = read('mobile-ui.js');
    assert.doesNotMatch(source, /firebase|gstatic|fetch\s*\(|XMLHttpRequest|navigator\.serviceWorker/);
    assert.doesNotMatch(source, /\b(addDoc|setDoc|updateDoc|deleteDoc|runTransaction|writeBatch|signInWithEmailAndPassword|signOut|httpsCallable)\s*\(/);
    assert.doesNotMatch(source, /document\.write/);
});

test('service worker bumps its own version and caches the new mobile assets', () => {
    const sw = read('sw.js');
    assert.match(sw, /const VERSION = 'mi-barrio-tpv-celular-v3';/);
    assert.ok(sw.includes("'./mobile.css'"));
    assert.ok(sw.includes("'./mobile-ui.js'"));
    assert.ok(sw.includes('k.startsWith(CACHE_PREFIX)'));
    assert.ok(!sw.includes('keys.filter((k) => k !== VERSION)'));
    assert.ok(!sw.includes('https://'));
});

test('preview tool replaces the Firebase module and strips every remote script', () => {
    const indexHtml = read('index.html');
    for (const name of CASES) {
        const html = buildPreviewHtml({ indexHtml, caseName: name });
        assert.ok(html.includes('VISTA PREVIA DE PRUEBA'), `${name}: fake data is labelled`);
        assert.ok(html.includes('./mobile-ui.js'), `${name}: controller kept`);
        assert.ok(html.includes('./mobile.css'), `${name}: stylesheet kept`);
        assert.ok(html.includes('__TPV_PREVIEW_COUNTS__'), `${name}: click counters present`);
        assert.ok(html.includes('__TPV_PREVIEW_RESULT__'), `${name}: machine-readable checks present`);
        assert.doesNotMatch(html, /gstatic\.com|firebasejs|initializeApp/);
        assert.doesNotMatch(html, /cdn\.jsdelivr\.net|tailwindcss/);
        assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//, `${name}: no remote scripts`);
        assert.doesNotMatch(html, /serviceWorker\.register/, `${name}: no worker registration`);
        assert.ok(html.includes(`const PREVIEW_CASE = '${name}'`));
    }
    assert.match(buildPreviewHtml({ indexHtml, caseName: 'orders' }), /Cliente de prueba con nombre y dirección largos/);
    assert.match(buildPreviewHtml({ indexHtml, caseName: 'empty' }), /Cuando entre un pedido/);
});

test('preview output is confined to an explicit approved temp directory', () => {
    const safe = join(tmpdir(), 'mi-barrio-preview-unit');
    assert.equal(resolvePreviewDir(safe, { workspaceRoot: REPO_ROOT }), resolve(safe));
    assert.throws(() => resolvePreviewDir('tmp/preview', { workspaceRoot: REPO_ROOT }), /absolute/);
    assert.throws(() => resolvePreviewDir(REPO_ROOT, { workspaceRoot: REPO_ROOT }), /outside the workspace/);
    assert.throws(() => resolvePreviewDir(join(REPO_ROOT, 'mi-barrio-tpv-celular', 'preview'), { workspaceRoot: REPO_ROOT }), /outside the workspace/);
    assert.throws(() => resolvePreviewDir(join(tmpdir(), '..', 'escape'), { workspaceRoot: REPO_ROOT }), /approved temp directory/);
    assert.throws(() => resolvePreviewDir(resolve(safe, '..', '..'), { workspaceRoot: REPO_ROOT }), /approved temp directory/);
});

test('preview generation writes only the fixtures and the local controller', () => {
    const out = mkdtempSync(join(tmpdir(), 'mi-barrio-preview-test-'));
    try {
        const result = generatePreview({ outDir: out, cases: ['empty', 'orders', 'loading', 'error'], workspaceRoot: REPO_ROOT });
        assert.equal(result.files.length, 4);
        for (const file of result.files) assert.ok(existsSync(file), file);
        assert.ok(existsSync(join(out, 'mobile-ui.js')), 'controller copied for localhost loading');
        const names = readdirSync(out);
        assert.ok(names.some((n) => n === 'mock-empty.html'));
        assert.ok(names.some((n) => n === 'mock-orders.html'));
        const orders = readFileSync(join(out, 'mock-orders.html'), 'utf8');
        assert.ok(orders.includes('VISTA PREVIA DE PRUEBA'));
        assert.ok(!orders.includes('firebasejs'));
        assert.ok(!orders.includes('gstatic.com'));
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});

test('preview review frames embed a real 320/390/768 viewport per case', () => {
    const out = mkdtempSync(join(tmpdir(), 'mi-barrio-preview-frames-'));
    try {
        const result = generatePreview({ outDir: out, cases: ['orders'], workspaceRoot: REPO_ROOT });
        assert.equal(result.frames.length, 1);
        const html = readFileSync(result.frames[0], 'utf8');
        for (const width of [320, 390, 768]) {
            assert.ok(html.includes(`src="mock-orders.html" width="${width}"`), `iframe at ${width}px`);
        }
        assert.ok(html.includes('VISTA PREVIA DE PRUEBA'), 'frames carry the fake-data banner');
        assert.doesNotMatch(html, /https?:\/\//, 'frames never reference the network');
        assert.deepEqual(FRAME_WIDTHS, [320, 390, 768]);
        assert.throws(() => buildFramesHtml({ caseName: 'nope' }), /unknown case/);
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});
