/**
 * Encoded payloads — local, no API.
 *
 * Recognises JWTs, base64, percent-encoding and JSON, and shows the decoded
 * form. Everything is decoded in the isolated world with atob/decodeURIComponent
 * and JSON.parse — nothing is executed, and nothing leaves the page.
 *
 * Detection is conservative: a base64 candidate is only accepted if it decodes
 * to mostly printable text, because plenty of ordinary words are technically
 * valid base64.
 */

const MAX_LEN = 20000;

const RE_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const RE_B64 = /^[A-Za-z0-9+/\r\n]+={0,2}$/;
const RE_B64URL = /^[A-Za-z0-9_-]+$/;

function bytesToText(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function b64ToBytes(input) {
  const clean = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Share of characters that are ordinary printable text. Control codes and
 * U+FFFD (the replacement character) are what binary garbage decodes into,
 * so a low ratio means the base64 candidate was not really text.
 */
const RE_JUNK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g;

function printableRatio(s) {
  if (!s.length) return 0;
  return 1 - (s.match(RE_JUNK) || []).length / s.length;
}

function tryBase64(text) {
  const t = text.replace(/\s+/g, '');
  if (t.length < 8 || t.length > 8000) return null;
  if (!RE_B64.test(text) && !RE_B64URL.test(t)) return null;
  // Unpadded base64 is always a multiple of 4 once padding is restored.
  if (/[+/=]/.test(t) === false && /^[A-Za-z]+$/.test(t)) return null; // plain word
  try {
    const decoded = bytesToText(b64ToBytes(t));
    if (!decoded || printableRatio(decoded) < 0.9) return null;
    if (decoded.replace(/\s/g, '').length < 4) return null;
    return decoded;
  } catch {
    return null;
  }
}

function prettyJson(text) {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

function decodeJwt(text) {
  const parts = text.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(bytesToText(b64ToBytes(parts[0])));
    const payload = JSON.parse(bytesToText(b64ToBytes(parts[1])));
    return { header, payload };
  } catch {
    return null;
  }
}

function identify(text) {
  const t = text.trim();

  if (RE_JWT.test(t) && t.startsWith('eyJ')) {
    const jwt = decodeJwt(t);
    if (jwt) return { kind: 'jwt', ...jwt };
  }

  const json = prettyJson(t);
  if (json) return { kind: 'json', text: json };

  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      const decoded = decodeURIComponent(t.replace(/\+/g, ' '));
      if (decoded !== t) return { kind: 'url', text: decoded };
    } catch { /* malformed escape — not percent-encoded after all */ }
  }

  const entities = decodeEntities(t);
  if (entities) return { kind: 'entities', text: entities };

  const b64 = tryBase64(t);
  if (b64) return { kind: 'base64', text: b64 };

  return null;
}

/**
 * HTML entities — `&amp;`, `&eacute;`, `&#8212;`, `&#x2014;`.
 *
 * Decoded by table and by code point rather than by assigning to `innerHTML`
 * and reading `textContent` back. That trick is the usual one-liner and it is
 * an HTML parser pointed at untrusted text; that it happens to be inert for
 * entities alone is not a property worth relying on inside a content script
 * that runs on every page.
 *
 * The table below is the Latin-1 block, U+00A0 to U+00FF, in code order.
 *
 * Written as one list rather than ninety-six object entries because that is
 * exactly what it is — a contiguous run, where the index is the code point.
 * The first version hand-listed thirty "common" entities and missed every
 * accented letter, so "caf&eacute;" decoded to "caf&eacute;" — the tool
 * appeared to work while silently doing half the job.
 */
const LATIN1 = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml ' +
  'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times ' +
  'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml ' +
  'igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide ' +
  'oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');

