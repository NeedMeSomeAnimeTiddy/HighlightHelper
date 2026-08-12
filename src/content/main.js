/**
 * Highlight Helper — in-page controller.
 *
 * Flow: selection -> small icon -> click -> a menu of what you can do with it.
 * Picking a row drills into a detail view inside the same panel; a back arrow
 * (or Escape, or Backspace) returns. The panel animates to each view's height
 * rather than jumping.
 *
 * Everything lives in a shadow root attached to <html>, positioned in document
 * coordinates, so page CSS can't touch it and it scrolls with the content.
 *
 * This file knows nothing about currencies, units or prompts — that lives in
 * ./detectors/*, which contribute menu rows.
 */

import { getSettings, onSettingsChanged, isEnabledFor } from '../common/settings.js';
import { MSG, ERR } from '../common/constants.js';
import { detect, getDetector } from './detectors/index.js';
import { el, menu, glyph, errorBox, note } from './kit.js';
import { markGlyph } from './icons.js';

const MIN_CHARS = 2;
const MAX_CHARS = 8000;
const SNIPPET_CHARS = 64;
const GAP = 8;
const EDGE = 8;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let settings = null;
let ui = null;                 // { host, shadow, layer }
let current = null;            // captured selection
let mode = 'hidden';           // 'hidden' | 'icon' | 'panel'
let pointerDown = false;
let suppressEvents = false;    // set while we ourselves touch the selection
let evaluateTimer = 0;

// Panel internals, rebuilt on each open.
let panel = null;
let headEl = null;
let viewsEl = null;
let footEl = null;
let stack = [];                // [{ title, node }]
let heightLock = null;         // target views height mid-animation, else null
let heightTimer = 0;
let sizeObserver = null;
let activeRow = -1;

// Start fetching the stylesheet immediately; it's needed before the first paint.
const cssPromise = fetch(chrome.runtime.getURL('src/content/panel.css'))
  .then((r) => r.text())
  .catch(() => '');

/* ------------------------------------------------------------------ *
 * Shadow-DOM host
 * ------------------------------------------------------------------ */

async function ensureUi() {
  if (ui) return ui;

  const cssText = await cssPromise;
  const host = document.createElement('div');
  host.setAttribute('data-highlight-helper', '');
  // `all: initial` first, then the properties we actually need — later wins.
  // These are inline so no page stylesheet can override them. The z-index sits
  // on the host so the whole UI is one stacking context at the document root.
  host.style.cssText =
    'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; ' +
    'z-index: 2147483647;';

  const shadow = host.attachShadow({ mode: 'open' });

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = cssText;
    shadow.append(style);
  }

  const layer = document.createElement('div');
  layer.className = 'hh-layer';
  shadow.append(layer);

  // Pressing inside our UI must not collapse the page selection — that's what
  // Replace writes back into. Form controls still need their default.
  host.addEventListener('mousedown', (e) => {
    const interactive = e.composedPath().some(
      (n) => n?.tagName && /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(n.tagName)
    );
    if (!interactive) e.preventDefault();
  }, true);

  document.documentElement.append(host);
  ui = { host, shadow, layer };
  return ui;
}

/* ------------------------------------------------------------------ *
 * Selection capture
 * ------------------------------------------------------------------ */

function deepActiveElement() {
  let node = document.activeElement;
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
  return node;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);

function isTextField(node) {
  if (!node) return false;
  if (node.tagName === 'TEXTAREA') return !node.disabled && !node.readOnly;
  if (node.tagName !== 'INPUT') return false;
  if (node.disabled || node.readOnly) return false;
  return TEXT_INPUT_TYPES.has((node.type || '').toLowerCase());
}

function closestEditable(node) {
  let n = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (n) {
    if (n.isContentEditable) {
      // Walk up to the element that actually carries the attribute.
      let root = n;
      while (root.parentElement?.isContentEditable) root = root.parentElement;
      return root;
    }
    n = n.parentElement;
  }
  return null;
}

function insideUi(node) {
  if (!ui || !node) return false;
  const n = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return Boolean(n && ui.host.contains(n));
}

