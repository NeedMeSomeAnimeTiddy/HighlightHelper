/**
 * Text tools — local, no API.
 *
 * The one detector that matches almost any selection, so it deliberately
 * contributes a single row (ranked last) that drills into the transforms. The
 * row's value carries the word count, which is the thing you most often wanted
 * anyway, so the common case needs no click at all.
 */

import { looksLikeLanguage, plural } from '../../common/text.js';

const MIN_CHARS = 3;
const MAX_LEN = 20000;
const PREVIEW_CHARS = 16;
const WORDS_PER_MINUTE = 220;

/** Splits into words, breaking camelCase and any non-alphanumeric run. */
function words(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export const TRANSFORMS = [
  { key: 'upper', label: 'UPPERCASE', fn: (t) => t.toUpperCase() },
  { key: 'lower', label: 'lowercase', fn: (t) => t.toLowerCase() },
  {
    key: 'title',
    label: 'Title Case',
    fn: (t) => t.replace(/\p{L}[\p{L}'’]*/gu, (w) => cap(w))
  },
  {
    key: 'sentence',
    label: 'Sentence case',
    fn: (t) => t.toLowerCase().replace(/(^\s*\p{L})|([.!?]\s+\p{L})/gu, (m) => m.toUpperCase())
  },
  { key: 'camel', label: 'camelCase', fn: (t) => words(t).map((w, i) => (i ? cap(w) : w.toLowerCase())).join('') },
  { key: 'pascal', label: 'PascalCase', fn: (t) => words(t).map(cap).join('') },
  { key: 'snake', label: 'snake_case', fn: (t) => words(t).map((w) => w.toLowerCase()).join('_') },
  { key: 'kebab', label: 'kebab-case', fn: (t) => words(t).map((w) => w.toLowerCase()).join('-') },
  {
    key: 'slug',
    label: 'URL slug',
    // NFKD splits "é" into "e" + a combining accent; U+0300-U+036F drops the accent.
    fn: (t) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  },
  { key: 'strip', label: 'Collapse whitespace', fn: (t) => t.replace(/\s+/g, ' ').trim() }
];

/* ------------------------------------------------------------------ *
 * Line operations
 * ------------------------------------------------------------------ */

/**
 * PopClip's "Text Lists" category, which turns out to be the thing people
 * reach for most after case conversion: a pasted column that needs sorting, a
 * list that needs its duplicates gone, lines that need to become a comma list.
 *
 * Kept separate from TRANSFORMS because these only make sense on something with
 * more than one line, and offering "Sort lines" on a sentence is noise.
 */
const lines = (t) => t.split(/\r\n|\r|\n/);

export const LINE_OPS = [
  {
    key: 'sort',
    label: 'Sort lines',
    fn: (t) => lines(t).sort((a, b) => a.localeCompare(b)).join('\n')
  },
  {
    key: 'sortdesc',
    label: 'Sort lines, reversed',
    fn: (t) => lines(t).sort((a, b) => b.localeCompare(a)).join('\n')
  },
  { key: 'reverse', label: 'Reverse line order', fn: (t) => lines(t).reverse().join('\n') },
  {
    key: 'dedupe',
    label: 'Remove duplicate lines',
    fn: (t) => [...new Set(lines(t))].join('\n')
  },
  {
    key: 'blanks',
    label: 'Remove blank lines',
    fn: (t) => lines(t).filter((l) => l.trim()).join('\n')
  },
  { key: 'join', label: 'Join into one line', fn: (t) => lines(t).map((l) => l.trim()).filter(Boolean).join(' ') },
  {
    key: 'commas',
    label: 'Lines to comma list',
    fn: (t) => lines(t).map((l) => l.trim()).filter(Boolean).join(', ')
  },
  {
    key: 'split',
    label: 'Comma list to lines',
    fn: (t) => t.split(',').map((p) => p.trim()).filter(Boolean).join('\n')
  }
];

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

/**
 * Pull the emails, links or numbers out of a selection.
 *
 * This is the honest half of "extract to table": no model, no guessing about
 * structure, just the things that have an unambiguous shape. What it finds, it
 * found — it never invents a column.
 */
export const EXTRACTORS = [
  { key: 'emails', label: 'Email addresses', re: /[^\s<>()[\]{}",;:]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  /*
   * Links, in the two forms people actually write them.
   *
   * Requiring `https://` was too strict — most links in prose are written
   * `www.example.com` or as anchor text with no URL in it at all, so a
   * selection full of links produced no row and looked broken.
   *
   * A bare `example.com` is still not matched, and that is deliberate: prose
   * is full of things shaped like a domain — "e.g.", "vs.", "Node.js",
   * "main.js" — and a Links row listing "Node.js" is worse than no row.
   * A scheme or a `www.` is the smallest signal that something was meant as
   * an address.
   *
   * The final class refuses to end on punctuation, so "see www.a.com/x, and"
   * yields the link without the comma that ended the clause; greedy matching
   * backtracks one character to satisfy it.
   */
  {
    key: 'urls',
    label: 'Links',
    re: /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']*[^\s<>()[\]{}"'.,;:!?]/gi
  },
  // Grouping commas are part of the number; a full stop is only part of it when
  // digits follow, so "costs 12." gives 12 rather than "12.".
  { key: 'numbers', label: 'Numbers', re: /-?\d[\d,]*(?:\.\d+)?/g }
];

export function extract(text, re) {
  const found = String(text).match(re) || [];
  // Order-preserving dedupe: a list of every repeat is rarely what was wanted.
  return [...new Set(found)];
}

function preview(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

function stats(text) {
  const w = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sentences = (text.match(/[^\s.!?][^.!?]*[.!?]/g) || []).length ||
    (text.trim() ? 1 : 0);
  const minutes = w / WORDS_PER_MINUTE;
  return {
    words: w,
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, '')].length,
    sentences,
    lines: text.split(/\r\n|\r|\n/).length,
    reading: minutes < 1 ? `${Math.max(1, Math.round(minutes * 60))} sec` : `${Math.round(minutes)} min`
  };
}

export default {
  id: 'texttools',
  title: 'Text tools',
  // Last: it matches nearly everything, so it must never outrank a detector
  // that actually recognised something specific.
  priority: 90,

  matches(text) {
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_LEN) return null;
    // On "$50", "1700000000", "#3f8ae0" or a JWT a specific detector has
    // already answered; a word count would just be a second, useless row. The
    // ratio is looser than elsewhere because case conversion is genuinely
    // useful on identifiers like "user_id_2".
    if (!looksLikeLanguage(t, { minLetterRatio: 0.45 })) return null;
    return { stats: stats(text) };
  },

  rows({ text, match }) {
    return [{
      key: 'texttools',
      icon: 'text',
      label: 'Text tools',
      value: plural(match.stats.words, 'word'),
      detailTitle: 'Text tools',
      // The one row drills into every tool. A nested `menu` view is the whole
      // reason this detector can stay a single row at the top level.
      detail: { kind: 'menu', rows: toolRows(text, match.stats) }
    }];
  }
};

/**
 * The submenu: count, then the transforms, then whatever else the selection
 * happens to support.
 *
 * The keys are load-bearing beyond this file — a right-click on "Text tools →
 * URL slug" asks the panel for `texttools:slug` by name, and the context menu
 * in common/tools.js lists every one of them.
 */
function toolRows(text, counts) {
  return [
    {
      key: 'texttools:count',
      icon: 'list',
      label: 'Count',
      value: `${counts.characters} chars`,
      detailTitle: 'Count',
      detail: { kind: 'blocks', blocks: [{ type: 'facts', items: countFacts(counts) }] }
    },
    ...TRANSFORMS.map((t) => {
      const result = t.fn(text);
      return {
        key: `texttools:${t.key}`,
        icon: 'text',
        label: t.label,
        value: preview(result),
        detailTitle: t.label,
        detail: resultView(result, t.label)
      };
    }),

    // Only when there is more than one line to operate on. A "Sort lines"
    // row under a sentence is a row that can only disappoint.
    ...(counts.lines > 1
      ? LINE_OPS.map((t) => {
          const result = t.fn(text);
          return {
            key: `texttools:${t.key}`,
            icon: 'list',
            label: t.label,
            value: preview(result),
            detailTitle: t.label,
            detail: resultView(result, t.label)
          };
        })
      : []),

    // Likewise: an extractor that found nothing is not worth a row.
    ...EXTRACTORS.flatMap((e) => {
      const found = extract(text, e.re);
      if (!found.length) return [];
      const result = found.join('\n');
      return [{
        key: `texttools:${e.key}`,
        icon: 'list',
        label: e.label,
        value: plural(found.length, 'found', 'found'),
        detailTitle: e.label,
        detail: resultView(result, e.label)
      }];
    }),

    {
      key: 'texttools:hash',
      icon: 'decode',
      label: 'SHA-256',
      detailTitle: 'SHA-256',
      /**
       * SHA-256 via SubtleCrypto, which is async — hence an async view rather
       * than a value on the row.
       *
       * Hashing the *exact* selection, bytes and all: no trimming, no
       * whitespace collapsing. A hash of something subtly different from what
       * you highlighted would be worse than useless, because it would look
       * like an answer.
       */
      detail: {
        kind: 'async',
        loading: 'Hashing…',
        run: async () => resultBlocks(await sha256(text), 'SHA-256')
      }
    }
  ];
}

/** The text, then Copy / Replace — what nearly every tool here ends in. */
function resultBlocks(result, label) {
  return [
    { type: 'label', text: label },
    { type: 'text', text: result },
    { type: 'actions', text: result }
  ];
}

/** The same thing as a whole view, which is what a row's `detail` wants. */
function resultView(result, label) {
  return { kind: 'blocks', blocks: resultBlocks(result, label) };
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function countFacts(s) {
  return [
    { label: 'Words', value: s.words.toLocaleString() },
    { label: 'Characters', value: s.characters.toLocaleString() },
    { label: 'Without spaces', value: s.charactersNoSpaces.toLocaleString() },
    { label: 'Sentences', value: s.sentences.toLocaleString() },
    { label: 'Lines', value: s.lines.toLocaleString() },
    { label: 'Reading time', value: s.reading }
  ];
}
