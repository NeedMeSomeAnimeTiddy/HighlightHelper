/**
 * Unit detector — entirely local, no network.
 *
 * Recognises a measurement in the selection, normalises it to a base unit,
 * then re-expresses it in the "other" system, picking a sensible magnitude
 * (2 500 m becomes 1.55 mi, not 0.00155 kmi).
 *
 * The `unitSystem` setting is the system we aim for; if the source is already
 * in that system we convert to the other one, which is still what you want
 * when you highlight "5 km" as a metric user reading an American article.
 * `imperialFlavor` decides whether gallons/pints/fluid ounces are US or UK.
 */

import { el, replaceContent } from '../kit.js';
import { NUMBER_SRC, parseNumber, formatNumber } from '../../common/numbers.js';

const MAX_LEN = 240;

/* ------------------------------------------------------------------ *
 * Unit table. `f` converts the unit to its dimension's base unit.
 * base units: length m · mass kg · volume L · area m² · speed m/s ·
 *             pressure Pa · energy J · power W
 * ------------------------------------------------------------------ */

const UNITS = [
  // length — metric
  { id: 'mm', dim: 'length', sys: 'metric', f: 0.001, sym: 'mm', al: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'] },
  { id: 'cm', dim: 'length', sys: 'metric', f: 0.01, sym: 'cm', al: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'] },
  { id: 'm', dim: 'length', sys: 'metric', f: 1, sym: 'm', al: ['m', 'meter', 'meters', 'metre', 'metres'], ambiguous: true },
  { id: 'km', dim: 'length', sys: 'metric', f: 1000, sym: 'km', al: ['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres'] },
  // length — imperial
  { id: 'in', dim: 'length', sys: 'imperial', f: 0.0254, sym: 'in', al: ['in', 'inch', 'inches', '"', '″'], ambiguous: true },
  { id: 'ft', dim: 'length', sys: 'imperial', f: 0.3048, sym: 'ft', al: ['ft', 'foot', 'feet', "'", '′'] },
  { id: 'yd', dim: 'length', sys: 'imperial', f: 0.9144, sym: 'yd', al: ['yd', 'yds', 'yard', 'yards'] },
  { id: 'mi', dim: 'length', sys: 'imperial', f: 1609.344, sym: 'mi', al: ['mi', 'mile', 'miles'] },
  { id: 'nmi', dim: 'length', sys: 'neutral', f: 1852, sym: 'nmi', al: ['nmi', 'nautical mile', 'nautical miles'] },

  // mass — metric
  { id: 'mg', dim: 'mass', sys: 'metric', f: 1e-6, sym: 'mg', al: ['mg', 'milligram', 'milligrams'] },
  { id: 'g', dim: 'mass', sys: 'metric', f: 0.001, sym: 'g', al: ['g', 'gram', 'grams', 'gramme', 'grammes'], ambiguous: true },
  { id: 'kg', dim: 'mass', sys: 'metric', f: 1, sym: 'kg', al: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes'] },
  { id: 't', dim: 'mass', sys: 'metric', f: 1000, sym: 't', al: ['t', 'tonne', 'tonnes', 'metric ton', 'metric tons'], ambiguous: true },
  // mass — imperial
  { id: 'oz', dim: 'mass', sys: 'imperial', f: 0.028349523125, sym: 'oz', al: ['oz', 'ounce', 'ounces'] },
  { id: 'lb', dim: 'mass', sys: 'imperial', f: 0.45359237, sym: 'lb', al: ['lb', 'lbs', 'pound', 'pounds'] },
  { id: 'st', dim: 'mass', sys: 'imperial', f: 6.35029318, sym: 'st', al: ['st', 'stone', 'stones'], ambiguous: true },
  { id: 'ton', dim: 'mass', sys: 'imperial', f: 907.18474, sym: 'short tons', al: ['short ton', 'short tons', 'us ton', 'us tons'] },

  // volume — metric
  { id: 'ml', dim: 'volume', sys: 'metric', f: 0.001, sym: 'ml', al: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  { id: 'cl', dim: 'volume', sys: 'metric', f: 0.01, sym: 'cl', al: ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres'] },
  { id: 'l', dim: 'volume', sys: 'metric', f: 1, sym: 'L', al: ['l', 'liter', 'liters', 'litre', 'litres'], ambiguous: true },
  { id: 'm3', dim: 'volume', sys: 'metric', f: 1000, sym: 'm³', al: ['m3', 'm³', 'cubic meter', 'cubic meters', 'cubic metre', 'cubic metres'] },
  // volume — imperial (US)
  { id: 'floz', dim: 'volume', sys: 'imperial', flavor: 'us', f: 0.0295735295625, sym: 'fl oz', al: ['fl oz', 'fl. oz', 'fl.oz', 'fluid ounce', 'fluid ounces'] },
  { id: 'cup', dim: 'volume', sys: 'imperial', flavor: 'us', f: 0.2365882365, sym: 'cups', al: ['cup', 'cups'] },
  { id: 'pt', dim: 'volume', sys: 'imperial', flavor: 'us', f: 0.473176473, sym: 'pt', al: ['pt', 'pint', 'pints'], ambiguous: true },
  { id: 'qt', dim: 'volume', sys: 'imperial', flavor: 'us', f: 0.946352946, sym: 'qt', al: ['qt', 'quart', 'quarts'] },
  { id: 'gal', dim: 'volume', sys: 'imperial', flavor: 'us', f: 3.785411784, sym: 'gal', al: ['gal', 'gals', 'gallon', 'gallons'] },
  // volume — imperial (UK)
  { id: 'floz_uk', dim: 'volume', sys: 'imperial', flavor: 'uk', f: 0.0284130625, sym: 'fl oz', al: ['imperial fluid ounce', 'imperial fluid ounces'] },
  { id: 'pt_uk', dim: 'volume', sys: 'imperial', flavor: 'uk', f: 0.56826125, sym: 'pt', al: ['imperial pint', 'imperial pints'] },
  { id: 'qt_uk', dim: 'volume', sys: 'imperial', flavor: 'uk', f: 1.1365225, sym: 'qt', al: ['imperial quart', 'imperial quarts'] },
  { id: 'gal_uk', dim: 'volume', sys: 'imperial', flavor: 'uk', f: 4.54609, sym: 'gal', al: ['imperial gallon', 'imperial gallons'] },
  { id: 'tsp', dim: 'volume', sys: 'neutral', f: 0.00492892159375, sym: 'tsp', al: ['tsp', 'teaspoon', 'teaspoons'] },
  { id: 'tbsp', dim: 'volume', sys: 'neutral', f: 0.01478676478125, sym: 'tbsp', al: ['tbsp', 'tablespoon', 'tablespoons'] },

  // area
  { id: 'cm2', dim: 'area', sys: 'metric', f: 0.0001, sym: 'cm²', al: ['cm2', 'cm²', 'sq cm', 'square centimeter', 'square centimeters'] },
  { id: 'm2', dim: 'area', sys: 'metric', f: 1, sym: 'm²', al: ['m2', 'm²', 'sq m', 'sqm', 'square meter', 'square meters', 'square metre', 'square metres'] },
  { id: 'ha', dim: 'area', sys: 'metric', f: 10000, sym: 'ha', al: ['ha', 'hectare', 'hectares'] },
  { id: 'km2', dim: 'area', sys: 'metric', f: 1e6, sym: 'km²', al: ['km2', 'km²', 'sq km', 'square kilometer', 'square kilometers', 'square kilometre', 'square kilometres'] },
  { id: 'in2', dim: 'area', sys: 'imperial', f: 0.00064516, sym: 'in²', al: ['in2', 'in²', 'sq in', 'square inch', 'square inches'] },
  { id: 'ft2', dim: 'area', sys: 'imperial', f: 0.09290304, sym: 'ft²', al: ['ft2', 'ft²', 'sq ft', 'sqft', 'square foot', 'square feet'] },
  { id: 'yd2', dim: 'area', sys: 'imperial', f: 0.83612736, sym: 'yd²', al: ['yd2', 'yd²', 'sq yd', 'square yard', 'square yards'] },
  { id: 'acre', dim: 'area', sys: 'imperial', f: 4046.8564224, sym: 'acres', al: ['acre', 'acres'] },
  { id: 'mi2', dim: 'area', sys: 'imperial', f: 2589988.110336, sym: 'mi²', al: ['mi2', 'mi²', 'sq mi', 'square mile', 'square miles'] },

  // speed
  { id: 'kmh', dim: 'speed', sys: 'metric', f: 0.2777777778, sym: 'km/h', al: ['km/h', 'kph', 'kmh', 'km per hour', 'kilometers per hour', 'kilometres per hour'] },
  // Recognised as input, but km/h is what people actually want as an answer.
  { id: 'mps', dim: 'speed', sys: 'metric', f: 1, sym: 'm/s', noAuto: true, al: ['m/s', 'mps', 'meters per second', 'metres per second'] },
  { id: 'mph', dim: 'speed', sys: 'imperial', f: 0.44704, sym: 'mph', al: ['mph', 'miles per hour', 'miles an hour'] },
  { id: 'kn', dim: 'speed', sys: 'neutral', f: 0.514444444, sym: 'kn', al: ['kn', 'knot', 'knots'] },

  // pressure
  { id: 'pa', dim: 'pressure', sys: 'metric', f: 1, sym: 'Pa', al: ['pa', 'pascal', 'pascals'] },
  { id: 'kpa', dim: 'pressure', sys: 'metric', f: 1000, sym: 'kPa', al: ['kpa', 'kilopascal', 'kilopascals'] },
  { id: 'bar', dim: 'pressure', sys: 'metric', f: 100000, sym: 'bar', al: ['bar', 'bars'] },
  { id: 'psi', dim: 'pressure', sys: 'imperial', f: 6894.757293168, sym: 'psi', al: ['psi'] },

  // energy
  { id: 'j', dim: 'energy', sys: 'metric', f: 1, sym: 'J', al: ['j', 'joule', 'joules'], ambiguous: true },
  { id: 'kj', dim: 'energy', sys: 'metric', f: 1000, sym: 'kJ', al: ['kj', 'kilojoule', 'kilojoules'] },
  { id: 'kcal', dim: 'energy', sys: 'metric', f: 4184, sym: 'kcal', al: ['kcal', 'kilocalorie', 'kilocalories', 'calorie', 'calories', 'cal'], ambiguous: true },
  { id: 'btu', dim: 'energy', sys: 'imperial', f: 1055.05585262, sym: 'BTU', al: ['btu', 'btus'] },

  // power
  { id: 'w', dim: 'power', sys: 'metric', f: 1, sym: 'W', al: ['w', 'watt', 'watts'], ambiguous: true },
  { id: 'kw', dim: 'power', sys: 'metric', f: 1000, sym: 'kW', al: ['kw', 'kilowatt', 'kilowatts'] },
  { id: 'hp', dim: 'power', sys: 'imperial', f: 745.6998715823, sym: 'hp', al: ['hp', 'horsepower'] }
];

/** Words that may legitimately follow an ambiguous unit like "27 in tall". */
const OK_AFTER_AMBIGUOUS = new Set([
  'tall', 'wide', 'long', 'high', 'deep', 'thick', 'away', 'each', 'apart',
  'wider', 'longer', 'taller', 'x', 'by', 'or', 'and', 'per', 'of', 'in', 'to'
]);

const BY_ID = new Map(UNITS.map((u) => [u.id, u]));

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALIAS_TO_UNIT = new Map();
for (const u of UNITS) for (const a of u.al) ALIAS_TO_UNIT.set(a.toLowerCase(), u);

const ALIAS_SRC = [...ALIAS_TO_UNIT.keys()]
  .sort((a, b) => b.length - a.length)
  .map(esc)
  .join('|');

const SIGN = String.raw`[-−–]?\s?`;

// Global: we walk every candidate so one rejected ambiguous hit ("5 in the
// morning") doesn't hide a real one later in the same selection.
const RE_SIMPLE = new RegExp(
  String.raw`(${SIGN}(?:${NUMBER_SRC}))\s*(${ALIAS_SRC})(?![\p{L}])`,
  'giu'
);

/* Temperature gets its own pattern so "72°F" and "72 F" work but a lowercase
   "72 f" in prose does not silently become Fahrenheit. */
const RE_TEMP = new RegExp(
  String.raw`(${SIGN}(?:${NUMBER_SRC}))\s*(?:(°|º|\bdeg(?:ree)?s?\.?)\s*)?` +
  String.raw`(celsius|centigrade|fahrenheit|kelvin|℃|℉|C|F|K)(?![\p{L}])`,
  'iu'
);

function tempScale(token) {
  const t = token.toLowerCase();
  if (t === '℉' || t === 'f' || t.startsWith('fahrenheit')) return 'F';
  if (t === 'k' || t.startsWith('kelvin')) return 'K';
  return 'C';
}

const RE_FT_IN = new RegExp(
  String.raw`(\d+)\s*(?:'|′|ft\.?|feet|foot)\s*(\d+(?:[.,]\d+)?)\s*(?:"|″|''|in\.?|inch|inches)?(?![\p{L}])`,
  'iu'
);

const RE_LB_OZ = new RegExp(
  String.raw`(\d+)\s*(?:lbs?\.?|pounds?)\s*(\d+(?:[.,]\d+)?)\s*(?:oz\.?|ounces?)(?![\p{L}])`,
  'iu'
);

const RE_MPG = new RegExp(String.raw`(${NUMBER_SRC})\s*(mpg|miles per gallon)(?![\p{L}])`, 'i');
const RE_L100 = new RegExp(String.raw`(${NUMBER_SRC})\s*(l\/100\s?km|liters per 100 ?km|litres per 100 ?km)`, 'i');

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

function parseSigned(raw) {
  const negative = /^[-−–]/.test(raw.trim());
  const n = parseNumber(raw.replace(/^[-−–]\s?/, ''));
  return negative ? -n : n;
}

/** Ambiguous units need to sit at the end of a clause, or before a size word. */
function ambiguousOk(text, endIndex) {
  const rest = text.slice(endIndex).trim();
  if (!rest) return true;
  if (!/^[\p{L}]/u.test(rest)) return true;
  const nextWord = rest.split(/[\s,.;:!?]/, 1)[0].toLowerCase();
  return OK_AFTER_AMBIGUOUS.has(nextWord);
}

/** Resolves an imperial volume alias to the flavour the user actually uses. */
function flavored(unit, settings) {
  if (unit.dim !== 'volume' || unit.sys !== 'imperial') return unit;
  if (settings.imperialFlavor !== 'uk') return unit;
  const uk = BY_ID.get(`${unit.id}_uk`);
  return uk || unit;
}

function findMeasurement(text, settings) {
  // Compounds first — "5 ft 11 in" must not be read as just "5 ft".
  const ftIn = RE_FT_IN.exec(text);
  if (ftIn) {
    const meters = Number(ftIn[1]) * 0.3048 + parseNumber(ftIn[2]) * 0.0254;
    if (Number.isFinite(meters)) {
      return {
        kind: 'simple',
        dim: 'length',
        base: meters,
        sourceSys: 'imperial',
        fromLabel: `${ftIn[1]} ft ${parseNumber(ftIn[2])} in`,
        raw: ftIn[0].trim()
      };
    }
  }

  const lbOz = RE_LB_OZ.exec(text);
  if (lbOz) {
    const kg = Number(lbOz[1]) * 0.45359237 + parseNumber(lbOz[2]) * 0.028349523125;
    if (Number.isFinite(kg)) {
      return {
        kind: 'simple',
        dim: 'mass',
        base: kg,
        sourceSys: 'imperial',
        fromLabel: `${lbOz[1]} lb ${parseNumber(lbOz[2])} oz`,
        raw: lbOz[0].trim()
      };
    }
  }

  const mpg = RE_MPG.exec(text);
  if (mpg) {
    const v = parseNumber(mpg[1]);
    if (Number.isFinite(v) && v > 0) {
      return { kind: 'fuel', from: 'mpg', value: v, fromLabel: `${formatNumber(v)} mpg`, raw: mpg[0].trim() };
    }
  }

  const l100 = RE_L100.exec(text);
  if (l100) {
    const v = parseNumber(l100[1]);
    if (Number.isFinite(v) && v > 0) {
      return { kind: 'fuel', from: 'l100km', value: v, fromLabel: `${formatNumber(v)} L/100km`, raw: l100[0].trim() };
    }
  }

  const temp = RE_TEMP.exec(text);
  if (temp) {
    const marker = temp[2];
    const token = temp[3];
    const bareLetter = /^[cfk]$/i.test(token);
    // A lowercase bare letter with no degree marker is almost never a unit.
    const acceptable = !bareLetter || Boolean(marker) || token === token.toUpperCase();
    const v = parseSigned(temp[1]);
    if (acceptable && Number.isFinite(v)) {
      const scale = tempScale(token);
      const celsius = scale === 'C' ? v : scale === 'F' ? ((v - 32) * 5) / 9 : v - 273.15;
      return {
        kind: 'temp',
        scale,
        celsius,
        fromLabel: scale === 'K' ? `${formatNumber(v)} K` : `${formatNumber(v)} °${scale}`,
        raw: temp[0].trim()
      };
    }
  }

  RE_SIMPLE.lastIndex = 0;
  for (let m = RE_SIMPLE.exec(text); m; m = RE_SIMPLE.exec(text)) {
    const unit = flavored(ALIAS_TO_UNIT.get(m[2].toLowerCase()), settings);
    const value = parseSigned(m[1]);
    if (!unit || !Number.isFinite(value)) continue;
    if (unit.ambiguous && !ambiguousOk(text, m.index + m[0].length)) continue;
    // A currency symbol just before the number means this is money, not a unit.
    if (/[$€£¥₹₽₩₺₴₪฿₱₦]\s?$/.test(text.slice(Math.max(0, m.index - 3), m.index))) continue;

    return {
      kind: 'simple',
      dim: unit.dim,
      base: value * unit.f,
      sourceSys: unit.sys,
      sourceUnit: unit,
      fromLabel: `${formatNumber(value)} ${unit.sym}`,
      raw: m[0].trim()
    };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Conversion
 * ------------------------------------------------------------------ */

const other = (sys) => (sys === 'metric' ? 'imperial' : 'metric');

/** Units eligible as the *output* of a conversion, smallest first. */
function ladder(dim, sys, settings) {
  const flavor = settings.imperialFlavor === 'uk' ? 'uk' : 'us';
  return UNITS.filter(
    (u) => u.dim === dim && u.sys === sys && !u.noAuto && (!u.flavor || u.flavor === flavor)
  ).sort((a, b) => a.f - b.f);
}

/** Picks the rung of the ladder that gives the most readable number. */
function bestUnit(baseValue, units) {
  if (!units.length) return null;
  const abs = Math.abs(baseValue);
  if (abs === 0) return units.find((u) => u.f === 1) || units[0];
  let chosen = units[0];
  for (const u of units) {
    if (abs / u.f >= 1) chosen = u;
    else break;
  }
  return chosen;
}

function convertFuel(match, settings) {
  const c = settings.imperialFlavor === 'uk' ? 282.480936 : 235.214583;
  const toUnit = match.from === 'mpg' ? 'L/100km' : 'mpg';
  return {
    toUnit,
    toLabel: `${formatNumber(c / match.value)} ${toUnit}`,
    sub: settings.imperialFlavor === 'uk' ? 'Using UK gallons' : 'Using US gallons',
    extras: []
  };
}

function convertTemp(match, settings) {
  const c = match.celsius;

  // °F always goes to °C and vice versa; Kelvin follows the user's system.
  let target;
  if (match.scale === 'F') target = 'C';
  else if (match.scale === 'C') target = 'F';
  else target = settings.unitSystem === 'imperial' ? 'F' : 'C';

  const value = target === 'F' ? (c * 9) / 5 + 32 : c;
  const extras = [];
  if (match.scale !== 'K') {
    extras.push({ label: 'K', value: formatNumber(c + 273.15, { maxDecimals: 1 }) });
  }
  if (match.scale === 'K' && target === 'F') {
    extras.push({ label: '°C', value: formatNumber(c, { maxDecimals: 1 }) });
  }

  return {
    toUnit: `°${target}`,
    toLabel: `${formatNumber(value, { maxDecimals: 1 })} °${target}`,
    extras
  };
}

function convert(match, settings) {
  if (match.kind === 'fuel') return convertFuel(match, settings);
  if (match.kind === 'temp') return convertTemp(match, settings);

  const targetSys =
    match.sourceSys === 'neutral'
      ? settings.unitSystem
      : match.sourceSys === settings.unitSystem
        ? other(settings.unitSystem)
        : settings.unitSystem;

  const units = ladder(match.dim, targetSys, settings);
  const unit = bestUnit(match.base, units);
  if (!unit) return null;

  const value = match.base / unit.f;
  const out = {
    toUnit: unit.sym,
    toLabel: `${formatNumber(value)} ${unit.sym}`,
    extras: []
  };

  // Human-scale heights read better as feet + inches.
  if (match.dim === 'length' && targetSys === 'imperial' && match.base < 3 && match.base > 0.3) {
    const totalIn = match.base / 0.0254;
    const ft = Math.floor(totalIn / 12);
    const inch = totalIn - ft * 12;
    out.extras.push({ label: 'ft + in', value: `${ft}′ ${formatNumber(inch, { maxDecimals: 1 })}″` });
  }
  // And body weights as stone for UK users.
  if (match.dim === 'mass' && targetSys === 'imperial' && settings.imperialFlavor === 'uk' &&
      match.base >= 20 && match.base <= 250) {
    const totalSt = match.base / 6.35029318;
    const st = Math.floor(totalSt);
    const lb = (totalSt - st) * 14;
    out.extras.push({ label: 'stone', value: `${st} st ${formatNumber(lb, { maxDecimals: 1 })} lb` });
  }
  return out;
}

/* ------------------------------------------------------------------ */

export default {
  id: 'unit',
  title: 'Units',
  priority: 20,

  matches(text, settings) {
    if (!text || text.length > MAX_LEN) return null;
    if (!/\d/.test(text)) return null;
    const found = findMeasurement(text, settings);
    if (!found) return null;
    const result = convert(found, settings);
    if (!result) return null;
    return { ...found, result };
  },

  items({ match }) {
    return [{
      key: 'unit',
      icon: 'unit',
      label: `Convert to ${match.result.toUnit}`,
      value: match.result.toLabel,
      detailTitle: 'Unit conversion',
      open: () => detailView(match)
    }];
  }
};

function detailView(match) {
  const { result } = match;
  const box = el('div', { class: 'hh-detail' });

  const headline = el('div', { class: 'hh-headline' },
    el('span', { class: 'hh-from', text: match.fromLabel }),
    el('span', { class: 'hh-arrow', text: '→' }),
    el('span', { text: result.toLabel })
  );

  const parts = [headline];
  if (result.sub) parts.push(el('p', { class: 'hh-sub', text: result.sub }));

  if (result.extras?.length) {
    parts.push(
      el('div', { class: 'hh-facts' },
        ...result.extras.map((x) => el('div', { class: 'hh-fact' },
          el('em', { text: x.label }),
          el('span', { text: x.value })
        ))
      )
    );
  }

  if (match.raw && match.raw.toLowerCase() !== match.fromLabel.toLowerCase()) {
    parts.push(el('p', { class: 'hh-sub', text: `Read from “${match.raw}”` }));
  }

  replaceContent(box, ...parts);
  return box;
}
