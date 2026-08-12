/**
 * Detector tests. Run with:  node test/detectors.test.js
 *
 * These cover the pure half of the extension — parsing and matches() — which
 * is where the fiddly logic lives. No dependencies, no test framework, and no
 * browser: detector modules only touch the DOM inside render().
 */

import { DEFAULTS } from '../src/common/settings.js';
import { parseNumber } from '../src/common/numbers.js';
import currency from '../src/content/detectors/currency.js';
import unit from '../src/content/detectors/unit.js';
import jargon from '../src/content/detectors/jargon.js';
import rewrite from '../src/content/detectors/rewrite.js';
import translate from '../src/content/detectors/translate.js';
import color from '../src/content/detectors/color.js';
import datetime from '../src/content/detectors/datetime.js';
import calc from '../src/content/detectors/calc.js';
import numberbase from '../src/content/detectors/numberbase.js';
import decode from '../src/content/detectors/decode.js';
import texttools from '../src/content/detectors/texttools.js';
import summarize from '../src/content/detectors/summarize.js';
import coords from '../src/content/detectors/coords.js';
import regex from '../src/content/detectors/regex.js';
import code from '../src/content/detectors/code.js';
import qr from '../src/content/detectors/qr.js';
import {
  encode as qrEncode,
  generatorPoly,
  ecCodewords,
  TOTAL_CODEWORDS as QR_TOTAL,
  EC_BLOCKS as QR_EC_BLOCKS
} from '../src/content/qr.js';
import { decode as qrDecode } from './qr-roundtrip.js';
import { detect, LIST } from '../src/content/detectors/index.js';

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n      expected ${e}\n      got      ${a}`);
}

/** Settings with overrides. */
const S = (over = {}) => ({ ...DEFAULTS, ...over });

/* ---------- number parsing ---------- */

check('1,234.56 (US grouping)', parseNumber('1,234.56'), 1234.56);
check('1.234,56 (EU grouping)', parseNumber('1.234,56'), 1234.56);
check('1 234,56 (space grouping)', parseNumber('1 234,56'), 1234.56);
check('1,5 (EU decimal)', parseNumber('1,5'), 1.5);
check('1,234,567', parseNumber('1,234,567'), 1234567);
check('1.234.567', parseNumber('1.234.567'), 1234567);
check('42', parseNumber('42'), 42);

/* ---------- currency ---------- */

const cur = (text, settings = S()) => {
  const m = currency.matches(text, settings);
  return m ? [m.code, m.value] : null;
};

check('$50', cur('$50'), ['USD', 50]);
check('€30', cur('€30', S({ targetCurrency: 'GBP' })), ['EUR', 30]);
check('50 USD', cur('50 USD', S({ targetCurrency: 'EUR' })), ['USD', 50]);
check('USD 50', cur('USD 50', S({ targetCurrency: 'EUR' })), ['USD', 50]);
check('£1.2bn', cur('£1.2bn'), ['GBP', 1.2e9]);
check('CA$40 beats bare $', cur('CA$40'), ['CAD', 40]);
check('¥1,000', cur('¥1,000'), ['JPY', 1000]);
check('amount inside a sentence', cur('It costs $1,234.56 today'), ['USD', 1234.56]);
check('R$ 90', cur('R$ 90'), ['BRL', 90]);
check('no digits, no match', cur('just words'), null);
check('same-currency flag', currency.matches('$50', S()).sameCurrency, true);

/* ---------- units ---------- */

const u = (text, settings = S()) => {
  const m = unit.matches(text, settings);
  return m ? `${m.fromLabel} -> ${m.result.toLabel}` : null;
};

check('5 miles', u('5 miles'), '5 mi -> 8.05 km');
check('100 km for an imperial user', u('100 km', S({ unitSystem: 'imperial' })), '100 km -> 62.14 mi');
check('180 lbs', u('180 lbs'), '180 lb -> 81.65 kg');
check('72°F', u('72°F'), '72 °F -> 22.2 °C');
check('-40 °C', u('-40 °C'), '-40 °C -> -40 °F');
check('300 K', u('300 K'), '300 K -> 26.9 °C');
check('12 oz', u('12 oz'), '12 oz -> 340.2 g');
check('2,500 m picks miles not thou', u('2,500 m'), '2,500 m -> 1.55 mi');
check('5 gal (US)', u('5 gal'), '5 gal -> 18.93 L');
check('5 imperial gallons', u('5 imperial gallons', S({ imperialFlavor: 'uk' })), '5 gal -> 22.73 L');
check('65 mph picks km/h not m/s', u('65 mph'), '65 mph -> 104.6 km/h');
check('30 mpg', u('30 mpg'), '30 mpg -> 7.84 L/100km');
check('1500 sq ft', u('1500 sq ft'), '1,500 ft² -> 139.4 m²');
check('30 psi', u('30 psi'), '30 psi -> 2.07 bar');
check('300 hp', u('300 hp'), '300 hp -> 223.7 kW');
check("5'11\" compound", u(`5'11"`), '5 ft 11 in -> 1.8 m');
check('8 lb 6 oz compound', u('8 lb 6 oz'), '8 lb 6 oz -> 3.8 kg');
check('"5 in the morning" is not inches', u('I woke up at 5 in the morning'), null);
check('"27 in" at end of clause', u('The panel is 27 in'), '27 in -> 68.58 cm');
check('"27 in tall"', u('27 in tall'), '27 in -> 68.58 cm');
check('"$5 m" is money, not metres', u('$5 m'), null);
check('no number, no match', u('kilometers'), null);
check('lowercase bare "f" is not Fahrenheit', u('grade 72 f'), null);

