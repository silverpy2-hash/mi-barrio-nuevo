// Style-contract tests for the TPV Celular mobile shell (S5 / T4).
// These tests read mobile.css as text and assert the structural promises the
// DOM/navigation unit depends on. They are intentionally framework-free: no CSS
// parser or browser is required, and every assertion maps to a real contract
// from the feature document, not to decorative taste.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let cachedCss;

async function loadCss() {
  cachedCss ??= readFile(join(here, 'mobile.css'), 'utf8');
  return cachedCss;
}

test('mobile body resets browser margins so the 320px layout does not depend on CDN preflight', async () => {
  assert.match(await loadCss(), /body\.tpv-mobile-ui\s*\{[^}]*\bmargin:\s*0\s*;/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Selector tokens must match whole names: ".tpv-tool" must not match ".tpv-tools-sheet".
function selectorHas(selector, target) {
  return new RegExp(escapeRegExp(target) + '(?![-\\w])').test(selector);
}

function parseRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(css))) {
    const selector = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selector, body: match[2] });
  }
  return rules;
}

function mediaBlocks(css) {
  const blocks = [];
  const re = /@media([^{]+)\{/g;
  let match;
  while ((match = re.exec(css))) {
    let depth = 1;
    let index = re.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth++;
      else if (css[index] === '}') depth--;
      index++;
    }
    blocks.push({ query: match[1].trim(), body: css.slice(re.lastIndex, index - 1) });
  }
  return blocks;
}

function cssOutsideMedia(css) {
  let result = css;
  for (const block of mediaBlocks(css)) {
    result = result.replace(block.body, '');
  }
  return result;
}

function rulesFor(css, target) {
  return parseRules(css).filter((rule) => selectorHas(rule.selector, target));
}

function declaration(bodies, property) {
  const re = new RegExp('(?:^|;)\\s*' + escapeRegExp(property) + '\\s*:\\s*([^;]+)', 'i');
  for (const body of bodies) {
    const match = re.exec(body);
    if (match) return match[1].trim();
  }
  return null;
}

function minHeightOf(css, target) {
  const value = declaration(rulesFor(css, target).map((rule) => rule.body), 'min-height');
  return value === null ? null : Number.parseFloat(value);
}

function zIndexOf(css, target) {
  const value = declaration(rulesFor(css, target).map((rule) => rule.body), 'z-index');
  return value === null ? null : Number.parseInt(value, 10);
}

const CONTRACT_SELECTORS = [
  '#tpv-mobile-header',
  '.tpv-brand',
  '.tpv-status',
  '#tpv-mobile-status',
  '#tpv-mobile-nav',
  '.tpv-nav-item',
  '.tpv-nav-label',
  '.tpv-icon',
  '#tpv-tools-backdrop',
  '#tpv-tools-sheet',
  '.tpv-sheet-header',
  '#tpv-tools-close',
  '#tpv-tools-grid',
  '.tpv-tool',
  '#tpv-tools-title',
  '.tpv-section-title',
  '.tpv-empty-state',
  '.tpv-empty-cta',
];

test('loads as a standalone warm-ivory stylesheet without external assets', async () => {
  const css = await loadCss();
  assert.ok(css.length > 3000, 'mobile.css should be a real scoped stylesheet, not a stub');
  assert.match(css, /--tpv-ivory:\s*#f7f5f0/i);
  assert.match(css, /--tpv-burgundy:\s*#8d2838/i);
  assert.doesNotMatch(css, /@import/i, 'no remote framework imports');
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/i, 'no external assets or fonts');
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient/i, 'the redesign avoids gradient clutter');
});

test('styles every element of the shared mobile DOM contract', async () => {
  const css = await loadCss();
  for (const selector of CONTRACT_SELECTORS) {
    assert.ok(
      rulesFor(css, selector).length > 0,
      `expected at least one rule styling ${selector}`,
    );
  }
});

test('keeps the primary header compact and sticky while it is mounted', async () => {
  const css = await loadCss();
  const bodies = rulesFor(css, '#tpv-mobile-header').map((rule) => rule.body);
  assert.ok(bodies.some((body) => /position:\s*sticky/.test(body)), 'header must stick to the top of the mobile shell');
  const minHeight = minHeightOf(css, '#tpv-mobile-header');
  assert.ok(minHeight !== null && minHeight <= 90, `header min-height must stay <= 90px, got ${minHeight}`);
  assert.ok(rulesFor(css, '.tpv-icon').some((rule) => /width:\s*20px/.test(rule.body)), 'inline icons render at ~20px');
});

test('hides legacy desktop chrome only inside the ready mobile breakpoint', async () => {
  const css = await loadCss();
  const mobileBlocks = mediaBlocks(css).filter((block) => /max-width:\s*899px/.test(block.query));
  assert.ok(mobileBlocks.length > 0, 'the redesign is scoped to max-width: 899px');

  const hideInsideMobile = mobileBlocks.some((block) =>
    parseRules(block.body).some(
      (rule) =>
        selectorHas(rule.selector, '#header-panel > div:first-child') &&
        /display:\s*none/.test(rule.body) &&
        rule.selector.includes('.tpv-mobile-ready'),
    ),
  );
  assert.ok(hideInsideMobile, 'old toolbar row hides only for body.tpv-mobile-ui.tpv-mobile-ready on mobile');

  const leakedOutsideMobile = parseRules(cssOutsideMedia(css)).some(
    (rule) => selectorHas(rule.selector, '#header-panel > div:first-child') && /display:\s*none/.test(rule.body),
  );
  assert.ok(!leakedOutsideMobile, 'a JS failure must leave the original toolbar usable');
});

test('leaves desktop at 900px and above on the original panel with no fixed chrome', async () => {
  const css = await loadCss();
  const desktop = mediaBlocks(css).filter((block) => /min-width:\s*900px/.test(block.query));
  assert.ok(desktop.length > 0, 'desktop needs an explicit reset block');

  const desktopRules = desktop.flatMap((block) => parseRules(block.body));
  for (const selector of ['#tpv-mobile-header', '#tpv-mobile-nav', '#tpv-tools-backdrop', '#tpv-tools-sheet']) {
    assert.ok(
      desktopRules.some((rule) => selectorHas(rule.selector, selector) && /display:\s*none/.test(rule.body)),
      `${selector} must stay hidden on desktop`,
    );
  }
  assert.ok(
    desktopRules.some((rule) => rule.selector === 'body.tpv-mobile-ui' && /padding-bottom:\s*0/.test(rule.body)),
    'desktop must not inherit the mobile bottom-nav spacing',
  );
});

test('defines reachable bottom navigation in four columns with a prominent Nuevo action', async () => {
  const css = await loadCss();
  const navBodies = rulesFor(css, '#tpv-mobile-nav').map((rule) => rule.body);
  assert.ok(navBodies.some((body) => /position:\s*fixed/.test(body)));
  assert.ok(navBodies.some((body) => /bottom:\s*0/.test(body)));
  assert.ok(navBodies.some((body) => /grid-template-columns:\s*repeat\(\s*4/.test(body)));
  assert.ok(navBodies.some((body) => /env\(safe-area-inset-bottom\)/.test(body)), 'nav respects the device safe area');

  const itemMin = minHeightOf(css, '.tpv-nav-item');
  assert.ok(itemMin !== null && itemMin >= 44, `nav targets must be >= 44px, got ${itemMin}`);
  const nuevoMin = minHeightOf(css, '[data-nav="nuevo"]');
  assert.ok(nuevoMin !== null && nuevoMin >= 48, `the Nuevo tab is the primary target (>= 48px), got ${nuevoMin}`);
});

test('preserves hidden semantics for the controller-owned sheet, backdrop and utilities', async () => {
  const css = await loadCss();
  for (const selector of ['[hidden]', '.hidden']) {
    assert.ok(
      rulesFor(css, selector).some((rule) => /display:\s*none\s*!important/.test(rule.body)),
      `${selector} must force display: none !important`,
    );
  }
  assert.ok(
    rulesFor(css, '#tpv-tools-sheet').some(
      (rule) => rule.selector.includes(':not([hidden])') && /display:\s*(block|grid|flex)/.test(rule.body),
    ),
    'the sheet only shows when its hidden attribute is removed',
  );
});

test('sizes the tools sheet as a scrollable, safe-area-aware bottom dialog', async () => {
  const css = await loadCss();
  const sheetBodies = rulesFor(css, '#tpv-tools-sheet').map((rule) => rule.body);
  assert.ok(sheetBodies.some((body) => /max-height:\s*80dvh/.test(body)));
  assert.ok(sheetBodies.some((body) => /overflow-y:\s*auto/.test(body)));
  assert.ok(sheetBodies.some((body) => /env\(safe-area-inset-bottom\)/.test(body)));
  assert.ok(rulesFor(css, '#tpv-tools-grid').some((rule) => /grid-template-columns/.test(rule.body)));

  const navZ = zIndexOf(css, '#tpv-mobile-nav');
  const backdropZ = zIndexOf(css, '#tpv-tools-backdrop');
  const sheetZ = zIndexOf(css, '#tpv-tools-sheet');
  const toastZ = zIndexOf(css, '#toast');
  assert.ok(navZ !== null && backdropZ !== null && sheetZ !== null && toastZ !== null, 'all shell layers declare z-index');
  assert.ok(backdropZ > navZ && sheetZ > backdropZ, 'sheet stacks above its backdrop and the bottom nav');
  assert.ok(toastZ > sheetZ, 'toasts stay readable above the sheet');
});

test('keeps filters scrollable inside their strip without clipping the page', async () => {
  const css = await loadCss();
  assert.ok(
    rulesFor(css, '#filtros').some((rule) => /overflow-x:\s*auto/.test(rule.body)),
    'the filter strip is the intentional inner scroller',
  );
  const bodyRules = parseRules(css).filter((rule) => rule.selector === 'body.tpv-mobile-ui');
  for (const rule of bodyRules) {
    assert.doesNotMatch(rule.body, /overflow(-x|-y)?\s*:/, 'body must never be clipped or locked');
    assert.doesNotMatch(rule.body, /position\s*:\s*fixed/, 'body must never be locked for the mobile shell');
  }
  assert.doesNotMatch(css, /body\.tpv-mobile-ui[^{}]*\{[^}]*overflow-x\s*:\s*hidden/i);
  const filtersMin = minHeightOf(css, '#filtros [data-filtro]');
  assert.ok(filtersMin !== null && filtersMin >= 44, `filter chips are touch actions (>= 44px), got ${filtersMin}`);
});

test('fits modal dialogs inside the viewport with scroll and 16px inputs', async () => {
  const css = await loadCss();
  const dialogBodies = rulesFor(css, '[id^="modal-"] > div').map((rule) => rule.body);
  assert.ok(dialogBodies.some((body) => /width:\s*calc\(100%\s*-\s*20px\)/.test(body)), 'dialogs keep side margins');
  assert.ok(dialogBodies.some((body) => /max-height:\s*calc\(100dvh\s*-\s*20px\)/.test(body)));
  assert.ok(dialogBodies.some((body) => /overflow-y:\s*auto/.test(body)));
  assert.ok(dialogBodies.some((body) => /min-height:\s*0/.test(body)), 'min-h-screen must not defeat internal scrolling');

  const inputSize = declaration(
    rulesFor(css, '[id^="modal-"] input').map((rule) => rule.body),
    'font-size',
  );
  assert.ok(inputSize && Number.parseFloat(inputSize) >= 16, `modal inputs avoid iOS zoom (>= 16px), got ${inputSize}`);
});

test('renders readable order cards with prominent primary actions', async () => {
  const css = await loadCss();
  assert.ok(rulesFor(css, '.pedido-head').some((rule) => /display:\s*flex/.test(rule.body)));
  assert.ok(
    rulesFor(css, '.pedido-cliente').some((rule) => /overflow-wrap:\s*anywhere/.test(rule.body)),
    'customer names wrap instead of being cut',
  );
  assert.ok(
    rulesFor(css, '.pedido-acciones').some((rule) => /grid-template-columns:\s*repeat\(2/.test(rule.body)),
  );
  const actionMin = minHeightOf(css, '.pedido-acciones > button');
  assert.ok(actionMin !== null && actionMin >= 44, `order actions are touch targets (>= 44px), got ${actionMin}`);
  for (const primary of ['[data-accion="cobrar"]', '.accion-principal']) {
    const bodies = rulesFor(css, primary).map((rule) => rule.body);
    assert.ok(bodies.some((body) => /grid-column:\s*1\s*\/\s*-1/.test(body)), `${primary} spans the full action row`);
    const min = minHeightOf(css, primary);
    assert.ok(min !== null && min >= 48, `${primary} is a primary target (>= 48px), got ${min}`);
  }
  assert.ok(
    rulesFor(css, '#lista > article').some((rule) => /min-width:\s*0/.test(rule.body) && /overflow-wrap:\s*anywhere/.test(rule.body)),
    'cards keep long content inside the viewport',
  );
});

test('gives the empty state a useful call to action and the toast a safe position', async () => {
  const css = await loadCss();
  assert.ok(rulesFor(css, '.tpv-empty-state').some((rule) => /text-align:\s*center/.test(rule.body)));
  const ctaMin = minHeightOf(css, '.tpv-empty-cta');
  assert.ok(ctaMin !== null && ctaMin >= 44, `empty-state CTA is a touch target, got ${ctaMin}`);
  const toastBodies = rulesFor(css, '#toast').map((rule) => rule.body);
  assert.ok(toastBodies.some((body) => /env\(safe-area-inset-bottom\)/.test(body)));
  assert.ok(toastBodies.some((body) => /transform:\s*none/.test(body)), 'toast is repositioned without the desktop translate');
  assert.ok(rulesFor(css, '#toast').some((rule) => /--tpv-nav-h/.test(rule.body)), 'toast clears the bottom navigation');
});

test('adds visible focus, reduced motion and theme-resistant priority', async () => {
  const css = await loadCss();
  assert.match(css, /:focus-visible/, 'keyboard focus must be visible on mobile controls');
  assert.ok(
    parseRules(css).some((rule) => /:focus-visible/.test(rule.selector) && /outline:\s*\d/.test(rule.body)),
  );
  const reduced = mediaBlocks(css).find((block) => /prefers-reduced-motion:\s*reduce/.test(block.query));
  assert.ok(reduced, 'reduced-motion preference is honored');
  assert.ok(/transition-duration/.test(reduced.body) && /animation-duration/.test(reduced.body));

  const priorityRules = parseRules(css).filter(
    (rule) => rule.selector.includes('.tpv-mobile-ready') && /!important/.test(rule.body),
  );
  assert.ok(priorityRules.length >= 3, 'ready-mobile rules beat inherited theme !important declarations where required');
  assert.ok(
    rulesFor(css, '#lista').some((rule) => /grid-template-columns[^;]*!important/.test(rule.body)),
  );
});
