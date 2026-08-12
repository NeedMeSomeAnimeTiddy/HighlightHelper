/**
 * Painting saved highlights onto the page.
 *
 * Via the CSS Custom Highlight API — `CSS.highlights` plus `::highlight()` —
 * which colours a Range without touching the DOM at all. Every other tool in
 * this category wraps the text in `<mark>` elements, and that is where they all
 * break: nodes appearing from nowhere fight the site's own scripts, invalidate
 * its React tree, break `:nth-child` rules, and occasionally rearrange the
 * layout of the thing you were trying to read. Nothing is inserted here. The
 * page's DOM after a highlight is byte-identical to before it.
 *
 * The cost of that is real and worth stating: a painted range is not an
 * element, so it cannot be hovered or clicked. There is no "click your
 * highlight to see its note". Re-select the text, or use the library. Given the
 * alternative is mutating every page the user reads, that is the right way
 * round.
 *
 * ---
 *
 * One stylesheet is added to the page — the single exception to touching the
 * DOM, and unavoidable: `::highlight()` rules have to live in the document
 * whose ranges they colour, so they cannot go in the panel's shadow root.
 */

import { locate } from './locate.js';
import { COLORS, forPage } from '../common/highlights-store.js';

const STYLE_ID = 'hh-highlight-styles';
const REGISTRY_PREFIX = 'hh-hl-';

/** Live records for this page, and the ranges currently painted for each. */
let painted = new Map();

export function isSupported() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/**
 * Deliberately translucent, so the text underneath keeps its own colour and
 * contrast. A solid fill would make a highlight in dark mode unreadable, and
 * the page's own foreground colour is not knowable from here.
 */
const PAINT = {
  yellow: 'rgba(255, 214, 0, 0.38)',
  green: 'rgba(64, 214, 122, 0.34)',
  blue: 'rgba(88, 166, 255, 0.32)',
  pink: 'rgba(255, 121, 198, 0.32)'
};

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = COLORS
    .map(({ id }) => `::highlight(${REGISTRY_PREFIX}${id}) { background-color: ${PAINT[id]}; }`)
    .join('\n');

  (document.head || document.documentElement).append(style);
}

/**
 * Repaints every colour from `painted`.
 *
 * A `Highlight` holds a set of ranges, so there is one registry entry per
 * colour rather than per highlight, and changing anything means rebuilding the
 * four sets. That is cheap — they are ranges, not elements — and it keeps the
 * registry from accumulating an entry per highlight ever made.
 */
function repaint() {
  if (!isSupported()) return;
  ensureStyles();

  for (const { id } of COLORS) {
    const ranges = [];
    for (const entry of painted.values()) {
      if (entry.record.color === id && entry.range) ranges.push(entry.range);
    }

    const name = REGISTRY_PREFIX + id;
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
    else CSS.highlights.delete(name);
  }
}

/**
 * Finds and paints every highlight saved for this page.
 *
 * Records that cannot be found are kept, with `range: null`. They are not
 * deleted and not guessed at: the page may have changed today and changed back
 * tomorrow, and a highlight silently reattached to whichever paragraph scored
 * best is the failure this whole design is arranged to avoid. The library shows
 * them as "not found on the page".
 */
export async function restore() {
  if (!isSupported()) return { found: 0, missing: 0 };

  const records = await forPage(location.href);
  painted = new Map();

  let found = 0;
  let missing = 0;
  for (const record of records) {
    const range = safeLocate(record);
    painted.set(record.id, { record, range });
    if (range) found += 1;
    else missing += 1;
  }

  /*
   * Say so when a saved highlight could not be found.
   *
   * Without this the two ways this feature fails look identical from the
   * outside — nothing is coloured — and they need opposite fixes. Silence here
   * means the text *was* found and the painting is at fault; a warning means
   * the re-finding is.
   */
  if (missing) {
    console.warn(
      `[Highlight Helper] ${missing} of ${records.length} saved highlight(s) could not be ` +
      'found on this page. They are kept in the library rather than guessed at.'
    );
  }

  repaint();
  return { found, missing, total: records.length };
}

function safeLocate(record) {
  try {
    return locate(record);
  } catch (err) {
    console.warn('[Highlight Helper] could not re-find a highlight:', err);
    return null;
  }
}

/** Adds one that was just made, without re-reading storage. */
export function add(record, range) {
  const found = range || safeLocate(record);
  if (!found) {
    console.warn(
      '[Highlight Helper] saved a highlight but could not find its text on the page ' +
      'to paint. It is in the library and will be retried on the next visit.'
    );
  }
  painted.set(record.id, { record, range: found });
  repaint();
}

export function drop(id) {
  painted.delete(id);
  repaint();
}

export function recolour(id, color) {
  const entry = painted.get(id);
  if (!entry) return;
  entry.record.color = color;
  repaint();
}

/** The saved highlight covering this text on this page, if there is one. */
export function findByText(text) {
  const needle = String(text || '').trim();
  for (const { record } of painted.values()) {
    if (record.text.trim() === needle) return record;
  }
  return null;
}

export function currentStats() {
  let found = 0;
  let missing = 0;
  for (const { range } of painted.values()) {
    if (range) found += 1;
    else missing += 1;
  }
  return { found, missing, total: painted.size };
}

/**
 * Repaint after the page rearranges itself.
 *
 * Single-page apps replace their content without a navigation, which leaves
 * every range pointing at detached nodes — the highlight simply vanishes. This
 * re-finds them, debounced, and only when something actually changed. It gives
 * up rather than looping if the page mutates continuously.
 */
let observer = null;
let repaintTimer = 0;

export function watch() {
  if (!isSupported() || observer) return;

  observer = new MutationObserver(() => {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(() => { restore().catch(() => {}); }, 800);
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function unwatch() {
  observer?.disconnect();
  observer = null;
  clearTimeout(repaintTimer);
}
