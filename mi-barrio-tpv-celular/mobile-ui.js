// Mi Barrio - TPV Celular · mobile navigation shell (S5 / T5).
//
// Presentation and navigation only. This module NEVER imports Firebase, never talks to the
// network, never writes business data and never re-implements an order/payment/auth action.
// Every reachable action is delegated to the EXISTING control through .click(), so the
// original listeners, permissions, auth gate and Firestore rules stay authoritative.
//
// The mobile chrome is mounted inside #panel (never inside #login), and body.tpv-mobile-ready
// is added only when the whole mount succeeds. If this module is missing or throws, the
// original desktop toolbar remains visible and fully usable.
//
// Original DOM nodes are never moved or cloned: the theme code is allowed to reparent the
// toolbar buttons, so controls are resolved lazily by id and observed by node identity. All
// observers watch original targets only (never our mirrored output), which prevents loops.

export const MOBILE_BREAKPOINT = 899;

export const EMPTY_MESSAGES = [
    'Cuando entre un pedido va a aparecer acá al instante.',
    'No hay pedidos en esta vista.',
    'No hay pedidos en camino en este momento.',
];

export const NAV_ITEMS = [
    { nav: 'pedidos', label: 'Pedidos', icon: 'list' },
    { nav: 'nuevo', label: 'Nuevo', icon: 'plus', targetId: 'btn-nuevo' },
    { nav: 'caja', label: 'Caja', icon: 'chart', targetId: 'btn-caja' },
    { nav: 'mas', label: 'Más', icon: 'more' },
];

// Every original administrator control reachable from the More sheet. `live` tools mirror
// the real text painted by the original code (local state, push readiness) instead of
// inventing a status. Their targets are always the original buttons, never new handlers.
export const TOOL_ITEMS = [
    { targetId: 'btn-local', label: 'Estado del local', icon: 'store', live: true },
    { targetId: 'btn-local-auto', label: 'Volver al automático', icon: 'rotate', live: true },
    { targetId: 'btn-autoprint', label: 'Impresión automática', icon: 'print', live: true },
    { targetId: 'btn-cocina', label: 'Cocina', icon: 'chef' },
    { targetId: 'btn-rapida', label: 'Venta rápida', icon: 'bolt' },
    { targetId: 'btn-agotados', label: 'Sabores agotados', icon: 'ban', live: true },
    { targetId: 'btn-notif', label: 'Notificaciones', icon: 'bell', live: true },
    { targetId: 'btn-sonido', label: 'Aviso sonoro', icon: 'sound', live: true },
    { targetId: 'btn-config', label: 'Configuración', icon: 'gear' },
    { targetId: 'btn-apariencia', label: 'Apariencia', icon: 'palette' },
    { targetId: 'btn-nuevo', label: 'Nuevo pedido', icon: 'plus' },
    { targetId: 'btn-caja', label: 'Caja y cierres', icon: 'chart' },
    { targetId: 'btn-salir', label: 'Salir', icon: 'exit' },
];

const ICONS = {
    pizza: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 3 20.5h18L12 2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="1.2" fill="currentColor"/><circle cx="9.6" cy="17.4" r="1.2" fill="currentColor"/><circle cx="14.6" cy="17.4" r="1.2" fill="currentColor"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
    store: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 10v9h16v-9M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5v5h5M20 19v-5h-5M19 9a7 7 0 0 0-12-3L4 10M5 15a7 7 0 0 0 12 3l3-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    print: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7v-7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    chef: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 13a4 4 0 0 1-1-7.9 4.5 4.5 0 0 1 8.6-1.2 4 4 0 0 1 3.6 5.6A4 4 0 0 1 17 13v6H7v-6ZM7 19h10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    ban: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="m6 6 12 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 9a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10 20a2.5 2.5 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    palette: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3a9 9 0 1 0 0 18c1.6 0 2-1 1.4-2-.7-1.2 0-2.5 1.6-2.5H17a4 4 0 0 0 4-4C21 7 17 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/></svg>',
    exit: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
};

const INSTANCES = new WeakMap();

// ===== Pure helpers (exported for behavioural tests) =====

