/**
 * Finding a saved highlight again, as a real DOM Range.
 *
 * `anchor.js` answers "is this text unique on the page" over strings, which is
 * all a link needs. Re-painting a highlight needs the other half: an actual
 * Range, in a document that has probably changed since the highlight was made.
 * The string half stays in `anchor.js` so it can be tested without a DOM; the
 * DOM half lives here.
 *
 * ---
 *
 * How the search works.
 *
 * Every text node under the root is concatenated into one string, each node
 * separated by a newline, and the position of each node is recorded. A match
 * index in that string maps straight back to (node, offset) by linear
 * arithmetic — no normalisation, so no offset mapping to get wrong.
 *
 * The separator is doing real work. Without it, a heading "Cat" followed by a
 * paragraph "astrophe" concatenates to "Catastrophe" and the search can match
 * across a boundary that does not exist visually. A newline prevents that,
 * while still counting as whitespace for the `\s+` in the pattern, so a phrase
 * that genuinely spans two nodes — a sentence with a `<em>` in the middle —
 * still matches.
 *
 * Whitespace in the needle becomes `\s+`, because the page's own whitespace is
 * not what it was when the text was copied out of it: HTML collapses runs, and
 * a line break in the source becomes a space on screen.
 */

/** Regex-special characters, escaped. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A pattern that matches `text` regardless of how the page happens to break
 * its whitespace. Returns null for text with nothing to match on.
 */
export function flexiblePattern(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  return trimmed
    .split(/\s+/)
    .map(escapeRe)
    .join('\\s+');
}

/**
 * What may sit between the saved text and the words that surrounded it.
 *
 * Not `\s+`. The context either side of a highlight is nearly always separated
 * from it by punctuation — "…on the mat." then "Later the dog…" — and a joiner
 * that only allowed whitespace failed on the single most ordinary case there
 * is, the end of a sentence. Bounded rather than open-ended so it cannot quietly
 * span half a paragraph of dashes and brackets.
 */
const JOIN = '[\\s\\p{P}]{0,4}';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE', 'IFRAME']);

/**
 * Concatenates the document's text and remembers where each node landed.
 *
 * Rebuilt on every search rather than cached: the whole point is to run against
 * the page as it is now, and a cache would be stale exactly when the page is
 * the kind that changes under you.
 */
export function collectText(root = document.body) {
  if (!root) return { text: '', nodes: [] };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.data) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: text.length, end: text.length + node.data.length });
    text += `${node.data}\n`;
  }
  return { text, nodes };
}

/** The node entry containing a character index, by binary search. */
function nodeAt(nodes, index) {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = nodes[mid];
    if (index < entry.start) hi = mid - 1;
    else if (index > entry.end) lo = mid + 1;
    else return entry;
  }
  return null;
}

/** Builds a Range spanning [start, end) in the collected text. */
function rangeFor(index, start, end) {
  const from = nodeAt(index.nodes, start);
  const to = nodeAt(index.nodes, end);
  if (!from || !to) return null;

  const range = document.createRange();
  try {
    range.setStart(from.node, Math.min(start - from.start, from.node.data.length));
    range.setEnd(to.node, Math.min(end - to.start, to.node.data.length));
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

/**
 * Finds a saved highlight in the page.
 *
 * Tries hardest first: the text with the words that surrounded it when it was
 * saved, which survives the page gaining a paragraph elsewhere. Falls back to
 * the text alone, but only when there is exactly one of it.
 *
 * Returns null when the text is gone *or* when it is ambiguous. Both are
 * reported to the user as "couldn't find this", because attaching a highlight
 * to the wrong paragraph is worse than admitting the page moved on — the same
 * refusal `anchor.js` makes about links.
 */
export function locate({ text, prefix = '', suffix = '' }, root = document.body) {
  const body = flexiblePattern(text);
  if (!body) return null;

  const index = collectText(root);
  if (!index.text) return null;

  // `d` gives the capture group's own offsets, which is what turns "prefix,
  // then the bit we want, then suffix" into a range around only the middle.
  if (prefix || suffix) {
    const parts = [
      prefix ? `${flexiblePattern(prefix)}${JOIN}` : '',
      `(${body})`,
      suffix ? `${JOIN}${flexiblePattern(suffix)}` : ''
    ].join('');
    try {
      const withContext = new RegExp(parts, 'diu');
      const match = withContext.exec(index.text);
      if (match?.indices?.[1]) {
        const [start, end] = match.indices[1];
        const range = rangeFor(index, start, end);
        if (range) return range;
      }
    } catch {
      /* an unbuildable pattern falls through to the plain search */
    }
  }

  const plain = new RegExp(body, 'gi');
  const first = plain.exec(index.text);
  if (!first) return null;
  // A second match means the context above failed *and* the text is ambiguous.
  if (plain.exec(index.text)) return null;

  return rangeFor(index, first.index, first.index + first[0].length);
}

/** How much of the surrounding text to remember, in characters. */
const CONTEXT_CHARS = 40;

/**
 * The words either side of a live selection, saved so the highlight can be
 * found again later.
 *
 * Trimmed to whole words at the outer edge: a prefix starting halfway through
 * one cannot match anything once the page reflows.
 */
export function contextFor(range, root = document.body) {
  const index = collectText(root);
  if (!index.text) return { prefix: '', suffix: '' };

  const body = flexiblePattern(range.toString());
  if (!body) return { prefix: '', suffix: '' };

  const at = new RegExp(body, 'i').exec(index.text);
  if (!at) return { prefix: '', suffix: '' };

  const before = index.text.slice(Math.max(0, at.index - CONTEXT_CHARS), at.index);
  const after = index.text.slice(at.index + at[0].length, at.index + at[0].length + CONTEXT_CHARS);

  // Whole words only at the outer edge — a prefix starting mid-word matches
  // nothing once the page reflows — and no punctuation at the inner edge,
  // where JOIN already covers whatever separates the context from the text.
  return {
    prefix: before.replace(/^\S*\s/, '').replace(/\s+/g, ' ').replace(/[\s\p{P}]+$/u, '').trim(),
    suffix: after.replace(/\s\S*$/, '').replace(/\s+/g, ' ').replace(/^[\s\p{P}]+/u, '').trim()
  };
}
