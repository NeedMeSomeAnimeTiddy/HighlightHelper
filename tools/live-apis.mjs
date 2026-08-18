/**
 * The real APIs, against the real parsers.  Run with:  npm run test:live
 *
 * Every other test in this repo stubs the network, which is right — a suite
 * that fails when a train goes into a tunnel teaches you nothing. But it
 * leaves one thing unchecked, and it is the thing most likely to break without
 * anyone touching this code: the services answering in a shape these modules
 * no longer recognise.
 *
 * Wikipedia can restructure a summary response, Wiktionary can rename a field,
 * the rate service can change how it reports a date. Every stub in the repo
 * would keep passing, and the first sign would be a user seeing "no article
 * for that".
 *
 * So this is deliberately NOT part of `npm test`: it needs a network, it can
 * fail for reasons that are nobody's fault, and a suite that cries wolf gets
 * ignored. Run it when something looks wrong, before a release, or when a
 * lookup starts failing and you want to know whose end it is.
 */

import { lookup, searchLinks, wikiLang } from '../src/background/wikipedia.js';
import { define, synonyms } from '../src/background/dictionary.js';

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) passed++;
  else failures.push(`${label}\n      expected ${b}\n      got      ${a}`);
}

function report(label, err) {
  failures.push(`${label}\n      threw ${err?.message || err}`);
}

/*
 * These modules were written for a browser, where `fetch` is global and sends
 * a real User-Agent. Node has the first and not the second, and Wikimedia
 * refuses generic agents with a 403 — which is exactly the bug that shipped to
 * the phone. Identifying ourselves here is not test scaffolding; it is the same
 * requirement the app has to meet.
 */
const UA = 'HighlightHelper/0.1.0 (repo test; term lookup for highlighted text)';
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) =>
  realFetch(url, { ...init, headers: { ...(init.headers || {}), 'User-Agent': UA } });

/* ---------- Wikipedia ---------- */

try {
  const articles = await lookup('Service-level agreement', wikiLang('en'), '');
  const first = articles?.[0];

  check('an article is found', Boolean(first), true);
  check('with the fields the panel renders',
    [typeof first?.title, typeof first?.extract, typeof first?.url, typeof first?.lang],
    ['string', 'string', 'string', 'string']);
  check('and the extract is prose, not empty', (first?.extract || '').length > 40, true);
  check('search links are offered alongside', searchLinks('SLA', 'en').length > 0, true);
} catch (err) {
  report('Wikipedia lookup', err);
}

try {
  // A term with no article must be an answer, not an error — the panel shows
  // "no encyclopedia article for X" and offers a search instead.
  const none = await lookup('zzzqqxnotarealterm', 'en', '');
  check('a term with no article returns nothing rather than throwing',
    Array.isArray(none) && none.length === 0, true);
} catch (err) {
  report('Wikipedia miss', err);
}

/* ---------- Wiktionary ---------- */

try {
  const result = await define('serendipity', 'en');
  const entry = result?.entries?.[0];

  check('a definition comes back', Boolean(entry), true);
  check('shaped into parts of speech and definitions',
    [typeof entry?.partOfSpeech, Array.isArray(entry?.definitions)],
    ['string', true]);
  check('with text in the first sense',
    (entry?.definitions?.[0]?.text || '').length > 5, true);
} catch (err) {
  report('Wiktionary define', err);
}

/* ---------- Datamuse ---------- */

try {
  const words = await synonyms('happy', 'en');
  check('synonyms come back as a list of words',
    Array.isArray(words) && words.every((w) => typeof w === 'string'), true);
  check('and there are some', words.length > 0, true);
} catch (err) {
  report('Datamuse synonyms', err);
}

/* ---------- Exchange rates ---------- */

try {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  const body = await res.json();
  check('the rate service answers', res.status, 200);
  check('with a rates table', typeof body?.rates?.EUR, 'number');
  check('and a publication time', typeof body?.time_last_update_unix, 'number');
} catch (err) {
  report('Exchange rates', err);
}

/* ---------- report ---------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  console.log(
    '\nA failure here means the service changed, the network is down, or we are\n' +
    'being rate-limited — in that order of likelihood. It does not mean the\n' +
    'detectors are broken; `npm test` answers that.'
  );
  process.exitCode = 1;
}
