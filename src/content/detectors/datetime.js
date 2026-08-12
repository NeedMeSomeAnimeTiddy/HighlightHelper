/**
 * Dates and timestamps — local, no API.
 *
 * Recognises Unix epoch values (seconds or milliseconds) and ISO 8601 strings,
 * then answers the question you actually have: what time is that *here*, and
 * how long ago was it?
 *
 * Deliberately does not fall back to Date.parse() on arbitrary prose. That
 * parser is famously lenient and inconsistent between engines — "next friday"
 * or a bare "12/03" would produce a confident, wrong answer.
 */

import { el, replaceContent } from '../kit.js';

const MAX_LEN = 80;

// Seconds since epoch, roughly 1973 .. 2096. Narrow enough that ordinary
// large numbers ("1500000 people") don't read as a date.
const EPOCH_S_MIN = 1e8;
const EPOCH_S_MAX = 4e9;

const RE_BARE_INT = /^\d{8,14}$/;
const RE_ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?\s*(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function relative(date) {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31556952000], ['month', 2629746000], ['week', 604800000],
    ['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return '';
}

/** Identifies what kind of timestamp `text` is, or null. */
function parse(text) {
  const t = text.trim();

  if (RE_BARE_INT.test(t)) {
    const n = Number(t);
    if (t.length <= 11 && n >= EPOCH_S_MIN && n <= EPOCH_S_MAX) {
      return { date: new Date(n * 1000), kind: 'Unix seconds', precise: false };
    }
    if (t.length >= 12 && n >= EPOCH_S_MIN * 1000 && n <= EPOCH_S_MAX * 1000) {
      return { date: new Date(n), kind: 'Unix milliseconds', precise: true };
    }
    return null;
  }

  if (RE_ISO.test(t)) {
    const date = new Date(t);
    if (Number.isNaN(date.getTime())) return null;
    const dateOnly = !/[T ]\d{2}:/.test(t);
    return { date, kind: dateOnly ? 'ISO date' : 'ISO 8601', dateOnly, precise: true };
  }

  return null;
}

export default {
  id: 'datetime',
  title: 'Date & time',
  priority: 9,

  matches(text) {
    if (!text || text.length > MAX_LEN) return null;
    if (!/\d/.test(text)) return null;
    const found = parse(text);
    return found ? { ...found } : null;
  },

  items({ match }) {
    const opts = match.dateOnly
      ? { dateStyle: 'full' }
      : { dateStyle: 'medium', timeStyle: 'short' };

    return [{
      key: 'datetime',
      icon: 'clock',
      label: 'Your local time',
      value: match.date.toLocaleString(undefined, opts),
      detailTitle: match.kind,
      open: () => detailView(match)
    }];
  }
};

function detailView(match) {
  const { date } = match;
  const box = el('div', { class: 'hh-detail' });

  const facts = [
    ['Local', date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })],
    ['UTC', date.toUTCString().replace(' GMT', ' UTC')],
    ['ISO 8601', date.toISOString()],
    ['Unix seconds', String(Math.floor(date.getTime() / 1000))],
    ['Unix ms', String(date.getTime())]
  ];

  replaceContent(box,
    el('div', { class: 'hh-headline' },
      el('span', { text: date.toLocaleDateString(undefined, { dateStyle: 'medium' }) }),
      el('span', { class: 'hh-from', text: date.toLocaleTimeString(undefined, { timeStyle: 'short' }) })
    ),
    el('p', { class: 'hh-sub', text: `${relative(date)} · read as ${match.kind}` }),
    el('div', { class: 'hh-facts' },
      ...facts.map(([label, value]) => el('div', { class: 'hh-fact' },
        el('em', { text: label }),
        el('span', { class: 'hh-mono', text: value })
      ))
    )
  );
  return box;
}
