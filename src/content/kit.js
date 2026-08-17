/**
 * DOM helpers shared by the panel and every detector.
 *
 * `menu()` is the important one: it renders the row list used both for the
 * root menu and for any submenu a detector wants to drill into, so a detector
 * never has to reproduce the styling or the keyboard/selection behaviour.
 */

import { glyph } from './icons.js';
import { MSG, AI } from '../common/constants.js';
import { parseTopics } from '../common/text.js';

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
 *     value,                right-hand result: string | Promise<string> | { task }
 *     detailTitle,          header for the drilled-in view (defaults to label)
 *     detail,               a view spec — see renderView. Preferred.
 *     open(api) -> Node     the older, DOM-returning form. Still supported.
 *   }
 *
 * `detail` and `open` are the same idea in two forms. `open` builds DOM, which
 * only a browser can do; `detail` describes what to build, which anything can.
 * The Android app renders the same rows natively and cannot call `open`, so new
 * detectors describe and old ones still build — see `rows()` in detectors/index.js.
 *
 * `value` as `{ task }` is the lazy form of the Promise: the work starts when
 * the row renders rather than when the row is constructed. Detection runs on
 * every selection, so a row that costs a network call must not start one just by
 * existing — `matches()` deciding a row applies is not the user asking for it.
 */
function itemRow(item, api) {
  const clickable = typeof item.open === 'function' || Boolean(item.detail);
  const row = el(clickable ? 'button' : 'div', {
    class: `hh-item${clickable ? '' : ' hh-item--static'}`,
    ...(clickable ? { type: 'button', role: 'menuitem', tabindex: '-1' } : {})
  });

  row.append(glyph(item.icon || 'dot'));
  row.append(el('span', { class: 'hh-lab', text: item.label }));

  const value = el('span', { class: 'hh-val' });
  const pending = item.value instanceof Promise
    ? item.value
    : (typeof item.value?.task === 'function' ? item.value.task(api) : null);

  if (pending) {
    value.append(el('span', { class: 'hh-dots', 'aria-label': 'Loading' }));
    Promise.resolve(pending).then(
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
      api.push(item.detailTitle || item.label, openRow(item, api));
    });
  }

  return row;
}

