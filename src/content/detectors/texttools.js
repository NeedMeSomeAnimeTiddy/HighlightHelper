/**
 * Text tools — local, no API.
 *
 * The one detector that matches almost any selection, so it deliberately
 * contributes a single row (ranked last) that drills into the transforms. The
 * row's value carries the word count, which is the thing you most often wanted
 * anyway, so the common case needs no click at all.
 */

import { el, menu, replaceContent, resultView, asyncView, errorBox } from '../kit.js';
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
  // The final class refuses to end on punctuation, so "see https://a.com/x, and"
  // yields the link without the comma that ended the clause. Greedy matching
  // backtracks one character to satisfy it.
  { key: 'urls', label: 'Links', re: /\bhttps?:\/\/[^\s<>()[\]{}"']*[^\s<>()[\]{}"'.,;:!?]/gi },
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

  items({ text, match }) {
    return [{
      key: 'texttools',
      icon: 'text',
      label: 'Text tools',
      value: plural(match.stats.words, 'word'),
      detailTitle: 'Text tools',
      open: (api) => menu([
        {
          key: 'texttools:count',
          icon: 'list',
          label: 'Count',
          value: `${match.stats.characters} chars`,
          detailTitle: 'Count',
          open: () => countView(match.stats)
        },
        ...TRANSFORMS.map((t) => {
          const result = t.fn(text);
          return {
            key: `texttools:${t.key}`,
            icon: 'text',
            label: t.label,
            value: preview(result),
            detailTitle: t.label,
            open: (ctx) => resultView(result, ctx, { label: t.label })
          };
        }),

        // Only when there is more than one line to operate on. A "Sort lines"
        // row under a sentence is a row that can only disappoint.
        ...(match.stats.lines > 1
          ? LINE_OPS.map((t) => {
              const result = t.fn(text);
              return {
                key: `texttools:${t.key}`,
                icon: 'list',
                label: t.label,
                value: preview(result),
                detailTitle: t.label,
                open: (ctx) => resultView(result, ctx, { label: t.label })
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
            open: (ctx) => resultView(result, ctx, { label: e.label })
          }];
        }),

        {
          key: 'texttools:hash',
          icon: 'decode',
          label: 'SHA-256',
          detailTitle: 'SHA-256',
          open: (ctx) => hashView(text, ctx)
        }
      ], api)
    }];
  }
};

/**
 * SHA-256 via SubtleCrypto, which is async — hence a view rather than a value.
 *
 * Hashing the *exact* selection, bytes and all: no trimming, no whitespace
 * collapsing. A hash of something subtly different from what you highlighted
 * would be worse than useless, because it would look like an answer.
 */
function hashView(text, api) {
  return asyncView('Hashing…', async () => {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return resultView(hex, api, { label: 'SHA-256' });
  }, (err) => errorBox(String(err?.message || err)));
}

function countView(s) {
  const box = el('div', { class: 'hh-detail' });
  const facts = [
    ['Words', s.words.toLocaleString()],
    ['Characters', s.characters.toLocaleString()],
    ['Without spaces', s.charactersNoSpaces.toLocaleString()],
    ['Sentences', s.sentences.toLocaleString()],
    ['Lines', s.lines.toLocaleString()],
    ['Reading time', s.reading]
  ];
  replaceContent(box,
    el('div', { class: 'hh-facts' },
      ...facts.map(([label, value]) => el('div', { class: 'hh-fact' },
        el('em', { text: label }),
        el('span', { text: value })
      ))
    )
  );
  return box;
}