// Reads only the state the original control owns. Ancestor CSS (for example the mobile
// stylesheet hiding the original action row) is deliberately NOT a permission signal.
export function mirrorToolState(target) {
    if (!target) return { hidden: true, disabled: true, pressed: null };
    const hidden = target.hidden === true
        || (target.classList && target.classList.contains('hidden'))
        || (target.getAttribute && target.getAttribute('aria-hidden') === 'true');
    const pressedAttr = target.getAttribute ? target.getAttribute('aria-pressed') : null;
    return {
        hidden: !!hidden,
        disabled: target.disabled === true,
        pressed: pressedAttr === null || pressedAttr === undefined ? null : pressedAttr === 'true',
    };
}

export function classifyListState({ listChildren = [], errorText = '' } = {}) {
    if (String(errorText || '').trim()) return 'error';
    const children = Array.from(listChildren || []).filter((node) => !(node.getAttribute
        && node.getAttribute('data-tpv-empty-cta') === '1'));
    if (!children.length) return 'loading';
    if (children.length === 1 && children[0].tagName === 'P'
        && EMPTY_MESSAGES.some((message) => String(children[0].textContent || '').includes(message))) {
        return 'empty';
    }
    const unknownParagraphs = children.filter((node) => node.tagName === 'P'
        && !EMPTY_MESSAGES.some((message) => String(node.textContent || '').includes(message)));
    const content = children.filter((node) => !unknownParagraphs.includes(node));
    if (content.some((node) => node.tagName === 'ARTICLE' || /pedido/.test(node.className || ''))) return 'orders';
    return 'other';
}

// Never turns navigator.onLine into a Firebase claim: online means "nothing to say".
export function buildStatus({ online, errorText = '', localText = '', loading = false } = {}) {
    const parts = [];
    let tone = 'none';
    if (online === false) {
        tone = 'offline';
        parts.push('Sin conexión');
    }
    if (String(errorText || '').trim()) {
        if (tone === 'none') tone = 'error';
        parts.push('Error al cargar los pedidos');
    }
    if (String(localText || '').trim()) {
        if (tone === 'none') tone = 'local';
        parts.push('Local: ' + String(localText).trim());
    }
    if (loading) {
        if (tone === 'none') tone = 'loading';
        parts.push('Cargando pedidos…');
    }
    return { tone, text: parts.join(' · ') };
}

export function nextFocusTarget(items, activeIndex, shift) {
    if (!items || !items.length) return null;
    if (activeIndex < 0) return shift ? items[items.length - 1] : items[0];
    if (shift && activeIndex === 0) return items[items.length - 1];
    if (!shift && activeIndex === items.length - 1) return items[0];
    return null;
}

export function isMobileViewport(win) {
    if (!win || typeof win.innerWidth !== 'number') return true;
    return win.innerWidth <= MOBILE_BREAKPOINT;
}

// ===== DOM helpers (no selector parsing: the fixture only needs a narrow, explicit API) =====

function make(doc, tag, className, attrs) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            if (value === undefined || value === null) continue;
            node.setAttribute(key, value);
        }
    }
    return node;
}

function iconSpan(doc, name) {
    const span = doc.createElement('span');
    span.className = 'tpv-icon';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = ICONS[name] || ICONS.more;
    return span;
}

function findByClass(root, className) {
    const stack = [...root.children];
    while (stack.length) {
        const node = stack.shift();
        if (node.classList && node.classList.contains(className)) return node;
        if (node.children) stack.push(...node.children);
    }
    return null;
}

