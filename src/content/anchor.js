/**
 * Finding a piece of text in a page, unambiguously.
 *
 * Two features need exactly this and it is worth writing once: a link to a
 * highlight (`#:~:text=…`, below) and, later, re-attaching a saved highlight to
 * a page that has changed underneath it.
 *
 * The hard part is never "find the text" — it is "find it and be sure there is
 * only one". A link to the third occurrence of the word "however" that lands on
 * the first is worse than no link, because it looks like it worked.
 *
 * ---
 *
 * How text fragments match, which is what this has to imitate:
 *
 *   - case-insensitively
 *   - with runs of whitespace treated as one space
 *   - on whole words, so "cat" does not match inside "concatenate"
 *
 * So uniqueness is tested against a normalised copy of the page's own text,
 * using the same three rules. It is an approximation of the browser's matching
 * — block boundaries are ignored here — and it errs towards *finding more*
 * matches than the browser would, which is the safe direction: the cost is a
 * slightly longer link, not a wrong one.
 */

/**
 * Collapse whitespace. Case is left alone here on purpose.
 *
 * Matching is case-insensitive, but the link is a thing people read, and
 * `#:~:text=nothing%20else%20happened` on a sentence that was capitalised looks
 * like the extension mangled it. So comparison happens on a lowercased copy and
 * emission happens from this one, with the two kept index-aligned.
 */
