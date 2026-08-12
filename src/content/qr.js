/**
 * A minimal QR encoder — byte mode, error-correction level M, versions 1–20.
 *
 * Written from scratch because the extension carries no dependencies. Scope is
 * deliberately narrow: byte mode covers any UTF-8 text, and level M (~15%
 * recovery) is the usual default. That reaches 666 bytes at version 20, far
 * more than anything worth putting on screen.
 *
 * Structure follows ISO/IEC 18004: encode to a bit stream, split into blocks,
 * append Reed–Solomon codewords, interleave, lay out in a zig-zag, then pick
 * the mask with the lowest penalty score.
 *
 * The block tables below are checked in test/detectors.test.js against the
 * independent total-codeword table — a typo in either one breaks the identity
 *   group1·data1 + group2·data2 + ec·blocks === totalCodewords[version]
 * which is how a transposed digit gets caught rather than silently producing
 * codes that only some scanners can read.
 */

const MIN_VERSION = 1;
const MAX_VERSION = 20;
const EC_LEVEL_M = 0b00;

/** Total codewords (data + EC) per version. Exported so tests can cross-check. */
export const TOTAL_CODEWORDS = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
  404, 466, 532, 581, 655, 733, 815, 901, 991, 1085
];

/** [ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data] at level M. */
export const EC_BLOCKS = [
  null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37], [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46],
  [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42]
];

/** Alignment-pattern centre coordinates per version. */
const ALIGNMENT = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
  [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]
];

/** Unused bits after the final codeword, per version. */
function remainderBits(version) {
  if (version === 1) return 0;
  if (version <= 6) return 7;
  if (version <= 13) return 0;
  return 3;
}

export function dataCodewords(version) {
  const [ec, g1, d1, g2, d2] = EC_BLOCKS[version];
  void ec;
  return g1 * d1 + g2 * d2;
}

/* ------------------------------------------------------------------ *
 * GF(256) arithmetic, primitive polynomial 0x11D
 * ------------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `degree` error-correction codewords. */
export function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder: the EC codewords for one block. */
export function ecCodewords(data, count) {
  const gen = generatorPoly(count);
  const buf = new Uint8Array(data.length + count);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j++) {
      buf[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return buf.slice(data.length);
}

/* ------------------------------------------------------------------ *
 * Data encoding
 * ------------------------------------------------------------------ */

class BitBuffer {
  constructor() { this.bits = []; }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() { return this.bits.length; }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => { if (bit) out[i >>> 3] |= 0x80 >>> (i & 7); });
    return out;
  }
}

/** Smallest version that fits `byteLength` bytes, or null if none does. */
export function pickVersion(byteLength) {
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= dataCodewords(v) * 8) return v;
  }
  return null;
}

function encodeData(bytes, version) {
  const capacityBits = dataCodewords(version) * 8;
  const buf = new BitBuffer();
  buf.put(0b0100, 4);                                  // byte mode
  buf.put(bytes.length, version <= 9 ? 8 : 16);        // character count
  for (const b of bytes) buf.put(b, 8);

  buf.put(0, Math.min(4, capacityBits - buf.length));  // terminator
  while (buf.length % 8 !== 0) buf.put(0, 1);          // pad to a byte

  const out = Array.from(buf.toBytes());
  const PAD = [0xec, 0x11];
  for (let i = 0; out.length < capacityBits / 8; i++) out.push(PAD[i % 2]);
  return Uint8Array.from(out);
}

/** Splits into blocks, adds EC codewords, and interleaves both. */
function interleave(data, version) {
  const [ecPerBlock, g1, d1, g2, d2] = EC_BLOCKS[version];
  const blocks = [];
  let offset = 0;

  for (let i = 0; i < g1; i++) {
    blocks.push(data.slice(offset, offset + d1));
    offset += d1;
  }
  for (let i = 0; i < g2; i++) {
    blocks.push(data.slice(offset, offset + d2));
    offset += d2;
  }

  const ecBlocks = blocks.map((b) => ecCodewords(b, ecPerBlock));
  const result = [];

  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return Uint8Array.from(result);
}

/* ------------------------------------------------------------------ *
 * Matrix
 * ------------------------------------------------------------------ */