/** The node a row drills into, whichever form the detector used. */
export function openRow(item, api) {
  return typeof item.open === 'function'
    ? item.open(api)
    : renderView(item.detail, api);
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
 * View specs
 *
 * A detail view described as data rather than built as DOM, so that the same
 * detector can drive the extension's panel and the Android app's bottom sheet
 * without either one owning the other's widgets.
 *
 * A spec is one of four kinds:
 *
 *   { kind: 'blocks', blocks }                     static content
 *   { kind: 'menu',   rows }                       a nested submenu
 *   { kind: 'async',  loading, run }               spinner, then blocks
 *   { kind: 'stream', loading, run, done }         tokens as they arrive
 *
 * `run` and `done` are ordinary functions. They are never serialised — the JS
 * runs in-process on both platforms, so a spec crossing to Kotlin carries an id
 * and the bridge calls back in. What must not appear in a spec is a DOM node,
 * because that is the one thing the other side cannot use.
 * ------------------------------------------------------------------ */

/** Blocks, in the order a detail view tends to use them. */
const BLOCKS = {
  label: (b) => el('div', { class: 'hh-label', text: b.text }),

  note: (b) => note(b.text, b.variant || ''),

  quote: (b) => quote(b.text),

  /**
   * Three shapes, because the panel genuinely has three.
   *
   * `from` is a conversion: muted source, arrow, prominent result. `trailing`
   * is the other way round — the answer first, with a detail hanging off it
   * (a date and the time it was at), where an arrow would imply a conversion
   * that isn't happening. Neither is the plain single-value case.
   */
  headline: (b) => {
    if (b.from != null) {
      return el('div', { class: 'hh-headline' },
        el('span', { class: 'hh-from', text: b.from }),
        el('span', { class: 'hh-arrow', text: b.op || '→' }),
        el('span', { text: b.text }));
    }
    if (b.trailing != null) {
      return el('div', { class: 'hh-headline' },
        el('span', { text: b.text }),
        el('span', { class: 'hh-from', text: b.trailing }));
    }
    return el('div', { class: 'hh-headline', text: b.text });
  },

  sub: (b) => el('p', { class: 'hh-sub', text: b.text }),

  /**
   * Label/value pairs. `mono` sets the value in the monospaced face; `monoLabel`
   * does the same to the label, which is what a regex flag or a header name
   * needs — there the token is the code and the prose is the explanation.
   */
  facts: (b) => el('div', { class: 'hh-facts' },
    ...(b.label ? [el('div', { class: 'hh-label', text: b.label })] : []),
    ...b.items.map((f) => el('div', { class: 'hh-fact' },
      el('em', { class: f.monoLabel ? 'hh-mono' : '', text: f.label }),
      el('span', { class: f.mono ? 'hh-mono' : '', text: f.value })))),

  /**
   * An indented breakdown — the regex explainer, and the only view whose
   * structure carries meaning that `facts` throws away.
   *
   * Nesting depth is the whole point: `(a(b))` is not the same pattern as
   * `(a)(b)`, and a flat list of tokens says they are. The panel already has
   * `.hh-step` styling for this, so the block exists to describe what was
   * always being drawn rather than to invent something.
   */
  steps: (b) => el('div', { class: 'hh-steps' },
    ...b.items.map((s) => el('div', {
      class: 'hh-step',
      style: `padding-left:${(s.depth || 0) * 11}px`
    },
      el('code', { class: 'hh-mono hh-step-token', text: s.token }),
      el('span', { class: 'hh-step-text', text: s.description })))),

  /**
   * A block of code, in the monospaced boxed style.
   *
   * Distinct from `text` because code is the one kind of answer where the
   * whitespace is load-bearing — a commented function rendered in a
   * proportional face that wraps is not the thing the user asked to copy.
   */
  code: (b) => el('pre', { class: 'hh-code', text: b.text }),

  /**
   * A run of text. `rich` sends it through the markdown reader — model output
   * only. `dim` is the continuation case: the original in grey, the new text
   * after it, so it is obvious which half the model wrote.
   */
  text: (b) => (b.dim
    ? el('div', { class: 'hh-text' },
        el('span', { class: 'hh-dim', text: b.dim }), ' ', el('span', { text: b.text }))
    : (b.rich ? textBlock(b.text) : el('div', { class: 'hh-text', text: b.text }))),

  swatch: (b) => {
    const chip = el('div', { class: 'hh-swatch' });
    chip.style.setProperty('--swatch', b.css);
    return el('div', { class: 'hh-swatch-row' }, chip,
      el('div', {},
        el('div', { class: 'hh-headline', text: b.title }),
        b.sub ? el('p', { class: 'hh-sub', text: b.sub }) : null));
  },

  actions: (b, api) => actionRow(b.text, api,
    (b.extra || []).map((x) => btn(x.label, () => x.run(api), { icon: x.icon }))),

  /**
   * A row of buttons. An item is either a copy button — `{ copy: text }` — or
   * an ordinary one, `{ label, icon, variant, run(api) }`.
   *
   * Copy is called out rather than left as another `run` because it is not just
   * another callback: it confirms on itself, flipping its own label to "Copied"
   * for a moment instead of raising a toast. Expressing that as a generic
   * button would lose the confirmation, and a `confirm` flag on every button
   * would push the exception onto the twenty that never need it. Naming it also
   * gives a native renderer something it can map to a real copy affordance
   * rather than an opaque callback — and it can appear anywhere in the row,
   * which a copy-only block could not.
   */
  buttons: (b, api) => el('div', { class: 'hh-row' },
    ...b.items.map((x) => (x.copy != null
      ? copyButton(x.copy, api)
      : btn(x.label, () => x.run(api), { icon: x.icon, variant: x.variant || '' })))),

  menu: (b, api) => menu(b.rows, api),

  /**
   * The escape hatch, and deliberately part of the contract rather than a gap
   * in it. A few views are genuinely browser-shaped — the QR canvas, the
   * "Find a source" panel — and forcing them into block types nothing else uses
   * would make the vocabulary worse for the twenty views that fit it. Android
   * skips a block it has no renderer for and says so, which is the honest
   * outcome: a missing panel, not a crash.
   */
  custom: (b, api) => b.render(api)
};

function block(spec, api) {
  const make = BLOCKS[spec?.type];
  if (!make) {
    console.warn('[Highlight Helper] unknown block type:', spec?.type);
    return null;
  }
  return make(spec, api);
}

export function blocks(list, api) {
  return (list || []).map((b) => block(b, api)).filter(Boolean);
}

/** A view spec, rendered into the panel. */
export function renderView(spec, api) {
  if (!spec) return note('Nothing to show.');

  switch (spec.kind) {
    case 'menu':
      return menu(spec.rows, api);

    /*
     * Both of these re-measure once the result lands.
     *
     * The panel's resting height is `auto`, so content that arrives late is
     * never clipped — but the view was measured and animated to while it was
     * still a spinner, and the panel is positioned from that measurement. Left
     * alone, a long answer grows downwards off the bottom of the viewport
     * instead of the panel flipping above the selection. Several of the
     * hand-built views called `api.resize()` for exactly this; doing it here
     * means none of them has to remember.
     */
    case 'async':
      return asyncView(
        spec.loading || 'Working…',
        async () => {
          const node = el('div', {}, ...blocks(await spec.run(api), api));
          queueMicrotask(() => api.resize?.());
          return node;
        },
        (err, retry) => api.errorFor(err, retry)
      );

    case 'stream':
      return streamView(
        spec.loading || 'Working…',
        (emit) => spec.run(api, emit),
        (res) => {
          const node = el('div', {}, ...blocks(spec.done(res, api), api));
          queueMicrotask(() => api.resize?.());
          return node;
        },
        (err, retry) => api.errorFor(err, retry)
      );

    case 'blocks':
    default:
      return el('div', { class: 'hh-detail' }, ...blocks(spec.blocks, api));
  }
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

/* ------------------------------------------------------------------ *
 * Model output
 * ------------------------------------------------------------------ */

/**
 * The little markdown a model emits, rendered rather than shown raw.
 *
 * Every prompt here asks for a bare answer and most of them say "no markdown",
 * and models emit `**like this**` anyway — so the panel showed the asterisks.
 * Instructing harder does not work; rendering does, and bold in a summary is
 * genuinely useful once it is bold.
 *
 * Built from DOM nodes, never `innerHTML`. This is model output being placed
 * on a page the extension does not own, so it can be text or it can be
 * elements this file constructed, and nothing in between.
 *
 * Deliberately tiny: bold, italic, inline code, bullets, headings. Links are
 * *not* rendered — a clickable URL that a model invented is exactly the
 * fabricated citation the whole "Find a source" design exists to avoid.
 */
/**
 * The emphasis markers, with markdown's own rule that the content may not
 * begin or end with a space — which is what stops "2 * 3 * 4" being read as
 * italic. The lookarounds on `_` keep snake_case identifiers intact.
 */
const RUN = String.raw`\S(?:[^\n]*?\S)?`;
const INLINE = new RegExp(
  [
    String.raw`\*\*(${RUN})\*\*`,
    String.raw`__(${RUN})__`,
    String.raw`\*(${RUN})\*`,
    String.raw`(?<![a-z0-9])_(${RUN})_(?![a-z0-9])`,
    String.raw`\`([^\`\n]+)\``
  ].join('|'),
  'gi'
);

/**
 * Splits a model's answer into `{ tag, text }` tokens — `tag` being null for
 * ordinary text, or 'strong' / 'em' / 'code'.
 *
 * Separate from the DOM building so the fiddly half can be tested in Node,
 * which is where the mistakes are: an italic marker eating a snake_case
 * identifier, or a multiplication sign being read as emphasis.
 */
export function parseMarkup(raw) {
  const tokens = [];
  const push = (tag, text) => { if (text) tokens.push({ tag, text }); };

  String(raw ?? '').split('\n').forEach((line, i) => {
    if (i) push(null, '\n');

    const text = line
      .replace(/^\s*#{1,6}\s+/, '')          // headings lose their hashes
      .replace(/^(\s*)[-*+]\s+/, '$1• ');    // list markers become the panel's bullet

    let last = 0;
    let m;
    INLINE.lastIndex = 0;

    while ((m = INLINE.exec(text))) {
      push(null, text.slice(last, m.index));
      const [, bold1, bold2, it1, it2, code] = m;
      if (bold1 ?? bold2) push('strong', bold1 ?? bold2);
      else if (it1 ?? it2) push('em', it1 ?? it2);
      else push('code', code);
      last = m.index + m[0].length;
    }

    push(null, text.slice(last));
  });

  return tokens;
}

export function richText(raw) {
  return parseMarkup(raw).map(({ tag, text }) =>
    (tag ? el(tag, { text }) : document.createTextNode(text)));
}

/** The standard block for a model's answer. */
export function textBlock(text, className = 'hh-text') {
  return el('div', { class: className }, ...richText(text));
}

/**
 * The suffix on a result's label: where the answer came from.
 *
 * "on-device" is worth saying every time. The difference between an answer
 * computed on this machine and one that involved sending the selection to
 * another company is not a detail, and it is invisible unless the panel says
 * so. `res` is whatever api.ai() resolved to.
 */
export function provenance(res) {
  const parts = [];
  if (res?.cached) parts.push('cached');
  if (res?.local) parts.push('on-device');
  return parts.length ? ` · ${parts.join(', ')}` : '';
}

/** The same thing as its own line, for views that have no label to hang it on. */
export function provenanceNote(res) {
  const text = provenance(res).replace(/^ · /, '');
  return text ? el('p', { class: 'hh-sub', text: text[0].toUpperCase() + text.slice(1) }) : null;
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
/** Looks one term up and renders the result into `into`. */
async function lookupInto(into, api, term, context) {
  replaceContent(into, spinner(`Looking up “${term}”…`));
  try {
    const res = await api.send({ type: MSG.SOURCE, term, context });
    if (!res?.ok) throw new Error(res?.error || 'Lookup failed');
    const articles = res.articles || [];
    replaceContent(into, articles.length
      ? articleCard(articles, 0, into, api)
      : noArticle(term, res.links));
  } catch (err) {
    replaceContent(into, errorBox(String(err.message || err)));
  }
  api.resize?.();
}

/** "Find a source" for a selection that already *is* the term — see jargon.js. */
export function sourceButton(term, api, host, { context = '' } = {}) {
  const panel = el('div', { class: 'hh-source' });
  const button = btn('Find a source', () => {
    button.replaceWith(panel);
    lookupInto(panel, api, term, context);
  }, { icon: 'source' });

  host.append(button);
  return button;
}

/**
 * "Find a source" for a selection with no obvious title — a code snippet or a
 * paragraph of prose.
 *
 * Searching Wikipedia for a whole paragraph returns noise, so the model is
 * asked what the text is *about* first. That is the one thing it can do here
 * without risk: it picks the search term, and Wikipedia decides whether such an
 * article exists. An invented topic simply finds nothing.
 *
 * Only the first topic is looked up; the others are buttons, so the common case
 * costs one search rather than three.
 */
export function topicSourceButton(text, api, host, { context = '' } = {}) {
  const panel = el('div', { class: 'hh-source' });

  const button = btn('Find a source', async () => {
    button.replaceWith(panel);
    replaceContent(panel, spinner('Working out what this is about…'));
    try {
      const res = await api.ai(AI.TOPICS, text);
      const topics = parseTopics(res.text);
      if (!topics.length) {
        replaceContent(panel, el('div', { class: 'hh-source-card' },
          note('Nothing here that an encyclopedia would have an article on.')));
        api.resize?.();
        return;
      }
      replaceContent(panel, topicView(topics, api, context));
      api.resize?.();
    } catch (err) {
      replaceContent(panel, api.errorFor
        ? api.errorFor(err, () => button.click())
        : errorBox(String(err.message || err)));
      api.resize?.();
    }
  }, { icon: 'source' });

  host.append(button);
  return button;
}

/** Topic switcher: one row of subjects, one card for whichever is selected. */
function topicView(topics, api, context) {
  const wrap = el('div', {});
  const card = el('div', {});
  const buttons = [];

  const select = (index) => {
    buttons.forEach((b, i) => b.className = `hh-btn${i === index ? ' hh-primary' : ''}`);
    lookupInto(card, api, topics[index], context);
  };

  topics.forEach((topic, i) => buttons.push(btn(topic, () => select(i))));

  wrap.append(
    topics.length > 1
      ? el('div', { class: 'hh-row hh-topics' },
          el('span', { class: 'hh-sub', text: 'In this text:' }), ...buttons)
      : el('div', { class: 'hh-sub hh-topics', text: `In this text: ${topics[0]}` }),
    card
  );

  select(0);
  return wrap;
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
 * Like asyncView, but the answer appears as it is written.
 *
 * `run(emit)` is called with a function that takes the text so far. The spinner
 * is replaced by the first token rather than by the finished answer, which for
 * a long summary is the difference between four seconds of nothing and reading
 * along as it arrives. `finish(result)` then returns the real view.
 *
 * The emitted text is deliberately not tidied on the way past: `cleanOutput`
 * strips wrapping quotes and fences, and it cannot tell an opening fence from a
 * complete one until the answer ends. Better a fence visible for a moment than
 * text that flickers as the stripping changes its mind.
 */
export function streamView(loadingLabel, run, finish, onError) {
  const box = el('div', { class: 'hh-detail' });

  const go = () => {
    replaceContent(box, spinner(loadingLabel));
    const live = el('div', { class: 'hh-text hh-streaming' });
    let started = false;

    const emit = (text) => {
      if (!started) {
        started = true;
        replaceContent(box, live);
      }
      live.textContent = text;
    };

    Promise.resolve()
      .then(() => run(emit))
      .then((result) => replaceContent(box, finish(result)))
      .catch((err) => replaceContent(box, onError(err, go)));
  };

  go();
  return box;
}

/**
 * "Ask a follow-up" under a result.
 *
 * Every AI answer used to be a dead end — you read it and the conversation
 * stopped, which is the one thing every sidebar competitor does that this
 * didn't. The original selection and the answer become the first two turns, so
 * "why?" means what it looks like it means.
 *
 * Follow-ups are not cached. Every other call is keyed on an exact selection
 * and action, so repeating one is genuinely the same request; a follow-up
 * depends on everything said before it.
 */
export function followUp({ system, source, answer }, api, host) {
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: source },
    { role: 'assistant', content: answer }
  ];

  const thread = el('div', { class: 'hh-thread' });
  const input = el('input', {
    class: 'hh-ask',
    type: 'text',
    placeholder: 'Ask a follow-up…',
    'aria-label': 'Ask a follow-up'
  });

  const ask = async () => {
    const question = input.value.trim();
    if (!question) return;

    input.value = '';
    input.disabled = true;

    thread.append(el('div', { class: 'hh-turn hh-turn--you' }, el('span', { text: question })));
    const reply = el('div', { class: 'hh-turn' }, el('span', { class: 'hh-dots', 'aria-label': 'Thinking' }));
    thread.append(reply);
    api.resize?.();

    messages.push({ role: 'user', content: question });

    try {
      const res = await api.chat(messages, (text) => {
        reply.replaceChildren(document.createTextNode(text));
        api.resize?.();
      });
      // Plain text while it streams — partial markdown renders as nonsense —
      // then the real thing once the answer is whole.
      reply.replaceChildren(...richText(res.text));
      messages.push({ role: 'assistant', content: res.text });
    } catch (err) {
      reply.replaceChildren(
        glyph('warn', 'hh-glyph hh-glyph--warn'),
        document.createTextNode(String(err?.message || err))
      );
      // A failed turn must come off the conversation, or the next question
      // carries a question nobody answered and the model tries to answer both.
      messages.pop();
    } finally {
      input.disabled = false;
      api.resize?.();
    }
  };

  // The panel captures arrow keys for menu navigation; a text field needs them.
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') ask();
  });

  host.append(thread, el('div', { class: 'hh-row' }, input, btn('Ask', ask, { variant: 'hh-primary' })));
  return thread;
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
