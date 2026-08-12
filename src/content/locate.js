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
 * Why the matching ignores whitespace entirely.
 *
 * The first version concatenated every text node with a newline between them
 * and searched with a pattern whose words were joined by `\s+`. It passed a
 * clean test fixture and failed on essentially every real page, because the
 * separator cuts both ways:
 *
 *   <p>…Reed–Solomon codes<sup>[1]</sup> are…</p>
 *
 * renders as "codes[1] are" with no gap, while the index held "codes\n[1]".
 * The needle had no whitespace at that point, so nothing could match — one
 * footnote marker inside a selected sentence was enough to lose the highlight.
 * Dropping the separator instead breaks the opposite case, where two block
 * elements render with a gap the source does not contain.
 *
 * So neither side keeps its whitespace. Every non-space character goes into one
 * string, each remembering the text node and offset it came from, and the
 * search is a plain `indexOf` over that. Source formatting, block boundaries,
 * inline markup and `&nbsp;` all stop mattering at once, and there is no regex
 * to be defeated by punctuation in the selection.
 *
 * The cost is that "the cat" would also match a page reading "thecat". That has
 * never been observed in prose, and it is a far smaller risk than the failure
 * it replaces.
 */

const WS = /\s/;

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE', 'IFRAME']);

/** Everything but the whitespace. */
export function strip(s) {
  return String(s || '').replace(/\s+/g, '');
}

/**
 * Walks the document into one whitespace-free string, remembering where each
 * text node landed in it.
 *
 * Rebuilt on every search rather than cached: the whole point is to run against
 * the page as it is now, and a cache would be stale exactly when the page is
 * the kind that changes under you.
 */
export function buildIndex(root = document.body) {
  const empty = { stripped: '', lower: '', nodes: [] };
  if (!root) return empty;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.data) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  let stripped = '';
  let node;
  while ((node = walker.nextNode())) {
    const text = strip(node.data);
    if (!text) continue;
    nodes.push({ node, start: stripped.length, end: stripped.length + text.length });
    stripped += text;
  }

  return { stripped, lower: stripped.toLowerCase(), nodes };
}

/** The node entry containing a stripped index, by binary search. */
function entryAt(nodes, index) {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = nodes[mid];
    if (index < entry.start) hi = mid - 1;
    else if (index >= entry.end) lo = mid + 1;
    else return entry;
  }
  return null;
}

/**
 * Turns a stripped index back into a real (node, offset) pair, by counting
 * non-space characters through the node's own data.
 */
function domPoint(nodes, index) {
  const entry = entryAt(nodes, index);
  if (!entry) return null;

  let remaining = index - entry.start;
  const data = entry.node.data;
  for (let i = 0; i < data.length; i++) {
    if (WS.test(data[i])) continue;
    if (remaining === 0) return { node: entry.node, offset: i };
    remaining -= 1;
  }
  return { node: entry.node, offset: data.length };
}

function rangeBetween(index, start, end) {
  const from = domPoint(index.nodes, start);
  // The end point is the character *after* the last one matched.
  const lastChar = domPoint(index.nodes, end - 1);
  if (!from || !lastChar) return null;

  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(lastChar.node, lastChar.offset + 1);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

/** Every position of `needle` in `hay`, stopping after `limit`. */
function allIndexes(hay, needle, limit = Infinity) {
  const out = [];
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    out.push(i);
    if (out.length >= limit) break;
    i += 1;
  }
  return out;
}

/**
 * Finds a saved highlight in the page.
 *
 * One match is the answer. Several means the stored context has to choose, and
 * if it cannot choose exactly one, this returns null.
 *
 * Null covers both "the text is gone" and "there are several and I can't tell
 * which" — deliberately, because both are reported the same way: the highlight
 * stays in the library marked as not found. Attaching it to the wrong paragraph
 * would look like success, which is the failure this whole design avoids.
 */
export function locate({ text, prefix = '', suffix = '' }, root = document.body) {
  const needle = strip(text).toLowerCase();
  if (!needle) return null;

  const index = buildIndex(root);
  if (!index.stripped) return null;

  const hits = allIndexes(index.lower, needle);
  if (!hits.length) return null;
  if (hits.length === 1) return rangeBetween(index, hits[0], hits[0] + needle.length);

  // Ambiguous: the words that surrounded it when it was saved decide.
  const before = strip(prefix).toLowerCase();
  const after = strip(suffix).toLowerCase();
  if (!before && !after) return null;

  /*
   * A small gap is allowed between the text and its context.
   *
   * Stripping removes whitespace but keeps punctuation, so a highlight ending a
   * sentence is followed by "." before its stored suffix begins. Demanding
   * exact adjacency rejected the commonest shape there is. Bounded, so the
   * context still has to be next to the match rather than merely nearby.
   */
  const GAP = 4;

  const matching = hits.filter((at) => {
    const endsAt = at + needle.length;
    const okBefore = !before ||
      index.lower.slice(Math.max(0, at - before.length - GAP), at).includes(before);
    const okAfter = !after ||
      index.lower.slice(endsAt, endsAt + after.length + GAP).includes(after);
    return okBefore && okAfter;
  });

  if (matching.length !== 1) return null;
  return rangeBetween(index, matching[0], matching[0] + needle.length);
}

/**
 * Where a live selection starts, as an index into the stripped text.
 *
 * This is what tells "link to this text" *which* occurrence you meant. Without
 * it the link anchors to the first match on the page, which is right for a
 * unique sentence and silently wrong for a repeated phrase.
 *
 * Returns null when the range does not begin inside a text node — a selection
 * starting on an element boundary — and the caller falls back to the first
 * occurrence.
 */
export function offsetOfRange(index, range) {
  const node = range?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const entry = index.nodes.find((n) => n.node === node);
  if (!entry) return null;

  let count = 0;
  for (let i = 0; i < range.startOffset && i < node.data.length; i++) {
    if (!WS.test(node.data[i])) count += 1;
  }
  return entry.start + count;
}

/**
 * Which occurrence of `text` a live selection is, counting from zero.
 *
 * Handed to anchor.js so a link points at the phrase you highlighted rather
 * than the first one on the page that happens to read the same.
 */
export function ordinalOfSelection(text, range, root = document.body) {
  const needle = strip(text).toLowerCase();
  if (!needle || !range) return 0;

  const index = buildIndex(root);
  const at = offsetOfRange(index, range);
  if (at == null) return 0;

  const hits = allIndexes(index.lower, needle);
  const found = hits.findIndex((i) => i >= at);
  return found === -1 ? Math.max(0, hits.length - 1) : found;
}

/** How much of the surrounding text to remember, in characters. */
const CONTEXT_CHARS = 40;

/**
 * The text either side of a live selection, saved so the highlight can be found
 * again later.
 *
 * Stored stripped, because that is the form `locate` compares in. It reads
 * oddly in storage and it is the only thing that makes the comparison immune to
 * the page rewrapping its paragraphs.
 */
export function contextFor(range, root = document.body) {
  const none = { prefix: '', suffix: '' };
  if (!range) return none;

  const index = buildIndex(root);
  const at = offsetOfRange(index, range);
  if (at == null) return none;

  const length = strip(range.toString()).length;
  if (!length) return none;

  return {
    prefix: index.stripped.slice(Math.max(0, at - CONTEXT_CHARS), at),
    suffix: index.stripped.slice(at + length, at + length + CONTEXT_CHARS)
  };
}