/* ---------- jargon ---------- */

const j = (text) => {
  const m = jargon.matches(text, S());
  return m ? [m.term, m.acronym] : null;
};

check('SLA', j('SLA'), ['SLA', true]);
check('CI/CD', j('CI/CD'), ['CI/CD', true]);
check('two-word term', j('technical debt'), ['technical debt', false]);
check('a sentence is not a term', j('This is a sentence about things.'), null);
check('five words is too many', j('one two three four five'), null);
check('single letter', j('a'), null);

/* ---------- rewrite ---------- */

const r = (text, settings = S()) => Boolean(rewrite.matches(text, settings));

check('long prose', r('The quick brown fox jumped over the lazy dog and kept on running.'), true);
check('short phrase', r('hello there'), false);
check('short but complete sentence', r('I went to the shop today.'), true);

/* ---------- translation / language guessing ---------- */

const tr = (text, settings = S()) => {
  const m = translate.matches(text, settings);
  return m ? [m.detected, m.foreign] : null;
};

check('Spanish is foreign to en', tr('El gato está en la mesa de la cocina'), ['es', true]);
check('Japanese is foreign to en', tr('これはテストです'), ['ja', true]);
check('Russian is foreign to en', tr('Это тестовое предложение'), ['ru', true]);
check('English is not foreign to en',
  tr('This is a normal English sentence about the weather')[1], false);
check('English is foreign to es',
  tr('This is a normal English sentence about the weather', S({ language: 'es' }))[1], true);
check('digits only, no match', tr('12345'), null);

/* ---------- registry ---------- */

check('"$50" offers only the currency row',
  detect('$50', S({ targetCurrency: 'EUR' })).map((h) => h.detector.id),
  ['currency']);
check('text tools stays off a purely numeric selection',
  texttools.matches('1,700,000', S()), null);
check('foreign text ranks translate first',
  detect('El gato está en la mesa de la cocina', S())[0].detector.id,
  'translate');
check('a hex colour ranks colour first',
  detect('#ff0000', S())[0].detector.id, 'color');
check('a timestamp ranks datetime first',
  detect('1700000000', S())[0].detector.id, 'datetime');
check('text tools is always ranked last',
  detect('The quick brown fox jumped over the lazy dog today.', S()).at(-1).detector.id,
  'texttools');

// Every detector must be registered, toggleable, and expose the same shape.
check('every detector has a settings toggle',
  LIST.every((d) => d.id in DEFAULTS.detectors), true);
check('no orphaned toggles',
  Object.keys(DEFAULTS.detectors).every((id) => LIST.some((d) => d.id === id)), true);
check('every detector implements the interface',
  LIST.every((d) => typeof d.matches === 'function' && typeof d.items === 'function' &&
    typeof d.title === 'string' && typeof d.priority === 'number'), true);
