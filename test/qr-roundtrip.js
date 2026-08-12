/**
 * Decodes a matrix produced by src/content/qr.js back to its original text.
 *
 * Written against the ISO/IEC 18004 layout description rather than by mirroring
 * the encoder's own code, so a mis-ordered zig-zag or a mis-applied mask shows
 * up as a failed round trip rather than cancelling itself out. It shares only
 * the function-module map, whose positions are checked separately by the
 * structural assertions in detectors.test.js.
 *
 * What this does NOT prove: that the layout matches the specification. A
 * layout that is wrong in a self-consistent way would still round-trip. The
 * Reed-Solomon syndrome check below is the independent part — it verifies the
 * error-correction codewords are genuinely valid for the data, against the
 * published generator polynomial.
 */

import { functionModules, MASKS, EC_BLOCKS, gfMul } from '../src/content/qr.js';

/** Reads the interleaved codeword stream out of a matrix. */
function readCodewords(modules, version, mask) {
  const { reserved } = functionModules(version);
  const size = modules.length;
  const bits = [];

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        let bit = modules[y][x];
        if (MASKS[mask](x, y)) bit = !bit;
        bits.push(bit ? 1 : 0);
      }
    }
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    bytes.push(b);
  }
  return bytes;
}

/** Undoes the block interleave, returning [{ data, ec }] per block. */
function deinterleave(codewords, version) {
  const [ecPerBlock, g1, d1, g2, d2] = EC_BLOCKS[version];
  const sizes = [
    ...Array.from({ length: g1 }, () => d1),
    ...Array.from({ length: g2 }, () => d2)
  ];
  const blocks = sizes.map(() => []);
  const maxData = Math.max(...sizes);

  let p = 0;
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < sizes.length; b++) {
      if (i < sizes[b]) blocks[b].push(codewords[p++]);
    }
  }

  const ec = sizes.map(() => []);
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < sizes.length; b++) ec[b].push(codewords[p++]);
  }

  return blocks.map((data, i) => ({ data, ec: ec[i] }));
}

/**
 * Reed-Solomon syndromes. All zero means the codeword block is valid — the
 * independent check that the EC bytes really do correspond to the data bytes.
 */
function syndromesZero(block, ecCount) {
  const full = [...block.data, ...block.ec];
  const EXP = [];
  let x = 1;
  for (let i = 0; i < 256; i++) { EXP.push(x); x <<= 1; if (x & 0x100) x ^= 0x11d; }

  for (let i = 0; i < ecCount; i++) {
    let acc = 0;
    for (const coef of full) acc = gfMul(acc, EXP[i]) ^ coef;
    if (acc !== 0) return false;
  }
  return true;
}

/** Reads the byte-mode payload out of the concatenated data codewords. */
function readPayload(blocks, version) {
  const data = blocks.flatMap((b) => b.data);
  const bits = [];
  for (const byte of data) for (let k = 7; k >= 0; k--) bits.push((byte >>> k) & 1);

  let p = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bits[p++];
    return v;
  };

  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`expected byte mode, got ${mode.toString(2)}`);
  const length = take(version <= 9 ? 8 : 16);

  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = take(8);
  return new TextDecoder().decode(out);
}

/**
 * Full round trip. Returns { text, blocksValid } — `text` is what a scanner
 * would read, `blocksValid` is true when every block's syndromes are zero.
 */
export function decode({ modules, version, mask }) {
  const codewords = readCodewords(modules, version, mask);
  const blocks = deinterleave(codewords, version);
  const ecPerBlock = EC_BLOCKS[version][0];
  const blocksValid = blocks.every((b) => syndromesZero(b, ecPerBlock));
  return { text: readPayload(blocks, version), blocksValid };
}