/** Reads the live selection into a plain object, or null. */
function readSelection() {
  const active = deepActiveElement();

  if (isTextField(active)) {
    const { selectionStart: start, selectionEnd: end } = active;
    if (start == null || end == null || end <= start) return null;
    const text = active.value.slice(start, end);
    if (!text.trim()) return null;
    const rect = active.getBoundingClientRect();
    return {
      text,
      rect,
      anchorRect: rect,
      range: null,
      editable: { kind: 'field', el: active, start, end }
    };
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const text = sel.toString();
  if (!text.trim()) return null;

  const range = sel.getRangeAt(0);
  if (insideUi(range.commonAncestorContainer)) return null;

  const rects = range.getClientRects();
  const bounding = range.getBoundingClientRect();
  const last = rects.length ? rects[rects.length - 1] : bounding;
  if (!bounding.width && !bounding.height) return null;

  const editableRoot = closestEditable(range.commonAncestorContainer);

  return {
    text,
    rect: bounding,
    anchorRect: last,
    range: range.cloneRange(),
    editable: editableRoot ? { kind: 'ce', el: editableRoot } : null
  };
}

/** Fresh viewport rect for the captured selection, or null if it's gone. */
function liveAnchorRect() {
  if (!current) return null;
  if (current.editable?.kind === 'field') {
    const r = current.editable.el.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }
  if (current.range) {
    const rects = current.range.getClientRects();
    if (rects.length) return rects[rects.length - 1];
    const r = current.range.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }
  return current.anchorRect;
}

/** One-line version of the selection for the panel header. */
function snippet(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS - 1)}…` : flat;
}

/* ------------------------------------------------------------------ *
 * Positioning
 * ------------------------------------------------------------------ */

/**
 * Places the layer's single child near `anchor` (a viewport rect), flipping
 * above when there's no room below and clamping to the viewport edges.
 *
 * `heightHint` is the height the panel is animating *towards* — using the
 * measured height mid-transition would make the panel creep as it grows.
 */
function position(anchor, { align = 'start', heightHint = null } = {}) {
  const node = ui?.layer.firstElementChild;
  if (!node || !anchor) return;

  const w = node.offsetWidth;
  const h = heightHint ?? node.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let left = align === 'end' ? anchor.right - w : anchor.left;
  let top = anchor.bottom + GAP;

  if (top + h > vh - EDGE && anchor.top - GAP - h > EDGE) {
    top = anchor.top - GAP - h;
  }
  left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
  top = Math.max(EDGE, Math.min(top, vh - h - EDGE));

  ui.layer.style.left = `${Math.round(left + window.scrollX)}px`;
  ui.layer.style.top = `${Math.round(top + window.scrollY)}px`;
}

/**
 * Height the panel is animating towards, or null when it is at rest — in
 * which case the measured height is already correct.
 */
function panelHeightHint() {
  if (!panel || heightLock == null) return null;
  const chrome = headEl.offsetHeight + (footEl.hidden ? 0 : footEl.offsetHeight) + 2;
  return chrome + heightLock;
}

function reposition() {
  if (mode === 'hidden' || !ui) return;
  const anchor = liveAnchorRect();
  if (!anchor) { hide(); return; }
  position(anchor, mode === 'icon'
    ? { align: 'end' }
    : { heightHint: panelHeightHint() });
}

/* ------------------------------------------------------------------ *
 * Page interaction helpers handed to detectors
 * ------------------------------------------------------------------ */

async function send(message) {
  try {
    const res = await chrome.runtime.sendMessage(message);
    if (res === undefined) throw new Error('No response from the extension');
    return res;
  } catch {
    throw new Error('Extension was reloaded — refresh this page to continue.');
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* clipboard API blocked (no focus / insecure origin) — fall through */
  }
  if (!document.body) return false;
  suppressEvents = true;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  } finally {
    setTimeout(() => { suppressEvents = false; }, 150);
  }
}

/**
 * Writes `text` back over the selection.
 * Only possible when the selection came from an input, textarea, or
 * contenteditable — ordinary page text is not editable.
 */
function replaceSelection(text) {
  const ed = current?.editable;
  if (!ed) return false;

  suppressEvents = true;
  try {
    if (ed.kind === 'field') {
      const node = ed.el;
      if (!node.isConnected) return false;
      const next = node.value.slice(0, ed.start) + text + node.value.slice(ed.end);

      // Assign through the native setter so frameworks that patch `value`
      // (React and friends) still see the change and re-render.
      const proto = node.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(node, next);
      else node.value = next;

      node.focus({ preventScroll: true });
      node.setSelectionRange(ed.start, ed.start + text.length);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));

      // Keep the capture consistent so a second Replace still works.
      ed.end = ed.start + text.length;
      current.text = text;
      return true;
    }

    if (!ed.el.isConnected || !current.range) return false;
    ed.el.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(current.range);
    const ok = document.execCommand('insertText', false, text);
    current.range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : current.range;
    current.text = text;
    return ok;
  } catch (err) {
    console.warn('[Highlight Helper] replace failed:', err);
    return false;
  } finally {
    setTimeout(() => { suppressEvents = false; }, 150);
  }
}

function openOptions() {
  send({ type: MSG.OPEN_OPTIONS }).catch(() => {});
}

const FRIENDLY = {
  [ERR.NO_KEY]: 'Add your DeepSeek API key in settings to use the AI tools.',
  [ERR.BAD_KEY]: 'DeepSeek rejected that API key. Check it in settings.',
  [ERR.NO_FUNDS]: 'Your DeepSeek account is out of credit.',
  [ERR.RATE_LIMIT]: 'DeepSeek is rate-limiting right now. Try again in a moment.',
  [ERR.OFFLINE]: "Couldn't reach DeepSeek. Check your connection.",
  [ERR.TIMEOUT]: 'That request timed out.'
};

function errorFor(err, retry) {
  const code = String(err?.message || err);
  const needsKey = code === ERR.NO_KEY || code === ERR.BAD_KEY;
  return errorBox(FRIENDLY[code] || code, {
    onRetry: needsKey ? null : retry,
    onSettings: needsKey ? openOptions : null
  });
}

function makeApi(extra = {}) {
  return {
    settings,
    context: { title: document.title, host: location.hostname, url: location.href },
    canReplace: Boolean(current?.editable),
    send,
    async ai(action, text, options = {}) {
      const res = await send({ type: MSG.AI, action, text, options });
      if (!res?.ok) throw new Error(res?.error || 'Request failed');
      return res;
    },
    copy: copyText,
    replace: replaceSelection,
    errorFor,
    openOptions,
    push: pushView,
    pop: popView,
    close: hide,
    ...extra
  };
}

/* ------------------------------------------------------------------ *
 * View stack
 * ------------------------------------------------------------------ */

/**
 * Animates the view container from its current height to `target`, then hands
 * height back to `auto`.
 *
 * The resting state is deliberately `auto`: async results (AI replies, rate
 * lookups) land at unpredictable times, and an explicit height that failed to
 * update would clip them. The lock exists only for the duration of the
 * transition, and a timer — not `transitionend` — releases it, so it still
 * releases under prefers-reduced-motion where no transition event fires.
 */
function animateViewsTo(target) {
  clearTimeout(heightTimer);
  const from = viewsEl.offsetHeight;

  viewsEl.style.height = `${from}px`;
  void viewsEl.offsetHeight; // force the browser to accept the start value
  viewsEl.style.height = `${target}px`;
  heightLock = target;
  reposition();

  heightTimer = setTimeout(() => {
    if (!viewsEl) return;
    viewsEl.style.height = '';
    heightLock = null;
    reposition();
  }, 190);
}

/**
 * Plays an entrance transition, without depending on requestAnimationFrame.
 *
 * The class is added, a reflow is forced so the browser commits that as the
 * start state, then it is removed again in the same synchronous pass — which
 * transitions to the resting state. The resting class list is the *visible*
 * one, so if frames never arrive (throttled renderer, background tab) the
 * element is shown anyway. Revealing something must never be something that
 * has to happen; it must be what happens when nothing does.
 */
function playEnter(node, ...fromClasses) {
  node.classList.add('hh-enter', ...fromClasses);
  void node.offsetWidth; // commit the start state
  node.classList.remove('hh-enter', ...fromClasses);
}

/**
 * Keeps the panel on screen when a view grows on its own. Purely positional —
 * sizing is the browser's job now, so a missing ResizeObserver costs nothing.
 */
function observeView(node) {
  sizeObserver?.disconnect();
  sizeObserver = null;
  if (typeof ResizeObserver !== 'function') return;
  sizeObserver = new ResizeObserver(() => {
    if (heightLock == null) reposition();
  });
  sizeObserver.observe(node);
}

function showView(view, direction) {
  const outgoing = viewsEl.lastElementChild;
  if (outgoing === view.node) return; // already showing

  // Views are kept on the stack and re-shown on Back, so this node may still
  // be wearing the exit classes from when it slid away — which would bring it
  // back invisible (opacity 0), unclickable and out of flow.
  view.node.classList.remove('hh-view--out', 'hh-out-left', 'hh-out-right');
  view.node.classList.add('hh-view');

  if (outgoing) {
    outgoing.classList.add('hh-view--out',
      direction === 'back' ? 'hh-out-right' : 'hh-out-left');
    setTimeout(() => {
      // A fast Back press can re-show this node before the timer fires; the
      // class is cleared above, so its absence means "don't discard me".
      if (outgoing.classList.contains('hh-view--out')) outgoing.remove();
    }, 200);
  }

  viewsEl.append(view.node);
  renderChrome();

  animateViewsTo(view.node.offsetHeight);
  playEnter(view.node, direction === 'back' ? 'hh-from-left' : 'hh-from-right');

  observeView(view.node);
  activeRow = -1;
}

function pushView(title, node) {
  if (!panel || !node) return;
  stack.push({ title, node });
  showView(stack[stack.length - 1], 'forward');
}

function popView() {
  if (stack.length < 2) return;
  stack.pop();
  showView(stack[stack.length - 1], 'back');
}

function renderChrome() {
  const top = stack[stack.length - 1];
  headEl.replaceChildren();

  if (stack.length > 1) {
    const back = el('button', {
      class: 'hh-back',
      type: 'button',
      'aria-label': 'Back',
      onclick: popView
    }, glyph('chevronLeft'));
    headEl.append(back, el('span', { class: 'hh-title', text: top.title }));
  } else {
    headEl.append(el('span', {
      class: 'hh-snip',
      text: `“${snippet(current?.text || '')}”`
    }));
  }

  footEl.hidden = stack.length > 1;
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function hide() {
  sizeObserver?.disconnect();
  sizeObserver = null;
  clearTimeout(heightTimer);
  panel = headEl = viewsEl = footEl = null;
  stack = [];
  heightLock = null;
  activeRow = -1;
  mode = 'hidden';
  current = null;
  if (ui) ui.layer.replaceChildren();
}

async function showIcon(selection) {
  await ensureUi();
  if (mode === 'panel') return; // a panel opened while we were waiting
  current = selection;
  mode = 'icon';

  const button = el('button', {
    class: 'hh-icon',
    type: 'button',
    title: 'Highlight Helper',
    'aria-label': 'Open Highlight Helper'
  }, markGlyph());

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel();
  });

  ui.layer.replaceChildren(button);
  position(selection.anchorRect, { align: 'end' });
  playEnter(button);
}

/** Collects menu rows from every detector that matched. */
function collectItems(api, forceIds = []) {
  const hits = detect(current.text, settings);

  // The right-click menu can request a detector the user has switched off.
  for (const id of forceIds) {
    if (hits.some((h) => h.detector.id === id)) continue;
    const detector = getDetector(id);
    if (!detector) continue;
    let match = null;
    try {
      match = detector.matches(current.text, settings);
    } catch { /* ignore */ }
    hits.unshift({ detector, match: match || {}, priority: -1 });
  }

  const items = [];
  for (const hit of hits) {
    let produced;
    try {
      produced = hit.detector.items({
        text: current.text,
        match: hit.match,
        settings,
        api
      });
    } catch (err) {
      console.warn(`[Highlight Helper] detector "${hit.detector.id}" failed:`, err);
      continue;
    }
    for (const item of produced || []) items.push(item);
  }
  return items;
}

async function openPanel({ openTo = null, forcedLanguage = null, forceIds = [] } = {}) {
  if (!current) return;
  await ensureUi();
  // ensureUi awaits the stylesheet on first use; the selection may be gone by now.
  if (!current) return;
  mode = 'panel';

  headEl = el('div', { class: 'hh-head' });
  viewsEl = el('div', { class: 'hh-views' });
  footEl = el('div', { class: 'hh-foot' },
    el('span', { text: 'Highlight Helper' }),
    el('button', { type: 'button', onclick: openOptions }, 'Settings')
  );

  panel = el('div', {
    class: 'hh-panel',
    role: 'dialog',
    'aria-label': 'Highlight Helper'
  }, headEl, viewsEl, footEl);

  stack = [];
  ui.layer.replaceChildren(panel);

  const api = makeApi(forcedLanguage ? { forcedLanguage } : {});
  const items = collectItems(api, forceIds);

  const root = items.length
    ? menu(items, api)
    : el('div', { class: 'hh-detail' },
        note('Nothing to convert, explain or rewrite in this selection.'));

  stack.push({ title: '', node: root });
  showView(stack[0], 'forward');

  playEnter(panel);

  // Right-click "Translate to…" opens straight into the translation.
  if (openTo) {
    const target = items.find((i) => i.key === openTo);
    if (target?.open) pushView(target.detailTitle || target.label, target.open(api));
  }
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

function menuRows() {
  const active = viewsEl?.lastElementChild;
  if (!active) return [];
  return [...active.querySelectorAll('.hh-item:not(.hh-item--static)')];
}

function highlightRow(index) {
  const rows = menuRows();
  for (const row of rows) delete row.dataset.active;
  if (!rows.length) return;
  activeRow = (index + rows.length) % rows.length;
  const row = rows[activeRow];
  row.dataset.active = '';
  row.scrollIntoView({ block: 'nearest' });
}

/** True when the page has focus somewhere we must not steal keys from. */
function pageIsTyping() {
  const active = deepActiveElement();
  return isTextField(active) || Boolean(active?.isContentEditable);
}

function onKeyDown(e) {
  if (mode === 'hidden') return;

  if (e.key === 'Escape') {
    if (mode === 'panel' && stack.length > 1) popView();
    else hide();
    e.preventDefault();
    return;
  }

  if (mode !== 'panel' || pageIsTyping()) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!menuRows().length) return;
    highlightRow(activeRow < 0 ? (e.key === 'ArrowDown' ? 0 : -1) : activeRow + (e.key === 'ArrowDown' ? 1 : -1));
    e.preventDefault();
  } else if (e.key === 'Enter' && activeRow >= 0) {
    menuRows()[activeRow]?.click();
    e.preventDefault();
  } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && stack.length > 1) {
    popView();
    e.preventDefault();
  }
}

/* ------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------ */

function scheduleEvaluate(delay = 220) {
  clearTimeout(evaluateTimer);
  evaluateTimer = setTimeout(evaluate, delay);
}

function evaluate() {
  if (suppressEvents || pointerDown) return;
  // Once the panel is open it stays open until Escape or a click outside.
  if (mode === 'panel') return;
  if (!settings || !isEnabledFor(settings, location.hostname)) {
    if (mode !== 'hidden') hide();
    return;
  }

  const selection = readSelection();
  if (!selection) {
    if (mode !== 'hidden') hide();
    return;
  }

  const trimmed = selection.text.trim();
  if (trimmed.length < MIN_CHARS || trimmed.length > MAX_CHARS) {
    if (mode !== 'hidden') hide();
    return;
  }

  if (mode === 'icon' && current?.text === selection.text) {
    current = selection;
    reposition();
    return;
  }

  showIcon(selection);
}

function onPointerDown(e) {
  if (ui && e.composedPath().includes(ui.host)) return;
  pointerDown = true;
  if (mode !== 'hidden') hide();
}

function onPointerUp() {
  pointerDown = false;
  scheduleEvaluate(40);
}

function onScrollOrResize() {
  if (mode === 'hidden') return;
  reposition();
}

/* Right-click -> "Translate to…" */
function onRuntimeMessage(msg) {
  if (msg?.type !== MSG.TRANSLATE_SELECTION) return;

  const live = readSelection();
  if (live) {
    current = live;
  } else if (msg.text?.trim()) {
    // Selection was lost (some pages clear it on right-click). Fall back to
    // the text Chrome captured, anchored near the top of the viewport.
    const vw = document.documentElement.clientWidth;
    const rect = {
      left: vw / 2 - 158, right: vw / 2 + 158,
      top: 80, bottom: 80, width: 316, height: 0
    };
    current = { text: msg.text, rect, anchorRect: rect, range: null, editable: null };
  } else {
    return;
  }

  openPanel({
    openTo: 'translate',
    forcedLanguage: msg.language,
    forceIds: ['translate']
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

(async function start() {
  settings = await getSettings();

  onSettingsChanged((next) => {
    settings = next;
    if (!isEnabledFor(settings, location.hostname)) hide();
  });

  document.addEventListener('selectionchange', () => scheduleEvaluate(), true);
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('mouseup', onPointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('pagehide', hide);

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
})();
