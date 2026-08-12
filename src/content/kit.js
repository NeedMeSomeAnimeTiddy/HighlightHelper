/**
 * DOM helpers shared by the panel and every detector.
 *
 * `menu()` is the important one: it renders the row list used both for the
 * root menu and for any submenu a detector wants to drill into, so a detector
 * never has to reproduce the styling or the keyboard/selection behaviour.
 */

import { glyph } from './icons.js';
import { MSG } from '../common/constants.js';

/** el('div', { class: 'x', onclick: fn }, child, 'text') */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export { glyph };

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

/**
 * A menu item:
 *   {
 *     key,                  unique id, used to open a view programmatically
 *     icon,                 glyph name from icons.js
 *     label,                row text
 *     value,                optional right-hand result: string | Promise<string>
 *     detailTitle,          header for the drilled-in view (defaults to label)
 *     open(api) -> Node     omit for a static, non-clickable row
 *   }
 */
function itemRow(item, api) {
  const clickable = typeof item.open === 'function';
  const row = el(clickable ? 'button' : 'div', {
    class: `hh-item${clickable ? '' : ' hh-item--static'}`,
    ...(clickable ? { type: 'button', role: 'menuitem', tabindex: '-1' } : {})
  });

  row.append(glyph(item.icon || 'dot'));
  row.append(el('span', { class: 'hh-lab', text: item.label }));

  const value = el('span', { class: 'hh-val' });
  if (item.value instanceof Promise) {
    value.append(el('span', { class: 'hh-dots', 'aria-label': 'Loading' }));
    item.value.then(
      (v) => { value.replaceChildren(document.createTextNode(v ?? '—')); },
      () => {
        value.replaceChildren(glyph('warn', 'hh-glyph hh-glyph--warn'));
        value.title = 'Could not fetch this — open the row for details';
      }
    );
  } else if (item.value != null) {
    value.textContent = item.value;
  }
  row.append(value);

  if (clickable) {
    row.append(glyph('chevronRight', 'hh-glyph hh-chev'));
    row.addEventListener('click', () => {
      api.push(item.detailTitle || item.label, item.open(api));
    });
  }

  return row;
}

/**
 * Renders a list of items as a menu.
 *
 * The items are stashed on the element so the panel can drill straight to a
 * row inside a submenu — a right-click on "Rewrite → More formal" has to find
 * `rewrite:formal`, which only exists once the parent row has been opened.
 */
export function menu(items, api) {
  const list = el('div', { class: 'hh-menu', role: 'menu' });
  for (const item of items) list.append(itemRow(item, api));
  list.hhItems = items;
  return list;
}

/* ------------------------------------------------------------------ *
 * Pieces used inside drilled-in views
 * ------------------------------------------------------------------ */

export function btn(label, onClick, { variant = '', title = '', disabled = false, icon = null } = {}) {
  const node = el('button', {
    class: `hh-btn ${variant}`.trim(),
    type: 'button',
    title,
    disabled,
    onclick: onClick
  });
  if (icon) node.append(glyph(icon, 'hh-glyph hh-btn-icon'));
  node.append(el('span', { text: label }));
  return node;
}

export function spinner(label = 'Working…') {
  return el('div', { class: 'hh-loading' },
    el('span', { class: 'hh-spinner', 'aria-hidden': 'true' }),
    el('span', { text: label })
  );
}

export function note(text, variant = '') {
  return el('p', { class: `hh-note ${variant}`.trim(), text });
}

export function quote(text) {
  return el('blockquote', { class: 'hh-quote', text });
}

export function errorBox(message, { onRetry, onSettings } = {}) {
  const box = el('div', { class: 'hh-error' },
    glyph('warn', 'hh-glyph hh-glyph--warn'),
    el('span', { text: message })
  );
  const actions = el('div', { class: 'hh-row' });
  if (onRetry) actions.append(btn('Try again', onRetry));
  if (onSettings) actions.append(btn('Open settings', onSettings, { variant: 'hh-primary' }));
  const wrap = el('div', {}, box);
  if (actions.childElementCount) wrap.append(actions);
  return wrap;
}

/** Swaps a container's contents in one go. */
export function replaceContent(container, ...nodes) {
  container.replaceChildren(...nodes.flat().filter(Boolean));
  return container;
}

/** Copy button that confirms on itself rather than in a toast. */
export function copyButton(text, api) {
  const copy = btn('Copy', async () => {
    const ok = await api.copy(text);
    swap(copy, ok ? 'Copied' : 'Copy failed', 'Copy');
  }, { icon: 'copy' });
  return copy;
}

