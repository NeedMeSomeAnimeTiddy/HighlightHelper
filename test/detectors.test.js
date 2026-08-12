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
import { detect } from '../src/content/detectors/index.js';

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

check('"$50" offers only the currency tab',
  detect('$50', S({ targetCurrency: 'EUR' })).map((h) => h.detector.id),
  ['currency']);
check('foreign text ranks translate first',
  detect('El gato está en la mesa de la cocina', S())[0].detector.id,
  'translate');
check('a disabled detector is skipped',
  detect('$50', S({
    targetCurrency: 'EUR',
    detectors: { ...DEFAULTS.detectors, currency: false }
  })).some((h) => h.detector.id === 'currency'),
  false);

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
