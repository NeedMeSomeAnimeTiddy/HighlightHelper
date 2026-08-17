/**
 * Arithmetic — local, no API.
 *
 * Evaluates a highlighted expression: "12 * 8 + 3", "(4+5)/2", "2^10",
 * "15% of 240", "80 + 20%".
 *
 * Parsed with a hand-written recursive-descent parser rather than eval() or
 * new Function(). Selected text is untrusted input from an arbitrary page;
 * handing it to a JS evaluator inside the isolated world would be a code
 * execution primitive, and no amount of pre-filtering makes that safe.
 */

import { formatNumber } from '../../common/numbers.js';

const MAX_LEN = 120;

// "15% of 240" / "15 percent of 240"
const RE_PCT_OF = /^\s*([\d.,]+)\s*(?:%|percent)\s+of\s+([\d.,]+)\s*$/i;
// "200 + 15%" / "200 - 15%"
const RE_PCT_DELTA = /^\s*([\d.,]+)\s*([+-])\s*([\d.,]+)\s*%\s*$/;
// A pure arithmetic expression: digits, operators, brackets and separators only.
const RE_EXPRESSION = /^[\d\s+\-*/^%().,×÷–—]+$/;
// "37.7749, -122.4194" is a pair of numbers, not a subtraction. Without this
// the tokeniser reads the comma as a separator and the minus as an operator.
const RE_NUMBER_PAIR = /^\s*[-+]?[\d.]+\s*,\s*[-+]?[\d.]+\s*$/;

const num = (s) => Number(String(s).replace(/,/g, ''));

/* ---------- tokeniser + parser ---------- */

function tokenize(src) {
  const tokens = [];
  const text = src
    .replace(/×/g, '*').replace(/÷/g, '/')
    .replace(/[–—]/g, '-');

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < text.length && /[0-9.,]/.test(text[j])) j++;
      const raw = text.slice(i, j).replace(/,/g, '');
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      tokens.push({ type: 'num', value });
      i = j;
      continue;
    }
    if ('+-*/^%()'.includes(c)) { tokens.push({ type: c }); i++; continue; }
    return null;
  }
  return tokens;
}

/**
 * expression := term (('+'|'-') term)*
 * term       := power (('*'|'/'|'%') power)*
 * power      := unary ('^' power)?          -- right associative
 * unary      := ('-'|'+')* primary
 * primary    := number | '(' expression ')'
 */
function parseTokens(tokens) {
  let pos = 0;
  const peek = () => tokens[pos]?.type;
  const eat = (t) => (peek() === t ? (pos++, true) : false);

  function expression() {
    let left = term();
    if (left == null) return null;
    for (;;) {
      if (eat('+')) { const r = term(); if (r == null) return null; left += r; }
      else if (eat('-')) { const r = term(); if (r == null) return null; left -= r; }
      else return left;
    }
  }

  function term() {
    let left = power();
    if (left == null) return null;
    for (;;) {
      if (eat('*')) { const r = power(); if (r == null) return null; left *= r; }
      else if (eat('/')) { const r = power(); if (r == null) return null; left /= r; }
      else if (eat('%')) { const r = power(); if (r == null) return null; left %= r; }
      else return left;
    }
  }

  function power() {
    const base = unary();
    if (base == null) return null;
    if (eat('^')) {
      const exp = power();
      if (exp == null) return null;
      return base ** exp;
    }
    return base;
  }

  function unary() {
    if (eat('-')) { const v = unary(); return v == null ? null : -v; }
    if (eat('+')) return unary();
    return primary();
  }

  function primary() {
    const t = tokens[pos];
    if (!t) return null;
    if (t.type === 'num') { pos++; return t.value; }
    if (eat('(')) {
      const v = expression();
      if (v == null || !eat(')')) return null;
      return v;
    }
    return null;
  }

  const value = expression();
  if (value == null || pos !== tokens.length) return null;
  return value;
}

function evaluate(text) {
  const pctOf = RE_PCT_OF.exec(text);
  if (pctOf) {
    const [, pct, whole] = pctOf;
    return { value: (num(pct) / 100) * num(whole), reading: `${num(pct)}% of ${num(whole)}` };
  }

  const delta = RE_PCT_DELTA.exec(text);
  if (delta) {
    const [, base, sign, pct] = delta;
    const b = num(base);
    const change = (b * num(pct)) / 100;
    return {
      value: sign === '+' ? b + change : b - change,
      reading: `${b} ${sign} ${num(pct)}% (${sign}${formatNumber(change)})`
    };
  }

  if (RE_NUMBER_PAIR.test(text)) return null;
  if (!RE_EXPRESSION.test(text)) return null;
  // Needs at least one operator between numbers, or it's just a number.
  if (!/[+\-*/^%×÷]/.test(text.trim().replace(/^[-+]/, ''))) return null;

  const tokens = tokenize(text);
  if (!tokens || tokens.length < 3) return null;
  const value = parseTokens(tokens);
  if (value == null || !Number.isFinite(value)) return null;
  return { value, reading: text.trim().replace(/\s+/g, ' ') };
}

export default {
  id: 'calc',
  title: 'Calculator',
  priority: 12,

  matches(text) {
    if (!text || text.length > MAX_LEN) return null;
    if (!/\d/.test(text)) return null;
    // A currency symbol means the currency detector owns this selection.
    if (/[$€£¥₹₽₩₺₴₪฿₱₦]/.test(text)) return null;
    const result = evaluate(text);
    return result || null;
  },

  rows({ match }) {
    return [{
      key: 'calc',
      icon: 'calc',
      label: 'Result',
      value: formatNumber(match.value),
      detailTitle: 'Calculation',
      // Everything here is already in hand, so the view is plain static blocks.
      detail: { kind: 'blocks', blocks: detailBlocks(match) }
    }];
  }
};

function detailBlocks(match) {
  const exact = String(match.value);
  const rounded = formatNumber(match.value);

  // The unrounded value is what you copy; the two-decimal one is what you read.
  // For 4.5 the two are the same string, so the second row would only repeat
  // the first — show it when rounding actually changed something.
  const short = formatNumber(match.value, { maxDecimals: 2 });
  const facts = [{ label: 'Exact', value: exact, mono: true }];
  if (short !== exact) {
    facts.push({ label: 'Rounded', value: short, mono: true });
  }

  return [
    { type: 'headline', from: match.reading, op: '=', text: rounded },
    { type: 'facts', items: facts },
    {
      type: 'buttons',
      items: [{ copy: exact }]
    }
  ];
}