/** Copy/Replace pair with transient confirmation on the button itself. */
export function actionRow(text, api, extra = []) {
  const copy = copyButton(text, api);

  const replace = btn('Replace', async () => {
    const ok = await api.replace(text);
    swap(replace, ok ? 'Replaced' : "Couldn't replace", 'Replace');
  }, {
    variant: 'hh-primary',
    icon: 'replace',
    disabled: !api.canReplace,
    title: api.canReplace
      ? 'Replace the selected text on the page'
      : "The selected text isn't in an editable field"
  });

  return el('div', { class: 'hh-row' }, copy, replace, ...extra);
}

function swap(button, temporary, original) {
  const span = button.querySelector('span:last-child');
  span.textContent = temporary;
  setTimeout(() => { span.textContent = original; }, 1400);
}

/** The standard result view: the text, then Copy / Replace. */
export function resultView(text, api, { label = '', extra = [] } = {}) {
  return el('div', { class: 'hh-detail' },
    label ? el('div', { class: 'hh-label', text: label }) : null,
    el('div', { class: 'hh-text', text }),
    actionRow(text, api, extra)
  );
}

/**
 * "Look this up" — an encyclopedia reference for `term`, appended to `host`.
 *
 * Not a citation for whatever the model just said. The model cannot cite
 * anything, so this is an independent lookup the reader can weigh against the
 * explanation, and the wording says so.
 */
export function sourceButton(term, api, host, { context = '' } = {}) {
  const panel = el('div', { class: 'hh-source' });

  const button = btn('Find a source', async () => {
    button.replaceWith(panel);
    replaceContent(panel, spinner('Looking for a reference…'));
    try {
      const res = await api.send({ type: MSG.SOURCE, term, context });
      if (!res?.ok) throw new Error(res?.error || 'Lookup failed');
      const articles = res.articles || [];
      replaceContent(panel, articles.length
        ? articleCard(articles, 0, panel, api)
        : noArticle(term, res.links));
    } catch (err) {
      replaceContent(panel, errorBox(String(err.message || err)));
    }
    api.resize?.();
  }, { icon: 'source' });

  host.append(button);
  return button;
}

function openTab(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * One article, plus a way to reach the others.
 *
 * Ambiguous terms are the normal case, not the exception — "SLA" and "Mercury"
 * both have several plausible articles — so the alternatives stay visible
 * rather than the panel quietly committing to one reading.
 */
function articleCard(articles, index, panel, api) {
  const found = articles[index];
  const others = articles.filter((_, i) => i !== index);

  const box = el('div', { class: 'hh-source-card' });
  replaceContent(box,
    el('div', { class: 'hh-label', text: `Wikipedia · ${found.lang}` }),
    el('div', { class: 'hh-source-title', text: found.title }),
    found.description ? el('p', { class: 'hh-sub', text: found.description }) : null,
    el('p', { class: 'hh-source-extract', text: found.extract }),
    el('div', { class: 'hh-row' },
      btn('Open article', () => openTab(found.url), { variant: 'hh-primary', icon: 'source' })),
    others.length
      ? el('div', { class: 'hh-row' },
          el('span', { class: 'hh-sub', text: 'Did you mean:' }),
          ...others.map((alt) => btn(alt.title, () => {
            replaceContent(panel, articleCard(articles, articles.indexOf(alt), panel, api));
            api.resize?.();
          })))
      : null,
    note('An independent reference, not a citation for the explanation above.')
  );
  return box;
}

function noArticle(term, links = []) {
  const box = el('div', { class: 'hh-source-card' });
  replaceContent(box,
    note(`No encyclopedia article for “${term}”. Search instead:`),
    el('div', { class: 'hh-row' },
      ...links.map((l) => btn(l.label, () => openTab(l.url))))
  );
  return box;
}

/**
 * Runs `producer` into a fresh container: spinner, then result or error.
 * Returns the container synchronously so it can be pushed as a view.
 */
export function asyncView(loadingLabel, producer, onError) {
  const box = el('div', { class: 'hh-detail' });
  const run = () => {
    replaceContent(box, spinner(loadingLabel));
    Promise.resolve()
      .then(producer)
      .then((node) => replaceContent(box, node))
      .catch((err) => replaceContent(box, onError(err, run)));
  };
  run();
  return box;
}
