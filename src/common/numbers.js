/** Number parsing/formatting shared by the currency and unit detectors. */

/** Regex source for a number, tolerant of grouping separators. */
export const NUMBER_SRC =
  String.raw`\d{1,3}(?:[  ,.' ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?|[.,]\d+`;

/** Scale suffixes, e.g. "$1.2bn". */
const SCALES = {
  k: 1e3, thousand: 1e3, thousands: 1e3,
  m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, millions: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9,
  t: 1e12, tn: 1e12, trillion: 1e12, trillions: 1e12
};

export const SCALE_SRC = Object.keys(SCALES)
  .sort((a, b) => b.length - a.length)
  .join('|');

export function scaleFactor(word) {
  return word ? SCALES[word.toLowerCase()] || 1 : 1;
}

/**
 * Turns a written number into a JS number, working out whether "," and "."
 * are grouping or decimal separators. Handles 1,234.56 / 1.234,56 / 1 234,56.
 * Returns NaN if it can't make sense of the string.
 */
export function parseNumber(raw) {
  if (!raw) return NaN;
  // Strip spaces and apostrophes — they're only ever grouping separators.
  let s = String(raw).replace(/[\s  ']/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Whichever appears last is the decimal separator.
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const grp = dec === ',' ? '.' : ',';
    s = s.split(grp).join('').replace(dec, '.');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s)
      ? s.split(',').join('')          // 1,234,567 -> grouping
      : s.replace(',', '.');           // 1,5 -> decimal
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.split('.').join(''); // 1.234.567
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Formats a number for display with a sensible number of decimals for its
 * magnitude, and thousands separators from the browser locale.
 */
export function formatNumber(n, { maxDecimals } = {}) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  let decimals;
  if (maxDecimals != null) decimals = maxDecimals;
  else if (abs === 0) decimals = 0;
  else if (abs >= 1000) decimals = 0;
  else if (abs >= 100) decimals = 1;
  else if (abs >= 1) decimals = 2;
  else if (abs >= 0.01) decimals = 3;
  else decimals = Math.min(8, Math.ceil(-Math.log10(abs)) + 2);

  const s = n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
  return s;
}

/** Money formatting: 2 decimals normally, more for tiny values, 0 for huge. */
export function formatMoney(n, code) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  let decimals = 2;
  if (abs >= 1e6) decimals = 0;
  else if (abs > 0 && abs < 0.01) decimals = 6;
  if (code === 'JPY' || code === 'KRW' || code === 'VND' || code === 'IDR') {
    decimals = abs < 1 ? 2 : 0;
  }
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}
