/**
 * Regular expression explainer — local, no API.
 *
 * Deliberately not an AI call. What you actually want from a regex is a
 * token-by-token breakdown in source order, which a parser gives you exactly
 * and for free, every time, with no chance of a confident invention.
 *
 * The pattern is compiled once to check it is valid, but it is never executed
 * against anything. Running an arbitrary pattern from a page is how you invite
 * catastrophic backtracking into the content script.
 */

import { el, replaceContent, note } from '../kit.js';

const MAX_LEN = 400;

const RE_DELIMITED = /^\/((?:[^/\\\n]|\\.)+)\/([dgimsuvy]*)$/;

const SHORTHAND = {
  d: 'any digit (0–9)',
  D: 'any character except a digit',
  w: 'any word character (letter, digit or underscore)',
  W: 'any character except a word character',
  s: 'any whitespace',
  S: 'any character except whitespace',
  b: 'a word boundary',
  B: 'a position that is not a word boundary',
  n: 'a line feed',
  r: 'a carriage return',
  t: 'a tab',
  f: 'a form feed',
  v: 'a vertical tab',
  0: 'a null character'
};

const FLAGS = {
  g: 'global — find every match, not just the first',
  i: 'case-insensitive',
  m: 'multiline — ^ and $ match at line breaks',
  s: 'dotall — . also matches newlines',
  u: 'unicode mode',
  v: 'unicode sets mode',
  y: 'sticky — match only at lastIndex',
  d: 'record the position of each capture group'
};

const GROUP_OPENERS = [
  ['(?:', 'a group (not captured)'],
  ['(?=', 'a lookahead — what follows must match'],
  ['(?!', 'a negative lookahead — what follows must not match'],
  ['(?<=', 'a lookbehind — what precedes must match'],
  ['(?<!', 'a negative lookbehind — what precedes must not match']
];

function describeClass(body) {
  const negated = body.startsWith('^');
  const inner = negated ? body.slice(1) : body;
  const parts = [];

  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const c = inner[i + 1];
      parts.push(SHORTHAND[c] ? SHORTHAND[c].replace(/^any /, '') : `"${c}"`);
      i++;
    } else if (inner[i + 1] === '-' && i + 2 < inner.length && inner[i + 2] !== ']') {
      parts.push(`${inner[i]} to ${inner[i + 2]}`);
      i += 2;
    } else {
      parts.push(`"${inner[i]}"`);
    }
  }

  const list = parts.length > 4
    ? `${parts.slice(0, 4).join(', ')}, and ${parts.length - 4} more`
    : parts.join(', ');
  return negated ? `any character except ${list}` : `any of ${list}`;
}

function describeQuantifier(raw) {
  const lazy = raw.endsWith('?') && raw.length > 1;
  const core = lazy ? raw.slice(0, -1) : raw;
  let text;
  if (core === '*') text = 'zero or more times';
  else if (core === '+') text = 'one or more times';
  else if (core === '?') text = 'optionally (zero or one time)';
  else {
    const m = /^\{(\d*),?(\d*)\}$/.exec(core);
    if (!m) return null;
    const [, min, max] = m;
    if (!core.includes(',')) text = `exactly ${min} times`;
    else if (max === '') text = `${min} or more times`;
    else text = `between ${min} and ${max} times`;
  }
  return lazy ? `${text}, as few as possible` : text;
}

/** Walks the pattern and returns [{ depth, token, description }]. */
export function explain(pattern) {
  const steps = [];
  let depth = 0;
  let groupNumber = 0;
  let i = 0;

  const push = (token, description) => steps.push({ depth, token, description });

  while (i < pattern.length) {
    const rest = pattern.slice(i);
    let token = null;
    let description = null;
    let closes = false;
    let opens = false;

    if (rest[0] === '(') {
      const named = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(rest);
      const opener = GROUP_OPENERS.find(([prefix]) => rest.startsWith(prefix));
      if (named) {
        token = named[0];
        groupNumber++;
        description = `start of capture group ${groupNumber}, named "${named[1]}"`;
        opens = true;
      } else if (opener) {
        token = opener[0];
        description = `start of ${opener[1]}`;
        opens = true;
      } else {
        token = '(';
        groupNumber++;
        description = `start of capture group ${groupNumber}`;
        opens = true;
      }
    } else if (rest[0] === ')') {
      token = ')';
      description = 'end of the group';
      closes = true;
    } else if (rest[0] === '[') {
      const end = findClassEnd(pattern, i);
      if (end < 0) { token = '['; description = 'an unclosed character class'; }
      else {
        token = pattern.slice(i, end + 1);
        description = describeClass(pattern.slice(i + 1, end));
      }
    } else if (rest[0] === '\\') {
      const c = rest[1];
      const unicode = /^\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})/.exec(rest);
      const property = /^\\[pP]\{[^}]+\}/.exec(rest);
      const namedRef = /^\\k<([A-Za-z_$][\w$]*)>/.exec(rest);
      if (property) {
        token = property[0];
        description = `${property[0][1] === 'P' ? 'any character without' : 'any character with'} the unicode property ${property[0].slice(3, -1)}`;
      } else if (unicode) {
        token = unicode[0];
        description = `the character U+${unicode[0].replace(/^\\[ux]\{?/, '').replace('}', '').toUpperCase()}`;
      } else if (namedRef) {
        token = namedRef[0];
        description = `the same text captured by group "${namedRef[1]}"`;
      } else if (/[1-9]/.test(c)) {
        token = `\\${c}`;
        description = `the same text captured by group ${c}`;
      } else if (SHORTHAND[c]) {
        token = `\\${c}`;
        description = SHORTHAND[c];
      } else {
        token = `\\${c}`;
        description = `a literal "${c}"`;
      }
    } else if (rest[0] === '^') {
      token = '^';
      description = 'start of the text (or of a line with the m flag)';
    } else if (rest[0] === '$') {
      token = '$';
      description = 'end of the text (or of a line with the m flag)';
    } else if (rest[0] === '.') {
      token = '.';
      description = 'any character except a newline';
    } else if (rest[0] === '|') {
      token = '|';
      description = 'or — either the pattern before this, or the pattern after';
    } else {
      // Collect a run of plain literals so prose reads as one step.
      const run = /^[^\\^$.|?*+()[\]{]+/.exec(rest)[0];
      token = run;
      description = `the literal text "${run}"`;
    }

    if (closes) depth = Math.max(0, depth - 1);
    push(token, description);
    if (opens) depth++;
    i += token.length;

    // A quantifier belongs to the step just pushed.
    const quant = /^(?:[*+?]|\{\d*,?\d*\})\??/.exec(pattern.slice(i));
    if (quant && quant[0]) {
      const described = describeQuantifier(quant[0]);
      if (described) {
        const step = steps[steps.length - 1];
        step.token += quant[0];
        step.description += `, repeated ${described}`;
        i += quant[0].length;
      }
    }
  }

  return steps;
}