check('detector ids are unique', new Set(LIST.map((d) => d.id)).size, LIST.length);
check('a disabled detector is skipped',
  detect('$50', S({
    targetCurrency: 'EUR',
    detectors: { ...DEFAULTS.detectors, currency: false }
  })).some((h) => h.detector.id === 'currency'),
  false);

/* ---------- colour ---------- */

const col = (text) => {
  const m = color.matches(text, S());
  return m ? [m.rgb, +m.alpha.toFixed(2)] : null;
};

check('#ff0000', col('#ff0000'), [[255, 0, 0], 1]);
check('#f00 shorthand', col('#f00'), [[255, 0, 0], 1]);
check('#RRGGBBAA', col('#ff000080'), [[255, 0, 0], 0.5]);
check('rgb()', col('rgb(0, 128, 255)'), [[0, 128, 255], 1]);
check('rgba() with alpha', col('rgba(0,128,255,0.5)'), [[0, 128, 255], 0.5]);
check('hsl() red', col('hsl(0, 100%, 50%)'), [[255, 0, 0], 1]);
check('hsl() teal', col('hsl(180, 100%, 25%)'), [[0, 128, 128], 1]);
check('a bare word is not a colour', col('tomato'), null);
check('hex without # is not a colour', col('ff0000'), null);

/* ---------- date & time ---------- */

const dt = (text) => {
  const m = datetime.matches(text, S());
  return m ? [m.kind, m.date.toISOString()] : null;
};

check('Unix seconds', dt('1700000000'), ['Unix seconds', '2023-11-14T22:13:20.000Z']);
check('Unix milliseconds', dt('1700000000000'), ['Unix milliseconds', '2023-11-14T22:13:20.000Z']);
check('ISO date only', dt('2024-03-15'), ['ISO date', '2024-03-15T00:00:00.000Z']);
check('ISO with time', dt('2024-03-15T10:30:00Z'), ['ISO 8601', '2024-03-15T10:30:00.000Z']);
check('a year is not a timestamp', dt('2024'), null);
check('small numbers are not timestamps', dt('12345'), null);
check('prose is not parsed', dt('next friday'), null);

/* ---------- calculator ---------- */

const ca = (text) => {
  const m = calc.matches(text, S());
  return m ? m.value : null;
};

check('12 * 8 + 3', ca('12 * 8 + 3'), 99);
check('precedence', ca('2 + 3 * 4'), 14);
check('brackets', ca('(4 + 5) / 2'), 4.5);
check('exponent, right assoc', ca('2^3^2'), 512);
check('unary minus', ca('-5 + 3'), -2);
check('thousands separators', ca('1,000 + 250'), 1250);
check('percent of', ca('15% of 240'), 36);
check('percent delta', ca('200 + 15%'), 230);
check('a bare number is not a calculation', ca('42'), null);
check('money is left to the currency detector', ca('$20 + $5'), null);
check('prose is not a calculation', ca('two plus two'), null);
check('unbalanced brackets rejected', ca('(4 + 5'), null);
check('trailing operator rejected', ca('4 +'), null);

/* ---------- number bases ---------- */

const nb = (text) => {
  const m = numberbase.matches(text, S());
  return m ? [m.source, m.value.toString(10)] : null;
};

check('hex', nb('0x1F4'), ['hexadecimal', '500']);
check('#RRGGBB is left to the colour detector', nb('#3f8ae0'), null);
check('binary', nb('0b1011'), ['binary', '11']);
check('octal', nb('0o755'), ['octal', '493']);
check('large decimal', nb('65536'), ['decimal', '65536']);
check('a year is skipped', nb('2024'), null);
check('a timestamp is skipped', nb('1700000000'), null);
check('small numbers are skipped', nb('42'), null);

/* ---------- decode ---------- */

const de = (text) => {
  const m = decode.matches(text, S());
  return m ? m.kind : null;
};

// {"alg":"HS256","typ":"JWT"} . {"sub":"123","name":"Ada"} . sig
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjMiLCJuYW1lIjoiQWRhIn0.abc123';
check('JWT', de(JWT), 'jwt');
check('JWT payload decoded',
  decode.matches(JWT, S()).payload.name, 'Ada');
check('JSON', de('{"a":1,"b":[2,3]}'), 'json');
check('URL-encoded', de('hello%20world%21%20caf%C3%A9'), 'url');
check('base64', de('SGVsbG8gdGhlcmUsIHdvcmxkIQ=='), 'base64');
check('base64 decodes correctly',
  decode.matches('SGVsbG8gdGhlcmUsIHdvcmxkIQ==', S()).text, 'Hello there, world!');