function conciseText(value) {
    return String(value == null ? '' : value)
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isHiddenNode(node) {
    if (!node) return true;
    return node.hidden === true || (node.classList && node.classList.contains('hidden'))
        || (node.getAttribute && node.getAttribute('aria-hidden') === 'true');
}

// ===== Mount =====

export function initializeMobileUi(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    if (!doc || !doc.body) return null;

    const existing = INSTANCES.get(doc);
    if (existing) return existing;

    const panel = doc.getElementById('panel');
    if (!panel) return null;

    const created = [];
    try {
        const controller = mount(doc, win, panel, created);
        INSTANCES.set(doc, controller);
        return controller;
    } catch (error) {
        created.forEach((node) => {
            try { if (node.parentNode) node.remove(); } catch (e) { /* best effort fallback */ }
        });
        doc.body.classList.remove('tpv-mobile-ready');
        if (win && win.console && typeof win.console.warn === 'function') {
            win.console.warn('[TPV Celular] mobile UI no disponible; se usa la barra original:', error);
        }
        return null;
    }
}

function mount(doc, win, panel, created) {
    const body = doc.body;
    body.classList.add('tpv-mobile-ui');

    const Observer = (win && win.MutationObserver)
        || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);

    let disposed = false;
    let sheetOpen = false;
    let opener = null;
    let inerted = [];
    let addedListTabindex = false;
    const observers = [];
    const targetObservers = new Map();

    const observe = (node, opts, handler) => {
        if (!Observer || !node) return null;
        const observer = new Observer(() => handler());
        observer.observe(node, opts);
        observers.push(observer);
        return observer;
    };

    const byId = (id) => doc.getElementById(id);
    const isPanelHidden = () => panel.classList && panel.classList.contains('hidden');

    // ----- header -----
    const header = make(doc, 'header', 'tpv-mobile-header', { id: 'tpv-mobile-header' });
    const brand = make(doc, 'div', 'tpv-brand');
    brand.appendChild(iconSpan(doc, 'pizza'));
    const brandText = make(doc, 'div', 'tpv-brand-text');
    const brandTitle = make(doc, 'span', 'tpv-brand-title');
    brandTitle.textContent = 'Mi Barrio';
    const brandSub = make(doc, 'span', 'tpv-brand-sub');
    brandSub.textContent = 'TPV administrador';
    brandText.appendChild(brandTitle);
    brandText.appendChild(brandSub);
    brand.appendChild(brandText);
    const status = make(doc, 'div', 'tpv-status', {
        id: 'tpv-mobile-status',
        role: 'status',
        'aria-live': 'polite',
        'data-tone': 'none',
    });
    status.textContent = 'Cargando pedidos…';
    header.appendChild(brand);
    header.appendChild(status);
    panel.insertBefore(header, panel.children[0] || null);
    created.push(header);

    // ----- bottom navigation -----
    const nav = make(doc, 'nav', 'tpv-mobile-nav', { id: 'tpv-mobile-nav', 'aria-label': 'Navegación principal' });
    const navButtons = new Map();
    for (const item of NAV_ITEMS) {
        const button = make(doc, 'button', 'tpv-nav-item', { type: 'button', 'data-nav': item.nav });
        button.appendChild(iconSpan(doc, item.icon));
        const label = make(doc, 'span', 'tpv-nav-label');
        label.textContent = item.label;
        button.appendChild(label);
        if (item.nav === 'pedidos') button.setAttribute('aria-current', 'page');
        if (item.nav === 'nuevo' || item.nav === 'caja') button.setAttribute('aria-expanded', 'false');
        if (item.nav === 'mas') button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', () => {
            if (item.nav === 'mas') {
                if (sheetOpen) closeSheet();
                else openSheet(button);
                return;
            }
            if (item.nav === 'pedidos') {
                focusList();
                return;
            }
            runTool(item.targetId);
        });
        navButtons.set(item.nav, button);
        nav.appendChild(button);
    }
    panel.appendChild(nav);
    created.push(nav);

    // ----- More sheet -----
    const backdrop = make(doc, 'div', 'tpv-tools-backdrop', { id: 'tpv-tools-backdrop', 'aria-hidden': 'true' });
    backdrop.hidden = true;
    backdrop.addEventListener('click', () => closeSheet());

    const sheet = make(doc, 'div', 'tpv-tools-sheet', {
        id: 'tpv-tools-sheet',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'tpv-tools-title',
    });
    sheet.hidden = true;
    const sheetHeader = make(doc, 'div', 'tpv-sheet-header');
    const sheetTitle = make(doc, 'h2', 'tpv-section-title', { id: 'tpv-tools-title' });
    sheetTitle.textContent = 'Más herramientas';
    const closeButton = make(doc, 'button', 'tpv-sheet-close', {
        id: 'tpv-tools-close',
        type: 'button',
        'aria-label': 'Cerrar herramientas',
    });
    closeButton.appendChild(iconSpan(doc, 'close'));
    closeButton.addEventListener('click', () => closeSheet());
    sheetHeader.appendChild(sheetTitle);
    sheetHeader.appendChild(closeButton);
    sheet.appendChild(sheetHeader);

    const grid = make(doc, 'div', 'tpv-tools-grid', { id: 'tpv-tools-grid' });
    sheet.appendChild(grid);
    const sheetEmpty = make(doc, 'p', 'tpv-tools-empty', { id: 'tpv-tools-empty' });
    sheetEmpty.textContent = 'No hay herramientas disponibles para este usuario.';
    sheetEmpty.hidden = true;
    sheet.appendChild(sheetEmpty);

    const proxies = new Map();
    for (const tool of TOOL_ITEMS) {
        const proxy = make(doc, 'button', 'tpv-tool', {
            type: 'button',
            'data-tool-target': tool.targetId,
            'aria-label': tool.label,
        });
        proxy.appendChild(iconSpan(doc, tool.icon));
        const label = make(doc, 'span', 'tpv-tool-label');
        label.textContent = tool.label;
        proxy.appendChild(label);
        let stateEl = null;
        if (tool.live) {
            stateEl = make(doc, 'span', 'tpv-tool-state');
            stateEl.hidden = true;
            proxy.appendChild(stateEl);
        }
        proxy.addEventListener('click', () => runTool(tool.targetId));
        grid.appendChild(proxy);
        proxies.set(tool.targetId, { button: proxy, state: stateEl, tool });
    }

    panel.appendChild(backdrop);
    panel.appendChild(sheet);
    created.push(backdrop, sheet);

    // ----- state reading -----

    const readOnline = () => {
        if (!win || !win.navigator || typeof win.navigator.onLine !== 'boolean') return true;
        return win.navigator.onLine;
    };

    const readErrorText = () => {
        const aviso = byId('aviso-error');
        if (!aviso || isHiddenNode(aviso)) return '';
        return String(aviso.textContent || '').trim();
    };

    const readLocalText = () => {
        const target = byId('btn-local');
        if (!target || isHiddenNode(target)) return '';
        const estado = findByClass(target, 'local-estado');
        if (!estado) return '';
        const modo = findByClass(target, 'local-modo');
        const parts = [String(estado.textContent || '').trim()];
        if (modo && String(modo.textContent || '').trim()) parts.push(String(modo.textContent || '').trim());
        return parts.filter(Boolean).join(' · ');
    };

    const readListState = () => {
        const list = byId('lista');
        return classifyListState({ listChildren: list ? list.children : [], errorText: readErrorText() });
    };

    const liveTextFor = (tool) => {
        if (!tool.live) return '';
        if (tool.targetId === 'btn-local') return readLocalText();
        const target = byId(tool.targetId);
        if (!target || isHiddenNode(target)) return '';
        return conciseText(target.textContent);
    };

    // ----- proxy mirroring -----
    const syncProxy = (tool) => {
        const entry = proxies.get(tool.targetId);
        if (!entry) return;
        const target = byId(tool.targetId);
        const state = mirrorToolState(target);
        const liveText = liveTextFor(tool);
        entry.button.hidden = state.hidden;
        entry.button.disabled = state.hidden || state.disabled;
        entry.button.setAttribute('aria-disabled', entry.button.disabled ? 'true' : 'false');
        if (state.pressed === null) entry.button.removeAttribute('aria-pressed');
        else entry.button.setAttribute('aria-pressed', state.pressed ? 'true' : 'false');
        const label = [tool.label, liveText].filter(Boolean).join(' · ');
        entry.button.setAttribute('aria-label', label);
        if (entry.state) {
            entry.state.textContent = liveText;
            entry.state.hidden = !liveText;
        }
    };

    const bindTargetObservers = () => {
        for (const tool of TOOL_ITEMS) {
            const target = byId(tool.targetId);
            const previous = targetObservers.get(tool.targetId);
            if (previous && previous.node === target) continue;
            if (previous) previous.observer.disconnect();
            if (!target) {
                targetObservers.delete(tool.targetId);
                continue;
            }
            const observer = observe(target, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true,
                attributeFilter: ['class', 'hidden', 'disabled', 'aria-pressed', 'aria-hidden'],
            }, () => {
                syncProxy(tool);
                if (tool.targetId === 'btn-local') syncStatus();
            });
            targetObservers.set(tool.targetId, { node: target, observer });
        }
    };

    // ----- listeners that only read original state -----
    const onOnline = () => syncStatus();
    const onOffline = () => syncStatus();
    const onResize = () => {
        if (!isMobileViewport(win)) closeSheet({ restoreFocus: false });
    };
    if (win && typeof win.addEventListener === 'function') {
        win.addEventListener('online', onOnline);
        win.addEventListener('offline', onOffline);
        win.addEventListener('resize', onResize);
    }

    const modalIds = { nuevo: 'modal-nuevo', caja: 'modal-caja' };
    const syncModalState = () => {
        let open = null;
        for (const [name, modalId] of Object.entries(modalIds)) {
            const button = navButtons.get(name);
            const modal = byId(modalId);
            const visible = !!modal && !(modal.classList && modal.classList.contains('hidden'));
            if (button) {
                button.setAttribute('aria-expanded', visible ? 'true' : 'false');
                if (visible) button.setAttribute('data-nav-active', 'true');
                else button.removeAttribute('data-nav-active');
            }
            if (visible) open = name;
        }
        const pedidos = navButtons.get('pedidos');
        if (pedidos) pedidos.setAttribute('aria-current', 'page');
        return open;
    };

    const syncStatus = () => {
        const loading = !isPanelHidden() && readListState() === 'loading';
        const result = buildStatus({
            online: readOnline(),
            errorText: readErrorText(),
            localText: readLocalText(),
            loading,
        });
        status.textContent = result.text;
        status.hidden = !result.text;
        status.setAttribute('data-tone', result.tone);
    };

    const syncEmptyState = () => {
        const list = byId('lista');
        if (!list || readListState() !== 'empty') return;
        const empty = Array.from(list.children).find((node) => node.getAttribute('data-tpv-empty-cta') !== '1');
        if (!empty || empty.getAttribute('data-tpv-empty') === '1') return;
        empty.setAttribute('data-tpv-empty', '1');
        if (empty.classList) empty.classList.add('tpv-empty-state');
        const cta = make(doc, 'button', 'tpv-empty-cta', { type: 'button', 'data-tpv-empty-cta': '1' });
        cta.textContent = '➕ Nuevo pedido';
        cta.addEventListener('click', () => runTool('btn-nuevo'));
        list.appendChild(cta);
    };

    // ----- actions -----

    const focusList = () => {
        const list = byId('lista');
        if (!list) return;
        if (!list.getAttribute || !list.hasAttribute || !list.hasAttribute('tabindex')) {
            if (!addedListTabindex) {
                list.setAttribute('tabindex', '-1');
                addedListTabindex = true;
            }
        }
        try {
            if (typeof list.scrollIntoView === 'function') list.scrollIntoView({ block: 'start', behavior: 'smooth' });
            if (typeof list.focus === 'function') list.focus();
        } catch (e) { /* focus is best effort */ }
    };

    const focusables = () => {
        const nodes = [closeButton];
        for (const tool of TOOL_ITEMS) {
            const entry = proxies.get(tool.targetId);
            if (entry && !entry.button.hidden && !entry.button.disabled) nodes.push(entry.button);
        }
        return nodes;
    };

    const onSheetKeydown = (event) => {
        if (!sheetOpen || !event) return;
        if (event.key === 'Escape') {
            if (event.preventDefault) event.preventDefault();
            if (event.stopPropagation) event.stopPropagation();
            closeSheet();
            return;
        }
        if (event.key !== 'Tab') return;
        const items = focusables();
        if (!items.length) return;
        const active = doc.activeElement;
        const index = items.indexOf(active);
        const next = nextFocusTarget(items, index, !!event.shiftKey);
        if (next) {
            if (event.preventDefault) event.preventDefault();
            if (typeof next.focus === 'function') next.focus();
        }
    };

    const lockBackground = () => {
        inerted = [];
        for (const child of panel.children) {
            if (child === sheet || child === backdrop) continue;
            inerted.push({ node: child, wasInert: child.inert === true });
            child.inert = true;
        }
    };

    const unlockBackground = () => {
        for (const entry of inerted) entry.node.inert = entry.wasInert;
        inerted = [];
    };

    const openSheet = (trigger) => {
        if (sheetOpen) return;
        sheetOpen = true;
        opener = trigger || doc.activeElement || null;
        sheet.hidden = false;
        backdrop.hidden = false;
        body.classList.add('tpv-sheet-open');
        lockBackground();
        if (typeof doc.addEventListener === 'function') doc.addEventListener('keydown', onSheetKeydown);
        const mas = navButtons.get('mas');
        if (mas) mas.setAttribute('aria-expanded', 'true');
        if (typeof closeButton.focus === 'function') closeButton.focus();
    };

    const closeSheet = (options = {}) => {
        if (!sheetOpen) return;
        sheetOpen = false;
        sheet.hidden = true;
        backdrop.hidden = true;
        body.classList.remove('tpv-sheet-open');
        unlockBackground();
        if (typeof doc.removeEventListener === 'function') doc.removeEventListener('keydown', onSheetKeydown);
        const mas = navButtons.get('mas');
        if (mas) mas.setAttribute('aria-expanded', 'false');
        const restore = options.restoreFocus !== false;
        if (restore && opener && doc.body && doc.body.contains(opener) && typeof opener.focus === 'function') {
            opener.focus();
        }
        opener = null;
    };

    const runTool = (targetId, options = {}) => {
        const target = byId(targetId);
        const state = mirrorToolState(target);
        if (!target || state.hidden || state.disabled) return false;
        // Close first so the original modal/action receives focus and body state, never the
        // inert background or a focus trap that is about to disappear.
        if (options.closeSheet !== false) closeSheet({ restoreFocus: false });
        target.click();
        return true;
    };

    const syncAll = () => {
        bindTargetObservers();
        for (const tool of TOOL_ITEMS) syncProxy(tool);
        syncStatus();
        syncEmptyState();
        syncModalState();
        const mas = navButtons.get('mas');
        if (mas) mas.setAttribute('aria-expanded', sheetOpen ? 'true' : 'false');
        const visible = TOOL_ITEMS.some((tool) => {
            const entry = proxies.get(tool.targetId);
            return entry && !entry.button.hidden && !entry.button.disabled;
        });
        sheetEmpty.hidden = visible;
    };

    // ----- observers: original targets only, never mirrored output -----

    for (const containerId of ['acciones-panel', 'menu-mas-cuerpo']) {
        observe(byId(containerId), { childList: true, subtree: true }, () => {
            bindTargetObservers();
            for (const tool of TOOL_ITEMS) syncProxy(tool);
        });
    }
    observe(panel, { attributes: true, attributeFilter: ['class'] }, () => {
        syncStatus();
        if (isPanelHidden()) closeSheet({ restoreFocus: false });
    });
    observe(byId('lista'), { childList: true, subtree: true }, () => {
        syncEmptyState();
        syncStatus();
    });
    observe(byId('aviso-error'), { attributes: true, childList: true, characterData: true, subtree: true }, () => {
        syncStatus();
        syncEmptyState();
    });
    for (const modalId of Object.values(modalIds)) {
        observe(byId(modalId), { attributes: true, attributeFilter: ['class'] }, () => syncModalState());
    }
    bindTargetObservers();

    // The list is focusable for the Pedidos destination without changing its behavior.
    const list = byId('lista');
    if (list && typeof list.hasAttribute === 'function' && !list.hasAttribute('tabindex')) {
        list.setAttribute('tabindex', '-1');
        addedListTabindex = true;
    }

    // First paint with whatever the original app already rendered.
    syncAll();

    // Ready marker only after the full mount succeeded; CSS keys the mobile layout off it.
    body.classList.add('tpv-mobile-ready');
    body.setAttribute('data-tpv-mobile-ui', 'ready');

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        closeSheet({ restoreFocus: false });
        for (const observer of observers) {
            try { observer.disconnect(); } catch (e) { /* ignore */ }
        }
        observers.length = 0;
        for (const { observer } of targetObservers.values()) {
            try { observer.disconnect(); } catch (e) { /* ignore */ }
        }
        targetObservers.clear();
        if (win && typeof win.removeEventListener === 'function') {
            win.removeEventListener('online', onOnline);
            win.removeEventListener('offline', onOffline);
            win.removeEventListener('resize', onResize);
        }
        for (const node of created) {
            try { if (node.parentNode) node.remove(); } catch (e) { /* ignore */ }
        }
        if (addedListTabindex && list && typeof list.removeAttribute === 'function') {
            list.removeAttribute('tabindex');
        }
        body.classList.remove('tpv-mobile-ready');
        body.classList.remove('tpv-sheet-open');
        body.removeAttribute('data-tpv-mobile-ui');
        INSTANCES.delete(doc);
    };

    return {
        sync: syncAll,
        openSheet: () => openSheet(navButtons.get('mas')),
        closeSheet: (options) => closeSheet(options),
        isSheetOpen: () => sheetOpen,
        dispose,
        nodes: { header, nav, sheet, backdrop, grid },
    };
}

// Browser auto-start. Imported by tests in Node this is inert (no document/window).
if (typeof window !== 'undefined' && typeof document !== 'undefined'
    && typeof document.createElement === 'function' && typeof document.getElementById === 'function') {
    const boot = () => {
        try {
            initializeMobileUi({ document, window });
        } catch (error) {
            if (window.console && typeof window.console.warn === 'function') {
                window.console.warn('[TPV Celular] mobile UI no disponible; se usa la barra original:', error);
            }
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
}