function findClassEnd(pattern, start) {
  for (let i = start + 1; i < pattern.length; i++) {
    if (pattern[i] === '\\') { i++; continue; }
    if (pattern[i] === ']' && i > start + 1) return i;
  }
  return -1;
}

/**
 * Rough score for "does this look like a regex rather than prose?"
 *
 * `strong` counts constructs that essentially only appear in patterns. A bare
 * selection needs at least one; the /…/ form needs none, because the
 * delimiters are the signal.
 */
const STRONG_SIGNALS = new RegExp([
  String.raw`\\[dwsbDWSB]`,        // shorthand classes
  String.raw`\[\^?[^\]]+\]`,       // character class
  String.raw`\(\?[:=!<]`,          // non-capturing group or lookaround
  String.raw`\{\d+(?:,\d*)?\}`,    // counted quantifier
  String.raw`\\\d`,                // backreference
  String.raw`\([^)]*\|[^)]*\)`,    // alternation inside a group
  String.raw`\.[*+]`,              // .* or .+
  String.raw`^\^|\$$`              // anchored at either end
].join('|'), 'g');

function metaSignal(text) {
  const strong = text.match(STRONG_SIGNALS) || [];
  const meta = text.match(/[\\^$.|?*+()[\]{}]/g) || [];
  return { strong: strong.length, density: meta.length / Math.max(1, text.length) };
}

function parseInput(text) {
  const t = text.trim();
  const delimited = RE_DELIMITED.exec(t);
  if (delimited) return { pattern: delimited[1], flags: delimited[2], delimited: true };

  const { strong, density } = metaSignal(t);
  // A bare pattern needs real regex constructs, not just a stray bracket.
  if (strong < 1 || density < 0.08) return null;
  return { pattern: t, flags: '', delimited: false };
}

export default {
  id: 'regex',
  title: 'Regex',
  priority: 18,

  matches(text) {
    if (!text || text.length > MAX_LEN) return null;
    const parsed = parseInput(text);
    if (!parsed) return null;
    try {
      // Compiled to validate only — never executed against any input.
      new RegExp(parsed.pattern, parsed.flags);
    } catch {
      return null;
    }
    const steps = explain(parsed.pattern);
    if (!steps.length) return null;
    return { ...parsed, steps };
  },

  items({ match }) {
    return [{
      key: 'regex',
      icon: 'regex',
      label: 'Explain this regex',
      value: `${match.steps.length} parts`,
      detailTitle: 'Regex',
      open: () => detailView(match)
    }];
  }
};

function detailView(match) {
  const box = el('div', { class: 'hh-detail' });

  const rows = match.steps.map((step) => el('div', {
    class: 'hh-step',
    style: `padding-left:${step.depth * 11}px`
  },
    el('code', { class: 'hh-mono hh-step-token', text: step.token }),
    el('span', { class: 'hh-step-text', text: step.description })
  ));

  const flagRows = [...match.flags].filter((f) => FLAGS[f]).map((f) =>
    el('div', { class: 'hh-fact' },
      el('em', { class: 'hh-mono', text: f }),
      el('span', { text: FLAGS[f] })
    )
  );

  replaceContent(box,
    el('div', { class: 'hh-steps' }, ...rows),
    flagRows.length
      ? el('div', { class: 'hh-facts' },
          el('div', { class: 'hh-label', text: 'Flags' }), ...flagRows)
      : null,
    match.delimited ? null : note('Read as a bare pattern, with no flags.')
  );
  return box;
}