/**
 * Everything outside Latin-1 that turns up in copied prose. The full HTML set
 * runs to over two thousand names; the rest arrive numerically in practice.
 */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  sbquo: '‚', bdquo: '„', trade: '™',
  bull: '•', dagger: '†', Dagger: '‡', permil: '‰',
  prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›',
  oline: '‾', frasl: '⁄', euro: '€',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
  minus: '−', ne: '≠', le: '≤', ge: '≥', infin: '∞',
  ensp: ' ', emsp: ' ', thinsp: ' '
};

// The index is the code point, so the whole accented-letter family comes free.
LATIN1.forEach((name, i) => { NAMED[name] = String.fromCharCode(0xa0 + i); });

const RE_ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,31});/gi;

function decodeEntities(text) {
  if (!RE_ENTITY.test(text)) return null;
  RE_ENTITY.lastIndex = 0;

  let changed = false;
  const out = text.replace(RE_ENTITY, (whole, body) => {
    let ch = null;
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Surrogates and out-of-range values are not text; leave them written out.
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff)) {
        ch = String.fromCodePoint(code);
      }
    } else {
      // Entity names are case-sensitive — &Uuml; is Ü and &uuml; is ü — so an
      // exact hit wins. The lowercase retry is only tolerance for malformed
      // input like &AMP;, and can never override a real cased pair.
      ch = NAMED[body] ?? NAMED[body.toLowerCase()] ?? null;
    }
    if (ch == null) return whole;
    changed = true;
    return ch;
  });

  return changed ? out : null;
}

const LABELS = {
  jwt: ['JWT', 'Decode token'],
  json: ['JSON', 'Format JSON'],
  url: ['URL-encoded', 'Decode URL text'],
  entities: ['HTML entities', 'Decode HTML entities'],
  base64: ['Base64', 'Decode base64']
};

/** Claims that are Unix timestamps, rendered as readable dates. */
const TIME_CLAIMS = new Set(['exp', 'iat', 'nbf', 'auth_time', 'updated_at']);

export default {
  id: 'decode',
  title: 'Decode',
  priority: 25,

  matches(text) {
    if (!text || text.length > MAX_LEN) return null;
    if (text.trim().length < 8) return null;
    const found = identify(text);
    return found || null;
  },

  rows({ match }) {
    const [kind, label] = LABELS[match.kind];
    return [{
      key: 'decode',
      icon: 'decode',
      label,
      value: kind,
      detailTitle: kind,
      // Everything is already decoded by `matches`, so the view is static
      // content: no work left to do behind a spinner.
      detail: {
        kind: 'blocks',
        blocks: match.kind === 'jwt' ? jwtBlocks(match) : textBlocks(match)
      }
    }];
  }
};

function textBlocks(match) {
  return [
    { type: 'label', text: LABELS[match.kind][0] },
    { type: 'text', text: match.text },
    { type: 'actions', text: match.text }
  ];
}

function jwtBlocks(match) {
  const claims = Object.entries(match.payload).map(([key, value]) => ({
    label: key,
    value: TIME_CLAIMS.has(key) && typeof value === 'number'
      ? new Date(value * 1000).toLocaleString()
      : typeof value === 'object' ? JSON.stringify(value) : String(value),
    // Claim values are opaque identifiers and timestamps as often as they are
    // words, so they line up better in a monospaced face.
    mono: true
  }));

  const expiry = typeof match.payload.exp === 'number'
    ? (match.payload.exp * 1000 < Date.now() ? 'Expired' : 'Not expired')
    : null;

  return [
    { type: 'label', text: `Header · ${match.header.alg || 'unknown alg'}` },
    // A token with no `exp` claim simply says nothing about expiry rather than
    // claiming it never expires.
    ...(expiry
      ? [{ type: 'note', text: expiry, variant: expiry === 'Expired' ? 'hh-warn' : '' }]
      : []),
    { type: 'label', text: 'Payload' },
    { type: 'facts', items: claims },
    { type: 'actions', text: JSON.stringify(match.payload, null, 2) }
  ];
}
