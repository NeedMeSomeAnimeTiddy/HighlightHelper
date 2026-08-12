/**
 * Currency detector — finds an amount like "$50", "50 USD", "€1.234,56",
 * "£1.2bn" in the selection and converts it to the user's target currency.
 *
 * Rates come from the background worker (cached), so a repeat selection is a
 * storage read, not a network call.
 */

import { el, spinner, replaceContent, errorBox, note } from '../kit.js';
import {
  CURRENCY_CODES,
  CURRENCY_SYMBOLS,
  DISPLAY_SYMBOL,
  currencyName
} from '../../common/currencies.js';
import {
  NUMBER_SRC,
  SCALE_SRC,
  scaleFactor,
  parseNumber,
  formatMoney
} from '../../common/numbers.js';
import { MSG } from '../../common/constants.js';

const MAX_LEN = 240;

// Longest symbols first so "CA$" wins over "$".
const SYMBOL_SRC = Object.keys(CURRENCY_SYMBOLS)
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const CODE_SRC = [...CURRENCY_CODES].join('|');

// $50  /  US$ 1.2bn
const RE_SYMBOL_FIRST = new RegExp(
  String.raw`(${SYMBOL_SRC})\s*(${NUMBER_SRC})\s*(${SCALE_SRC})?\b`,
  'i'
);
// 50 USD  /  1.2 bn EUR  /  50€
const RE_CODE_LAST = new RegExp(
  String.raw`(${NUMBER_SRC})\s*(${SCALE_SRC})?\s*(${CODE_SRC}|${SYMBOL_SRC})(?![a-z])`,
  'i'
);
// USD 50
const RE_CODE_FIRST = new RegExp(
  String.raw`\b(${CODE_SRC})\s*(${NUMBER_SRC})\s*(${SCALE_SRC})?\b`,
  'i'
);

function normaliseUnit(token) {
  const upper = token.toUpperCase();
  if (CURRENCY_CODES.has(upper)) return upper;
  // Symbols are case-sensitive-ish ("Kč", "zł"), so try the raw token first.
  return CURRENCY_SYMBOLS[token] || CURRENCY_SYMBOLS[upper] || null;
}

/** Finds the first currency amount in `text`, or null. */
function findAmount(text) {
  const attempts = [
    { re: RE_SYMBOL_FIRST, unit: 1, num: 2, scale: 3 },
    { re: RE_CODE_FIRST, unit: 1, num: 2, scale: 3 },
    { re: RE_CODE_LAST, unit: 3, num: 1, scale: 2 }
  ];

  let best = null;
  for (const a of attempts) {
    const m = a.re.exec(text);
    if (!m) continue;
    const code = normaliseUnit(m[a.unit]);
    if (!code) continue;
    const value = parseNumber(m[a.num]) * scaleFactor(m[a.scale]);
    if (!Number.isFinite(value)) continue;
    // Prefer the earliest match in the string.
    if (!best || m.index < best.index) {
      best = { code, value, index: m.index, raw: m[0].trim() };
    }
  }
  return best;
}

/** Sub-conversions worth showing alongside the main one. */
function extraTargets(from, to) {
  const pool = ['USD', 'EUR', 'GBP', 'JPY'];
  return pool.filter((c) => c !== from && c !== to).slice(0, 2);
}

function amountLine(value, code) {
  const sym = DISPLAY_SYMBOL[code];
  const num = formatMoney(value, code);
  return sym && sym.length <= 3 ? `${sym}${num}` : `${num} ${code}`;
}

export default {
  id: 'currency',
  title: 'Currency',
  priority: 10,

  matches(text, settings) {
    if (!text || text.length > MAX_LEN) return null;
    if (!/\d/.test(text)) return null;
    const found = findAmount(text);
    if (!found) return null;
    return {
      ...found,
      target: settings.targetCurrency,
      sameCurrency: found.code === settings.targetCurrency
    };
  },

  render({ match, api }) {
    const box = el('div', {});

    if (match.sameCurrency) {
      replaceContent(
        box,
        el('div', { class: 'hh-conv' }, amountLine(match.value, match.code)),
        note(`Already in ${currencyName(match.code)}, your default currency.`)
      );
      return box;
    }

    replaceContent(box, spinner('Fetching rates…'));

    const load = async () => {
      const res = await api.send({ type: MSG.RATES, base: match.code });
      if (!res?.ok) throw new Error(res?.error || 'Could not reach the rate service');

      const rate = res.rates[match.target];
      if (!rate) {
        replaceContent(
          box,
          note(`No published rate for ${match.target} against ${match.code}.`, 'hh-warn')
        );
        return;
      }

      const converted = match.value * rate;
      const main = el('div', { class: 'hh-conv' },
        el('span', { class: 'hh-from', text: amountLine(match.value, match.code) }),
        el('span', { class: 'hh-arrow', text: '→' }),
        el('span', { text: amountLine(converted, match.target) })
      );

      const when = new Date(res.updated);
      const sub = el('p', { class: 'hh-sub' },
        `1 ${match.code} = ${formatMoney(rate, match.target)} ${match.target} · ` +
        (res.stale ? 'cached (offline)' : `updated ${when.toLocaleDateString()}`)
      );

      const extras = extraTargets(match.code, match.target)
        .filter((c) => res.rates[c])
        .map((c) =>
          el('div', {}, `${c} `, el('span', {
            text: formatMoney(match.value * res.rates[c], c)
          }))
        );

      replaceContent(
        box,
        main,
        sub,
        extras.length ? el('div', { class: 'hh-extra' }, ...extras) : null
      );
    };

    const attempt = () =>
      load().catch((err) =>
        replaceContent(box, errorBox(String(err.message || err), { onRetry: attempt }))
      );

    attempt();
    return box;
  }
};
