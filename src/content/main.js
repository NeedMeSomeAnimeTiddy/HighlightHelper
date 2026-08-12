/**
 * Highlight Helper — in-page controller.
 *
 * Flow: selection -> small icon -> click -> panel of detector tabs.
 * Everything lives in a shadow root attached to <html>, positioned in document
 * coordinates, so page CSS can't touch it and it scrolls with the content.
 *
 * This file deliberately knows nothing about currencies, units or prompts —
 * that all lives in ./detectors/*.
 */

import { getSettings, onSettingsChanged, isEnabledFor } from '../common/settings.js';
import { MSG, ERR } from '../common/constants.js';
import { detect, getDetector } from './detectors/index.js';
import { el, btn, errorBox, replaceContent } from './kit.js';

const MIN_CHARS = 2;
const MAX_CHARS = 8000;
const GAP = 8;
const EDGE = 8;

const ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M14.2 3.6 20.4 9.8 11.6 18.6H5.4v-6.2z" fill="#f5c518" fill-opacity=".35"/>' +
  '<path d="M14.2 3.6 20.4 9.8 11.6 18.6H5.4v-6.2z" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M4 21.2h16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round"/></svg>';

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
  host.style.cssText =
    'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0;';

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

  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); hide(); }
  });

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
    if (r.width || r.height) return r;
    return null;
  }
  return current.anchorRect;
}

/* ------------------------------------------------------------------ *
 * Positioning
 * ------------------------------------------------------------------ */

/**
 * Places the layer's single child near `anchor` (a viewport rect), flipping
 * above when there's no room below and clamping to the viewport edges.
 */
function position(anchor, { align = 'start' } = {}) {
  const node = ui.layer.firstElementChild;
  if (!node || !anchor) return;

  const w = node.offsetWidth;
  const h = node.offsetHeight;
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

function reposition() {
  if (mode === 'hidden' || !ui) return;
  const anchor = liveAnchorRect();
  if (!anchor) { hide(); return; }
  position(anchor, mode === 'icon' ? { align: 'end' } : {});
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
  [ERR.NO_KEY]: 'Add your DeepSeek API key in settings to use the AI features.',
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
    ...extra
  };
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function hide() {
  if (!ui) { mode = 'hidden'; current = null; return; }
  ui.layer.replaceChildren();
  mode = 'hidden';
  current = null;
}

async function showIcon(selection) {
  await ensureUi();
  current = selection;
  mode = 'icon';

  const button = el('button', {
    class: 'hh-icon',
    type: 'button',
    title: 'Highlight Helper',
    'aria-label': 'Open Highlight Helper',
    html: ICON_SVG
  });
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel();
  });

  ui.layer.replaceChildren(button);
  position(selection.anchorRect, { align: 'end' });
  requestAnimationFrame(() => button.classList.add('hh-in'));
}

async function openPanel({ preselect = null, forcedLanguage = null, forceIds = [] } = {}) {
  if (!current) return;
  await ensureUi();
  mode = 'panel';

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

  const panel = el('div', {
    class: 'hh-panel',
    role: 'dialog',
    'aria-label': 'Highlight Helper'
  });

  const body = el('div', { class: 'hh-body' });

  if (!hits.length) {
    panel.append(
      body,
      el('div', { class: 'hh-foot' },
        el('span', { text: 'Highlight Helper' }),
        btn('Settings', openOptions))
    );
    replaceContent(body, el('p', { class: 'hh-note', text: 'Nothing to do with this selection.' }));
    ui.layer.replaceChildren(panel);
    position(liveAnchorRect() || current.anchorRect);
    requestAnimationFrame(() => panel.classList.add('hh-in'));
    return;
  }

  const api = makeApi(forcedLanguage ? { forcedLanguage } : {});
  const tabsRow = el('div', { class: 'hh-tabs', role: 'tablist' });
  const rendered = new Map();

  function selectTab(id) {
    for (const tab of tabsRow.children) {
      tab.setAttribute('aria-selected', String(tab.dataset.id === id));
    }
    if (!rendered.has(id)) {
      const hit = hits.find((h) => h.detector.id === id);
      let node;
      try {
        node = hit.detector.render({
          text: current.text,
          match: hit.match,
          settings,
          api
        });
      } catch (err) {
        console.warn(`[Highlight Helper] "${id}" render failed:`, err);
        node = errorBox(`This tool failed: ${err.message}`);
      }
      rendered.set(id, node);
    }
    replaceContent(body, rendered.get(id));
    // Content height changes as results come in; keep the panel on screen.
    requestAnimationFrame(reposition);
  }

  for (const hit of hits) {
    const tab = el('button', {
      class: 'hh-tab',
      type: 'button',
      role: 'tab',
      'aria-selected': 'false',
      dataset: { id: hit.detector.id }
    }, hit.detector.title);
    tab.addEventListener('click', () => selectTab(hit.detector.id));
    tabsRow.append(tab);
  }

  tabsRow.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const ids = hits.map((h) => h.detector.id);
    const active = [...tabsRow.children].findIndex(
      (t) => t.getAttribute('aria-selected') === 'true'
    );
    const next = (active + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    selectTab(ids[next]);
    tabsRow.children[next].focus();
    e.preventDefault();
  });

  const foot = el('div', { class: 'hh-foot' },
    el('span', { text: 'Highlight Helper' }),
    btn('Settings', openOptions)
  );

  panel.append(tabsRow, body, foot);
  ui.layer.replaceChildren(panel);

  const chosen = hits.some((h) => h.detector.id === preselect)
    ? preselect
    : hits[0].detector.id;
  selectTab(chosen);

  position(liveAnchorRect() || current.anchorRect);
  requestAnimationFrame(() => panel.classList.add('hh-in'));
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

function onKeyDown(e) {
  // Keyboard selection (shift+arrows) is covered by selectionchange; the only
  // key we care about here is the dismiss.
  if (e.key === 'Escape' && mode !== 'hidden') hide();
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
    // the text Chrome captured, anchored to the middle of the viewport.
    const vw = document.documentElement.clientWidth;
    const rect = { left: vw / 2 - 170, right: vw / 2 + 170, top: 80, bottom: 80, width: 340, height: 0 };
    current = { text: msg.text, rect, anchorRect: rect, range: null, editable: null };
  } else {
    return;
  }

  openPanel({
    preselect: 'translate',
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