function formatBits(mask) {
  const data = (EC_LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

export const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

/**
 * Everything that is not data: finders, separators, timing, alignment, and the
 * reserved format/version areas.
 *
 * Exported because the tests decode a generated matrix back to its original
 * text, and a reader needs to know which modules to skip.
 */
export function functionModules(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (x, y, dark) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  // Finder patterns + separators.
  const finder = (cx, cy) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(x, y, d !== 2 && d <= 3);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns, skipping the three finder corners.
  const centres = ALIGNMENT[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve the format areas before laying data (values written below).
  for (let i = 0; i < 9; i++) {
    if (!reserved[i][8]) set(8, i, false);
    if (!reserved[8][i]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  return { modules, reserved, size };
}

function buildMatrix(version, codewords, mask) {
  const { modules, reserved, size } = functionModules(version);

  // Data, laid out in an upward/downward zig-zag over column pairs.
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
        if (MASKS[mask](x, y)) dark = !dark;
        modules[y][x] = dark;
      }
    }
  }

  // Format information, twice.
  const fmt = formatBits(mask);
  const bit = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = true; // always-dark module

  return modules;
}

/** ISO/IEC 18004 mask penalty, lower is better. */
function penalty(modules) {
  const size = modules.length;
  let score = 0;

  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  const PATTERN = [true, false, true, true, true, false, true, false, false, false, false];
  const hasPattern = (line, at) => {
    for (let k = 0; k < 11; k++) if (line[at + k] !== PATTERN[k]) return false;
    return true;
  };
  const hasPatternReversed = (line, at) => {
    for (let k = 0; k < 11; k++) if (line[at + k] !== PATTERN[10 - k]) return false;
    return true;
  };

  for (let y = 0; y < size; y++) {
    const row = modules[y];
    const col = modules.map((r) => r[y]);
    score += runScore(row) + runScore(col);
    for (let x = 0; x + 11 <= size; x++) {
      if (hasPattern(row, x) || hasPatternReversed(row, x)) score += 40;
      if (hasPattern(col, x) || hasPatternReversed(col, x)) score += 40;
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) {
        score += 3;
      }
    }
  }

  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encodes `text` and returns { modules, size, version } where `modules` is a
 * size×size boolean grid, true meaning a dark module. Throws when the text is
 * too long for version 20.
 */
export function encode(text) {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length);
  if (!version) {
    throw new Error(`Too long for a QR code (${bytes.length} bytes, limit ${maxBytes()})`);
  }

  const data = encodeData(bytes, version);
  const codewords = interleave(data, version);

  // The remainder bits are zero; the layout loop already pads with light
  // modules once it runs out of codewords.
  void remainderBits(version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = buildMatrix(version, codewords, mask);
    const score = penalty(modules);
    if (!best || score < best.score) best = { modules, score, mask };
  }

  return { modules: best.modules, size: best.modules.length, version, mask: best.mask };
}

export function maxBytes() {
  return dataCodewords(MAX_VERSION) - 3; // mode + 16-bit count + terminator
}

/** Dark runs per row, merged so the output stays small. */
function runs(modules) {
  const size = modules.length;
  const out = [];
  for (let y = 0; y < size; y++) {
    let start = -1;
    for (let x = 0; x <= size; x++) {
      const on = x < size && modules[y][x];
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        out.push({ x: start, y, width: x - start });
        start = -1;
      }
    }
  }
  return out;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Renders to an <svg> element.
 *
 * Always dark-on-light regardless of the page theme — an inverted QR is
 * unreadable to a good number of scanners, so this is one place the panel
 * deliberately ignores dark mode.
 */
export function toSvgElement(modules, { quiet = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const size = modules.length;
  const total = size + quiet * 2;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(total));
  bg.setAttribute('height', String(total));
  bg.setAttribute('fill', light);
  svg.append(bg);

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('fill', dark);
  for (const r of runs(modules)) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(r.x + quiet));
    rect.setAttribute('y', String(r.y + quiet));
    rect.setAttribute('width', String(r.width));
    rect.setAttribute('height', '1');
    group.append(rect);
  }
  svg.append(group);
  return svg;
}

/** String form, for tests and anywhere without a DOM. */
export function toSvg(modules, { quiet = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const size = modules.length;
  const total = size + quiet * 2;
  const rects = runs(modules)
    .map((r) => `<rect x="${r.x + quiet}" y="${r.y + quiet}" width="${r.width}" height="1"/>`)
    .join('');
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<g fill="${dark}">${rects}</g></svg>`;
}
