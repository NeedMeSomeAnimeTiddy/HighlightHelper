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
import { MSG, ERR, PROVIDER } from '../common/constants.js';
import { TOOL_HINTS, toolFamily, detectorForTool } from '../common/tools.js';
import { detect, getDetector } from './detectors/index.js';
import { el, menu, glyph, errorBox, note } from './kit.js';
import { markGlyph } from './icons.js';
import { runLocal, isSupported as localSupported } from './local-ai.js';
import { restore as restoreHighlights, watch as watchHighlights } from './highlights.js';

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

/**
 * Loads panel.css.
 *
 * The direct fetch is the fast path, but a content script's fetch runs against
 * the page's network context — a site with a restrictive `connect-src` can stop
 * us reading our own extension's files, and the panel would render unstyled.
 * The worker has no such restriction, so it is the fallback.
 */
async function loadCss() {
  try {
    const res = await fetch(chrome.runtime.getURL('src/content/panel.css'));
    if (res.ok) {
      const text = await res.text();
      if (text) return text;
    }
  } catch {
    /* blocked by the page's policy — ask the worker instead */
  }
  try {
    const res = await send({ type: MSG.STYLESHEET });
    return res?.ok ? res.css : '';
  } catch {
    return '';
  }
}

// Started immediately; it's needed before the first paint.
const cssPromise = loadCss();

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
  [ERR.NO_KEY]:
    'This needs an AI provider. Either turn on the on-device model or add a ' +
    'DeepSeek API key — both are in settings.',
  [ERR.NO_LOCAL_MODEL]:
    'Answers are set to stay on this machine, and the on-device model can\'t ' +
    "handle this one — it may be too long, or the model isn't installed. " +
    'Settings can allow DeepSeek as a fallback.',
  [ERR.BAD_KEY]: 'DeepSeek rejected that API key. Check it in settings.',
  [ERR.NO_FUNDS]: 'Your DeepSeek account is out of credit.',
  [ERR.RATE_LIMIT]: 'DeepSeek is rate-limiting right now. Try again in a moment.',
  [ERR.OFFLINE]: "Couldn't reach DeepSeek. Check your connection.",
  [ERR.TIMEOUT]: 'That request timed out.',
  [ERR.STALE_WORKER]:
    'This tool is newer than the running background script. Open chrome://extensions ' +
    'and press reload on Highlight Helper.'
};

function errorFor(err, retry) {
  const code = String(err?.message || err);
  // Every one of these is fixed in settings, not by pressing the button again.
  const needsKey =
    code === ERR.NO_KEY || code === ERR.BAD_KEY || code === ERR.NO_LOCAL_MODEL;
  // Retrying a stale worker just repeats the same failure.
  const canRetry = !needsKey && code !== ERR.STALE_WORKER;
  return errorBox(FRIENDLY[code] || code, {
    onRetry: canRetry ? retry : null,
    onSettings: needsKey ? openOptions : null
  });
}