check('a plain word is not base64', de('Highlighting'), null);
check('broken JSON is not JSON', de('{"a":1,'), null);
check('ordinary prose is not encoded', de('The quick brown fox jumps'), null);

/* ---------- text tools ---------- */

const tt = texttools.matches('Hello brave new world', S());
check('text tools counts words', tt.stats.words, 4);
check('text tools counts characters', tt.stats.characters, 21);
check('text tools needs some content', texttools.matches('  ', S()), null);
check('text tools ignores pure punctuation', texttools.matches('!!!', S()), null);

const ttRows = texttools.items({ text: 'Hello brave new world', match: tt, settings: S(), api: {} });
check('text tools contributes one row', ttRows.length, 1);
check('text tools row shows the count', ttRows[0].value, '4 words');

/* ---------- summarise ---------- */

const longText = 'The committee met on Tuesday to review the quarterly figures. '.repeat(6);
check('summarise matches long prose', Boolean(summarize.matches(longText, S())), true);
check('summarise ignores a short line', summarize.matches('A short line.', S()), null);
check('summarise offers two rows',
  summarize.items({ text: longText, match: summarize.matches(longText, S()), settings: S(), api: {} })
    .map((r) => r.key),
  ['summarize', 'keypoints']);

/* ---------- coordinates ---------- */

const co = (text) => {
  const m = coords.matches(text, S());
  return m ? [+m.lat.toFixed(4), +m.lon.toFixed(4)] : null;
};

check('decimal pair', co('37.7749, -122.4194'), [37.7749, -122.4194]);
check('decimal pair, no comma', co('37.7749 -122.4194'), [37.7749, -122.4194]);
check('hemisphere suffixes', co('37.7749N, 122.4194W'), [37.7749, -122.4194]);
check('southern + eastern', co('33.8688S 151.2093E'), [-33.8688, 151.2093]);
check('DMS', co(`37°46'29.6"N 122°25'9.8"W`), [37.7749, -122.4194]);
check('out of range latitude rejected', co('91.0, 12.0'), null);
check('out of range longitude rejected', co('45.0, 181.0'), null);
check('null island rejected', co('0, 0'), null);
check('a plain number pair is not a location', co('hello there'), null);

/* ---------- regex ---------- */

const rx = (text) => {
  const m = regex.matches(text, S());
  return m ? m.steps.map((s) => s.token) : null;
};

check('delimited pattern tokenised',
  rx('/^\\d{3}-\\d{4}$/'), ['^', '\\d{3}', '-', '\\d{4}', '$']);
check('flags captured', regex.matches('/ab+c/gi', S()).flags, 'gi');
check('character class', rx('[a-z]+'), ['[a-z]+']);
check('groups and alternation',
  rx('(foo|bar)'), ['(', 'foo', '|', 'bar', ')']);
check('non-capturing group described',
  regex.matches('(?:ab)+', S()).steps[0].description, 'start of a group (not captured)');
check('lookahead described',
  regex.matches('(?=\\d)', S()).steps[0].description,
  'start of a lookahead — what follows must match');
check('quantifier folds into its token',
  regex.matches('a{2,4}', S()).steps[0].description,
  'the literal text "a", repeated between 2 and 4 times');
check('lazy quantifier noted',
  regex.matches('/a+?/', S()).steps[0].description.endsWith('as few as possible'), true);
check('prose is not a regex', rx('Hello there, how are you?'), null);
check('an invalid pattern is rejected', rx('/([a-z/'), null);
check('a bare pattern needs a real regex construct', rx('(hi)'), null);
check('depth tracks nesting',
  regex.matches('/(a(b))/', S()).steps.map((s) => s.depth), [0, 1, 1, 2, 1, 0]);

/* ---------- code ---------- */

const JS = 'function add(a, b) {\n  const total = a + b;\n  return total;\n}';
const PY = 'def add(a, b):\n    total = a + b\n    return total';

check('javascript recognised', code.matches(JS, S())?.language, 'JavaScript');
check('python recognised', code.matches(PY, S())?.language, 'Python');
check('typescript beats javascript',
  code.matches('const x: number = 1;\nfunction f(): void {}', S())?.language, 'TypeScript');
