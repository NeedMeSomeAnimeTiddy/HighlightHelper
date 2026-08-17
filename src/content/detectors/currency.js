/**
 * Currency detector — finds an amount like "$50", "50 USD", "€1.234,56",
 * "£1.2bn" in the selection and converts it to the user's target currency.
 *
 * Free, so the answer resolves straight into the menu row. Opening the row
 * shows the rate, when it was published, and a couple of other currencies.
 */

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
  return ['USD', 'EUR', 'GBP', 'JPY'].filter((c) => c !== from && c !== to).slice(0, 2);
}

function amountLine(value, code) {
  const symbol = DISPLAY_SYMBOL[code];
  const number = formatMoney(value, code);
  return symbol && symbol.length <= 3 ? `${symbol}${number}` : `${number} ${code}`;
}

/** Asks the worker for rates and pulls out the one we need. */
async function fetchRates(api, base) {
  const res = await api.send({ type: MSG.RATES, base });
  if (!res?.ok) throw new Error(res?.error || 'Could not reach the rate service');
  return res;
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

  rows({ match }) {
    if (match.sameCurrency) {
      // Nothing to convert, but confirming what we read is still useful.
      return [{
        key: 'currency',
        icon: 'currency',
        label: `Already in ${match.code}`,
        value: amountLine(match.value, match.code)
      }];
    }

    return [{
      key: 'currency',
      icon: 'currency',
      label: `Convert to ${match.target}`,
      // The worker caches rates, so the row's lookup and the detail view's
      // lookup cost one network request between them.
      value: { task: (api) => convertedLine(match, api) },
      detailTitle: `${match.code} → ${match.target}`,
      detail: {
        kind: 'async',
        loading: 'Fetching rates…',
        run: (api) => detailBlocks(match, api)
      }
    }];
  }
};

async function convertedLine(match, api) {
  const res = await fetchRates(api, match.code);
  const rate = res.rates[match.target];
  if (!rate) throw new Error('no rate');
  return amountLine(match.value * rate, match.target);
}

async function detailBlocks(match, api) {
  const res = await fetchRates(api, match.code);
  const rate = res.rates[match.target];

  if (!rate) {
    return [{
      type: 'note',
      text: `No published rate for ${match.target} against ${match.code}.`,
      variant: 'hh-warn'
    }];
  }

  const when = new Date(res.updated);
  const facts = extraTargets(match.code, match.target)
    .filter((code) => res.rates[code])
    .map((code) => ({
      label: currencyName(code),
      value: amountLine(match.value * res.rates[code], code)
    }));

  return [
    {
      type: 'headline',
      from: amountLine(match.value, match.code),
      op: '→',
      text: amountLine(match.value * rate, match.target)
    },
    {
      type: 'sub',
      text: `1 ${match.code} = ${formatMoney(rate, match.target)} ${match.target} · ` +
        (res.stale ? 'cached, offline' : `updated ${when.toLocaleDateString()}`)
    },
    ...(facts.length ? [{ type: 'facts', items: facts }] : [])
  ];
}
