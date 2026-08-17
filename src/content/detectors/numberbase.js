/**
 * Number bases — local, no API.
 *
 * "0x1F4", "0b1011", "0o755" and bare integers convert between decimal, hex,
 * binary and octal, with a byte-size reading for values that plausibly are one.
 *
 * Bare integers are filtered hard: a year, a small count or a Unix timestamp
 * would otherwise put a useless "2024 → 0x7E8" row in front of you on every
 * selection that contains a number.
 */

const MAX_LEN = 32;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// Only 0x — a "#RRGGBB" is a colour far more often than it is a hex integer,
// and the colour detector owns that notation.
const RE_HEX = /^0x([0-9a-f]+)$/i;
const RE_BIN = /^0b([01]+)$/i;
const RE_OCT = /^0o([0-7]+)$/i;
const RE_DEC = /^\d+$/;

function looksLikeAYear(n) {
  return n >= 1500n && n <= 2200n;
}

/** Unix-timestamp range — the datetime detector owns those. */
function looksLikeATimestamp(text, n) {
  return (text.length >= 8 && text.length <= 11 && n >= 100000000n && n <= 4000000000n) ||
         (text.length >= 12 && text.length <= 14);
}

function parse(text) {
  const t = text.trim();

  const hex = RE_HEX.exec(t);
  if (hex) return { value: BigInt(`0x${hex[1]}`), source: 'hexadecimal' };

  const bin = RE_BIN.exec(t);
  if (bin) return { value: BigInt(`0b${bin[1]}`), source: 'binary' };

  const oct = RE_OCT.exec(t);
  if (oct) return { value: BigInt(`0o${oct[1]}`), source: 'octal' };

  if (RE_DEC.test(t)) {
    const value = BigInt(t);
    // Only offer base conversion when it's plausibly wanted.
    if (looksLikeAYear(value)) return null;
    if (looksLikeATimestamp(t, value)) return null;
    if (value < 256n) return null;
    return { value, source: 'decimal' };
  }

  return null;
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

function asBytes(value) {
  if (value < 1024n) return null;
  let n = Number(value);
  let i = 0;
  while (n >= 1024 && i < BYTE_UNITS.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 2 : 1)} ${BYTE_UNITS[i]}`;
}

/** Groups a binary string into nibbles so it stays readable. */
function groupBinary(bits) {
  const padded = bits.padStart(Math.ceil(bits.length / 4) * 4, '0');
  return padded.replace(/(.{4})(?=.)/g, '$1 ');
}

export default {
  id: 'numberbase',
  title: 'Number base',
  priority: 14,

  matches(text) {
    if (!text || text.length > MAX_LEN) return null;
    if (!/^[0-9a-fox\s]+$/i.test(text.trim())) return null;
    const found = parse(text);
    if (!found || found.value > MAX_SAFE * 1024n) return null;
    return found;
  },

  rows({ match }) {
    const dec = match.value.toString(10);
    return [{
      key: 'numberbase',
      icon: 'base',
      // Show the reading you don't already have.
      label: match.source === 'decimal' ? 'As hexadecimal' : 'As decimal',
      value: match.source === 'decimal'
        ? `0x${match.value.toString(16).toUpperCase()}`
        : Number(dec).toLocaleString(),
      detailTitle: 'Number base',
      // Four base conversions of a number already in hand — nothing to await.
      detail: { kind: 'blocks', blocks: detailBlocks(match) }
    }];
  }
};

function detailBlocks(match) {
  const { value } = match;

  const facts = [
    { label: 'Decimal', value: Number(value).toLocaleString(), mono: true },
    { label: 'Hex', value: `0x${value.toString(16).toUpperCase()}`, mono: true },
    { label: 'Binary', value: groupBinary(value.toString(2)), mono: true },
    { label: 'Octal', value: `0o${value.toString(8)}`, mono: true }
  ];

  const bytes = asBytes(value);
  if (bytes) facts.push({ label: 'If bytes', value: bytes, mono: true });

  return [
    { type: 'headline', text: Number(value).toLocaleString() },
    { type: 'sub', text: `read as ${match.source}` },
    { type: 'facts', items: facts },
    {
      type: 'buttons',
      items: [{ copy: value.toString(10) }]
    }
  ];
}