check('sql recognised',
  code.matches('SELECT id, name FROM users WHERE active = 1;', S())?.language, 'SQL');
check('prose is not code', code.matches(
  'The quick brown fox jumped over the lazy dog and kept running for miles.', S()), null);
check('code offers explain and comment',
  code.items({ text: JS, match: code.matches(JS, S()), settings: S(), api: {} })
    .map((r) => r.key), ['code', 'code:comment']);

/* ---------- QR ---------- */

// The block tables are the easiest place for a transposed digit to hide, and a
// wrong one produces codes that only some scanners can read. This identity ties
// them to the independent total-codeword table.
let qrTablesConsistent = true;
for (let v = 1; v <= 20; v++) {
  const [ec, g1, d1, g2, d2] = QR_EC_BLOCKS[v];
  if (g1 * d1 + g2 * d2 + ec * (g1 + g2) !== QR_TOTAL[v]) qrTablesConsistent = false;
}
check('QR block tables agree with the codeword totals', qrTablesConsistent, true);

check('QR generator polynomial for 10 EC codewords',
  generatorPoly(10).join(','), '1,216,194,159,111,199,94,95,113,157,193');
// The worked example from the specification: "HELLO WORLD" at version 1-M.
check('QR Reed-Solomon matches the spec worked example',
  Array.from(ecCodewords(
    Uint8Array.from([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]), 10
  )).join(','),
  '196,35,39,119,235,215,231,226,93,23');

const qrSmall = qrEncode('https://example.com');
check('QR picks a small version for a short url', qrSmall.version, 2);
check('QR matrix is square and the right size',
  qrSmall.size === qrSmall.modules.length && qrSmall.size === qrSmall.version * 4 + 17, true);
check('QR finder pattern present at the origin',
  qrSmall.modules[0].slice(0, 7).join(''), 'truetruetruetruetruetruetrue');
check('QR separator row is light',
  qrSmall.modules[7].slice(0, 8).every((m) => m === false), true);
check('QR always-dark module is set',
  qrSmall.modules[qrSmall.size - 8][8], true);
// The timing row is dark at even coordinates, so it starts dark at column 8.
check('QR timing pattern alternates',
  qrSmall.modules[6].slice(8, 14).map((m) => (m ? 1 : 0)).join(''), '101010');
check('QR grows with content', qrEncode('x'.repeat(300)).version > qrSmall.version, true);
check('QR rejects content past version 20', (() => {
  try { qrEncode('x'.repeat(2000)); return false; } catch { return true; }
})(), true);

// The round trip: encode, then read the matrix back with an independently
// written reader and check both the payload and the Reed-Solomon syndromes.
for (const sample of [
  'https://example.com',
  'https://example.com/docs/getting-started?ref=highlight&x=1',
  'WIFI:T:WPA;S:MyNetwork;P:hunter2;;',
  'Café — naïve résumé 😀',           // multi-byte UTF-8
  'x'.repeat(120),                    // spans multiple blocks
  'y'.repeat(330)                     // two block groups
]) {
  const encoded = qrEncode(sample);
  let round;
  try {
    round = qrDecode(encoded);
  } catch (err) {
    round = { text: `THREW: ${err.message}`, blocksValid: false };
  }
  check(`QR round trip (${sample.slice(0, 22)}${sample.length > 22 ? '…' : ''})`,
    round.text, sample);
  check(`QR error-correction codewords valid (v${encoded.version})`, round.blocksValid, true);
}

const qrRow = qr.items({ text: 'https://example.com', match: qr.matches('https://example.com', S()), settings: S(), api: {} });
check('QR labels a link', qrRow[0].label, 'QR code for this link');
check('QR ranks a link above the catch-alls',
  qr.matches('https://example.com', S()).priority, 35);
check('QR ranks plain text low', qr.matches('MyNetwork hunter2', S()).priority, 85);
check('QR declines an essay', qr.matches('x'.repeat(500), S()), null);
check('QR declines a prose sentence',
  qr.matches('The office is five miles from the station.', S()), null);
check('QR takes an address-like line',
  Boolean(qr.matches('10 Downing St, London SW1A 2AA', S())), true);
check('QR declines a bare amount', qr.matches('$50', S()), null);

/* ---------- code and prose do not collide ---------- */