function makeApi(extra = {}) {
  return {
    settings,
    context: { title: document.title, host: location.hostname, url: location.href },
    canReplace: Boolean(current?.editable),
    send,
    /**
     * One call, two providers.
     *
     * Every detector goes through here, so this is the only place that knows
     * there is a choice at all. On-device first when it's allowed, DeepSeek
     * otherwise — and an on-device model that can't serve this particular
     * action is not an error, it's a fall-through.
     */
    async ai(action, text, options = {}) {
      const merged = { language: settings.language, ...options };
      const provider = settings.aiProvider || PROVIDER.AUTO;
      const pinnedLocal = provider === PROVIDER.LOCAL;

      if (provider !== PROVIDER.CLOUD && localSupported()) {
        try {
          const local = await runLocal(action, text, merged, { cacheDays: settings.cacheDays });
          if (local) return { ok: true, ...local };
        } catch (err) {
          // Pinned to local means "don't send my text anywhere", so a failure
          // has to surface rather than quietly becoming a network request.
          if (pinnedLocal) throw err;
          console.warn('[Highlight Helper] on-device model failed, using DeepSeek:', err);
        }
      }

      if (pinnedLocal) throw new Error(ERR.NO_LOCAL_MODEL);

      const res = await send({ type: MSG.AI, action, text, options: merged });
      if (!res?.ok) throw new Error(res?.error || 'Request failed');
      return res;
    },
    copy: copyText,
    replace: replaceSelection,
    errorFor,
    openOptions,
    // For content that grows after its view was measured, e.g. an appended
    // source card. Harmless when the height is already correct.
    resize: () => {
      const active = viewsEl?.lastElementChild;
      if (active) animateViewsTo(active.offsetHeight);
    },
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

  // The right-click menu can ask for a detector the user has switched off.
  // Only the settings toggle is bypassed — if `matches` still says no, the row
  // genuinely does not apply and the caller explains why. Inventing an empty
  // match here would produce rows like "undefined words".
  for (const id of forceIds) {
    if (hits.some((h) => h.detector.id === id)) continue;
    const detector = getDetector(id);
    if (!detector) continue;
    let match = null;
    try {
      match = detector.matches(current.text, settings);
    } catch { /* ignore */ }
    if (match) hits.unshift({ detector, match, priority: -1 });
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

/**
 * Opens the row `key` names, descending one level into a submenu if needed.
 * Returns false when no such row exists for this selection.
 */
function drillTo(key, items, api) {
  const exact = items.find((item) => item.key === key);
  if (exact?.open) {
    pushView(exact.detailTitle || exact.label, exact.open(api));
    return true;
  }

  const parent = items.find((item) => key.startsWith(`${item.key}:`));
  if (!parent?.open) return false;

  const submenu = parent.open(api);
  const child = submenu.hhItems?.find((item) => item.key === key);
  if (!child?.open) return false;

  pushView(parent.detailTitle || parent.label, submenu);
  pushView(child.detailTitle || child.label, child.open(api));
  return true;
}

async function openPanel({ openTo = null, forcedLanguage = null, forceIds = [], notice = null } = {}) {
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

  let root;
  if (items.length) {
    root = menu(items, api);
    if (notice) root.prepend(note(notice, 'hh-warn'));
  } else {
    root = el('div', { class: 'hh-detail' },
      note(notice || 'Nothing to convert, explain or rewrite in this selection.'));
  }

  stack.push({ title: '', node: root });
  showView(stack[0], 'forward');

  playEnter(panel);

  // A right-click asked for one specific tool — go straight to it.
  if (openTo && !drillTo(openTo, items, api)) {
    root.prepend(note(
      TOOL_HINTS[toolFamily(openTo)] || "That tool doesn't apply to this selection.",
      'hh-warn'
    ));
    animateViewsTo(root.offsetHeight);
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

/**
 * Right-click menu. `tool` is a row key, or 'menu' for the detected list.
 *
 * This is the path that has to work when the selection icon never appeared, so
 * it does not depend on our own listeners having fired: it re-reads the live
 * selection, and falls back to the text Chrome captured with the click.
 */
function onRuntimeMessage(msg, sender, sendResponse) {
  // The toolbar popup asks this to tell "not running here" apart from
  // "running but did nothing" — the two look identical from the page.
  if (msg?.type === MSG.PING) {
    sendResponse({
      ok: true,
      version: chrome.runtime.getManifest().version,
      host: location.hostname,
      enabledHere: Boolean(settings && isEnabledFor(settings, location.hostname)),
      frame: window === window.top ? 'top' : 'sub'
    });
    return;
  }

  if (msg?.type !== MSG.RUN_TOOL) return;

  const live = readSelection();
  if (live) {
    current = live;
  } else if (msg.text?.trim()) {
    // Some pages clear the selection on right-click, and on others our own
    // listeners never ran. Anchor near the top of the viewport instead.
    const vw = document.documentElement.clientWidth;
    const rect = {
      left: vw / 2 - 158, right: vw / 2 + 158,
      top: 80, bottom: 80, width: 316, height: 0
    };
    current = { text: msg.text, rect, anchorRect: rect, range: null, editable: null };
  } else {
    return;
  }

  const tool = msg.tool === 'menu' ? null : msg.tool;
  openPanel({
    openTo: tool,
    forcedLanguage: msg.language || null,
    // Honour an explicit request even for a detector switched off in settings.
    forceIds: tool ? [detectorForTool(tool)] : [],
    notice: settings && !isEnabledFor(settings, location.hostname)
      ? 'Highlight Helper is switched off for this site — opened from the right-click menu.'
      : null
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

  /*
   * Saved highlights are repainted on load, and only then — this is the one
   * thing the extension does without being asked, so it stays cheap and it
   * stays off unless the site is enabled and the tool is on.
   *
   * It is deliberately not awaited: re-finding text walks the document, and
   * nothing above should wait on it to start listening for selections.
   */
  if (settings.detectors.highlight !== false && isEnabledFor(settings, location.hostname)) {
    restoreHighlights()
      .then(({ found }) => { if (found) watchHighlights(); })
      .catch((err) => console.warn('[Highlight Helper] could not restore highlights:', err));
  }
})();