export function normalise(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * The comparison copy.
 *
 * `toLowerCase` is length-preserving for everything the web actually contains,
 * but not universally — Turkish 'İ' lowercases to two code units — and the
 * index alignment above depends on it. When it doesn't hold, callers fall back
 * to comparing and emitting the same lowercased text: an uglier link, never a
 * wrong one.
 */
function lower(s) {
  const out = s.toLowerCase();
  return out.length === s.length ? out : null;
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Where `needle` appears in `hay` as whole words, stopping after `limit`
 * hits — the uniqueness callers only ever ask "is there more than one?", and a
 * common word on a long page would otherwise be located thousands of times.
 */
export function occurrenceIndices(hay, needle, limit = Infinity) {
  if (!needle) return [];

  const startsWord = WORD.test(needle[0]);
  const endsWord = WORD.test(needle[needle.length - 1]);

  const found = [];
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    const before = i === 0 ? '' : hay[i - 1];
    const after = hay[i + needle.length] || '';
    const clearStart = !startsWord || !before || !WORD.test(before);
    const clearEnd = !endsWord || !after || !WORD.test(after);
    if (clearStart && clearEnd) {
      found.push(i);
      if (found.length >= limit) return found;
    }
    i += 1;
  }
  return found;
}

export function occurrences(hay, needle, limit = 2) {
  return occurrenceIndices(hay, needle, limit).length;
}

/**
 * Percent-encoding for one part of a fragment.
 *
 * `encodeURIComponent` leaves `-` alone, and a bare `-` inside a part is what
 * separates the prefix and suffix markers — so an ordinary hyphenated word
 * would silently restructure the whole directive.
 */
export function encodePart(s) {
  return encodeURIComponent(s).replace(/-/g, '%2D');
}

function words(s) {
  return s.split(' ').filter(Boolean);
}

/**
 * The text either side of the match, taken as a window of characters rather
 * than a count of words.
 *
 * Rebuilding context by joining words back together with single spaces was the
 * first attempt and it is quietly wrong: "on the mat" followed by ". Later"
 * rejoins as "on the mat later", which appears nowhere on the page, so the
 * uniqueness test fails and a perfectly linkable selection is refused. A
 * character window is a real contiguous substring, so what gets tested is
 * exactly what gets emitted.
 *
 * The window is pulled back to a word boundary at each outer edge, because a
 * prefix starting halfway through a word cannot match anything.
 */
function contextAt(hay, at, len, chars) {
  let start = Math.max(0, at - chars);
  while (start > 0 && start < at && WORD.test(hay[start - 1]) && WORD.test(hay[start])) start++;

  const after = at + len;
  let end = Math.min(hay.length, after + chars);
  while (end > after && end < hay.length && WORD.test(hay[end - 1]) && WORD.test(hay[end])) end--;

  return { start, end, prefix: hay.slice(start, at).trim(), suffix: hay.slice(after, end).trim() };
}

/** Context windows to try, in characters either side. */
const CONTEXT_STEPS = [12, 25, 50, 100];

/** Long selections travel as start,end rather than in full. */
const RANGE_ABOVE_WORDS = 12;
const RANGE_EDGE_WORDS = 5;
/** Give up rather than emit a directive nobody's URL bar will survive. */
const MAX_PART_CHARS = 300;

/**
 * Builds the `text=…` value for a selection, or null when it cannot be pinned
 * down.
 *
 * Returning null matters: a fragment that resolves to the wrong paragraph is a
 * worse outcome than a button that says it could not make one. The caller shows
 * the plain page URL instead.
 */
export function buildTextFragment(selection, pageText, { at = null } = {}) {
  const needle = normalise(selection);
  const hay = normalise(pageText);
  if (!needle || needle.length > MAX_PART_CHARS * 2) return null;

  // Compare in lowercase, emit in the page's own case, on aligned indices.
  const needleLower = lower(needle);
  const hayLower = lower(hay);
  const cmpNeedle = needleLower ?? needle.toLowerCase();
  const cmpHay = hayLower ?? hay.toLowerCase();
  // If alignment broke, emit from the comparison copy so the two agree.
  const src = needleLower && hayLower ? hay : cmpHay;

  /*
   * Which occurrence the user actually selected.
   *
   * The first version took `indexOf` — the *first* match — which is right for a
   * unique sentence and quietly wrong for anything repeated: selecting the
   * fourth "however" on a page produced a valid, unique link to the first one.
   * It looked like it worked, which is the failure this file exists to avoid.
   *
   * `at` is an offset into the raw `pageText`; whitespace collapsing moves
   * everything left, so it is re-measured in normalised space by normalising
   * the text in front of it.
   */
  const hits = occurrenceIndices(cmpHay, cmpNeedle);
  if (!hits.length) return null;

  const target = at == null ? null : normalise(pageText.slice(0, at)).length;
  const at2 = target == null
    ? hits[0]
    : hits.reduce((best, i) => (Math.abs(i - target) < Math.abs(best - target) ? i : best), hits[0]);

  // Everything emitted is sliced out of the page, never out of the selection.
  // The two are normally identical — the selection came from the page — but
  // when they differ it is the page's own capitalisation that a reader of the
  // link will see, and the prefix and suffix already come from there, so
  // taking the phrase from anywhere else would be inconsistent for no gain.
  const srcNeedle = src.slice(at2, at2 + cmpNeedle.length);
  const parts = words(srcNeedle);

  // Long selection: quote the ends and let the browser span between them.
  if (parts.length > RANGE_ABOVE_WORDS) {
    const start = parts.slice(0, RANGE_EDGE_WORDS).join(' ');
    const end = parts.slice(-RANGE_EDGE_WORDS).join(' ');
    // Both ends are quoted, so the pair is near-certainly unique on its own.
    return `${encodePart(start)},${encodePart(end)}`;
  }

  if (srcNeedle.length > MAX_PART_CHARS) return null;

  // Short and already unique: the simplest directive there is.
  if (hits.length === 1) return encodePart(srcNeedle);

  // Otherwise widen the window until only one match survives.
  for (const chars of CONTEXT_STEPS) {
    const win = contextAt(cmpHay, at2, cmpNeedle.length, chars);
    if (!win.prefix && !win.suffix) continue;

    // A real contiguous slice, so this tests precisely what gets emitted.
    if (occurrences(cmpHay, cmpHay.slice(win.start, win.end)) !== 1) continue;

    const out = contextAt(src, at2, srcNeedle.length, chars);
    if (out.prefix.length + out.suffix.length > MAX_PART_CHARS) return null;

    return [
      out.prefix ? `${encodePart(out.prefix)}-,` : '',
      encodePart(srcNeedle),
      out.suffix ? `,-${encodePart(out.suffix)}` : ''
    ].join('');
  }

  return null;
}

/**
 * A link to the current selection, or null.
 *
 * Any fragment already on the URL is dropped: a text directive appended to an
 * existing `#section` is legal, but carrying over whatever hash the page
 * happened to be showing is not what anyone means by "link to this".
 */
export function linkToSelection(selection, { url = location.href, pageText = null, at = null } = {}) {
  const text = buildTextFragment(selection, pageText ?? document.body.innerText, { at });
  if (!text) return null;

  let base;
  try {
    base = new URL(url);
  } catch {
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;

  base.hash = '';
  return `${base.href}#:~:text=${text}`;
}