check('rewrite skips code', rewrite.matches(JS, S()), null);
check('summarise skips code', summarize.matches(JS.repeat(6), S()), null);
check('translate does not rank code as foreign',
  translate.matches(JS, S()).foreign, false);
check('english with articles is not mistaken for portuguese',
  translate.matches('This is a note about a thing that a person wrote', S()).foreign, false);
check('a coordinate pair is not arithmetic', calc.matches('37.7749, -122.4194', S()), null);

/* ---------- catch-all detectors stay out of the way ---------- */

// A hex colour, a JWT and an arithmetic expression each have a detector that
// owns them; the shape-based detectors must not pile extra rows on top.
const idsFor = (text, settings = S()) => detect(text, settings).map((h) => h.detector.id);

check('a hex colour offers only the colour row', idsFor('#3f8ae0'), ['color']);
check('a JWT offers only the decode row', idsFor(JWT), ['decode']);
check('an arithmetic expression offers only the result',
  idsFor('15% of 240'), ['calc']);
check('a timestamp offers only the date row', idsFor('1700000000'), ['datetime']);
check('a hex literal offers only the base row', idsFor('0x1F4'), ['numberbase']);

check('translate skips a hex colour', translate.matches('#3f8ae0', S()), null);
check('translate skips a JWT', translate.matches(JWT, S()), null);
check('rewrite skips a JWT', rewrite.matches(JWT, S()), null);
check('text tools skips a hex colour', texttools.matches('#3f8ae0', S()), null);
check('text tools still handles an identifier',
  Boolean(texttools.matches('user_id_2', S())), true);
check('rewrite needs at least five words',
  rewrite.matches('one two three four', S({ minRewriteChars: 5 })), null);

/* ---------- menu rows ---------- */

/**
 * Enough of the panel's api object for items() to build rows. Nothing here
 * touches the DOM — open() is lazy, so the row descriptions can be inspected
 * outside a browser.
 */
const fakeApi = {
  forcedLanguage: null,
  send: async () => ({
    ok: true,
    rates: { USD: 1, EUR: 0.922, GBP: 0.79, JPY: 157.2 },
    updated: Date.parse('2026-08-12T00:00:00Z'),
    stale: false
  })
};

const rows = (detector, text, settings = S()) => {
  const match = detector.matches(text, settings);
  return match ? detector.items({ text, match, settings, api: fakeApi }) : [];
};

const currencyRows = rows(currency, '$50', S({ targetCurrency: 'EUR' }));
check('currency row label', currencyRows[0].label, 'Convert to EUR');
check('currency row resolves its value', await currencyRows[0].value, '€46.10');
check('currency row is clickable', typeof currencyRows[0].open, 'function');

const sameRows = rows(currency, '$50', S({ targetCurrency: 'USD' }));
check('same-currency row is static', sameRows[0].open, undefined);
check('same-currency row still reports the amount', sameRows[0].value, '$50.00');

const unitRows = rows(unit, '5 miles');
check('unit row label names the target unit', unitRows[0].label, 'Convert to km');
check('unit row carries the answer inline', unitRows[0].value, '8.05 km');

check('acronym row quotes the term', rows(jargon, 'SLA')[0].label, 'Expand “SLA”');
check('phrase row is generic', rows(jargon, 'technical debt')[0].label, 'Explain this');
check('translate row names the target', rows(translate, 'Hola amigo mio')[0].label,
  'Translate to English');

const rewriteRows = rows(rewrite, 'The quick brown fox jumped over the lazy dog and ran.');
check('rewrite row label', rewriteRows[0].label, 'Rewrite');
check('rewrite row shows length', rewriteRows[0].value, '11 words');

// Every row the panel can build needs a stable, unique key.
const allRows = [
  ...rows(currency, '$50', S({ targetCurrency: 'EUR' })),
  ...rows(unit, '5 miles'),
  ...rows(jargon, 'SLA'),
  ...rows(translate, 'Hola amigo mio'),
  ...rewriteRows
];
check('every row has a key', allRows.every((r) => typeof r.key === 'string' && r.key), true);
check('keys are unique', new Set(allRows.map((r) => r.key)).size, allRows.length);
check('every row has an icon', allRows.every((r) => typeof r.icon === 'string'), true);

/* ---------- report ---------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exitCode = 1;
}
