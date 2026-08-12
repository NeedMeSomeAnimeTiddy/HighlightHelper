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

import { el, replaceContent, resultView, actionRow, note } from '../kit.js';

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

  const b64 = tryBase64(t);
  if (b64) return { kind: 'base64', text: b64 };

  return null;
}

const LABELS = {
  jwt: ['JWT', 'Decode token'],
  json: ['JSON', 'Format JSON'],
  url: ['URL-encoded', 'Decode URL text'],
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

  items({ match }) {
    const [kind, label] = LABELS[match.kind];
    return [{
      key: 'decode',
      icon: 'decode',
      label,
      value: kind,
      detailTitle: kind,
      open: (api) => (match.kind === 'jwt' ? jwtView(match, api) : textView(match, api))
    }];
  }
};

function textView(match, api) {
  return resultView(match.text, api, { label: LABELS[match.kind][0] });
}

function jwtView(match, api) {
  const box = el('div', { class: 'hh-detail' });
  const claims = Object.entries(match.payload).map(([key, value]) => {
    const readable = TIME_CLAIMS.has(key) && typeof value === 'number'
      ? new Date(value * 1000).toLocaleString()
      : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return el('div', { class: 'hh-fact' },
      el('em', { text: key }),
      el('span', { class: 'hh-mono', text: readable })
    );
  });

  const expiry = typeof match.payload.exp === 'number'
    ? (match.payload.exp * 1000 < Date.now() ? 'Expired' : 'Not expired')
    : null;

  replaceContent(box,
    el('div', { class: 'hh-label', text: `Header · ${match.header.alg || 'unknown alg'}` }),
    expiry ? note(expiry, expiry === 'Expired' ? 'hh-warn' : '') : null,
    el('div', { class: 'hh-label', text: 'Payload' }),
    el('div', { class: 'hh-facts' }, ...claims),
    actionRow(JSON.stringify(match.payload, null, 2), api)
  );
  return box;
}
