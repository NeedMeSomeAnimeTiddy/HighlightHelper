/**
 * Monochrome 16×16 line glyphs, built as SVG elements.
 *
 * Deliberately not emoji: emoji render with a different metric, weight and
 * colour on every OS, which would fight the palette. These inherit
 * `currentColor` and the panel's stroke weight instead.
 */

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  // ⇄ two arrows swapping — currency
  currency: [
    'M2.8 5.5h9.4M9.7 3 12.2 5.5 9.7 8',
    'M13.2 10.5H3.8M6.3 8 3.8 10.5 6.3 13'
  ],
  // a ruler with ticks — units
  unit: [
    'M1.6 6.2h12.8v3.6H1.6z',
    'M4.4 6.2v1.7M7 6.2v2.4M9.6 6.2v1.7M12.2 6.2v2.4'
  ],
  // four-point sparkle — explain
  explain: ['M8 1.9 9.5 6.2 13.8 7.7 9.5 9.2 8 13.5 6.5 9.2 2.2 7.7 6.5 6.2z'],
  // globe — translate
  translate: [
    'M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6z',
    'M1.6 8h12.8',
    'M8 1.6c1.7 2 2.6 4.1 2.6 6.4S9.7 12.4 8 14.4C6.3 12.4 5.4 10.3 5.4 8S6.3 3.6 8 1.6z'
  ],
  // pencil — rewrite
  rewrite: [
    'M2.7 13.3 3.3 10.5l7.3-7.3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7l-7.3 7.3z',
    'M10.1 3.7l2.2 2.2'
  ],
  // tick — fix grammar
  fix: ['M2.8 8.4 6.3 11.9 13.2 4.4'],
  // arrows drawn inward — shorter
  shorter: [
    'M13.4 2.6 9.6 6.4M9.6 6.4V3.2M9.6 6.4h3.2',
    'M2.6 13.4 6.4 9.6M6.4 9.6v3.2M6.4 9.6H3.2'
  ],
  // ruled document — formal
  formal: [
    'M9.2 1.7H4.6a1 1 0 0 0-1 1v10.6a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V4.5z',
    'M9.2 1.7v2.8h3.2M6 8.4h4M6 10.9h4'
  ],
  // speech bubble — casual
  casual: ['M13.4 9.6a1.5 1.5 0 0 1-1.5 1.5H6.1l-3.5 2.6V4a1.5 1.5 0 0 1 1.5-1.5h7.8A1.5 1.5 0 0 1 13.4 4z'],

  // clock — dates and timestamps
  clock: [
    'M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6z',
    'M8 4.3V8.2l2.7 1.6'
  ],
  // droplet — colours
  color: ['M8 1.7s4.5 4.4 4.5 7a4.5 4.5 0 0 1-9 0c0-2.6 4.5-7 4.5-7z'],
  // calculator — arithmetic
  calc: [
    'M4.2 1.8h7.6a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z',
    'M5.6 4.6h4.8',
    'M5.8 8h.02M8 8h.02M10.2 8h.02M5.8 10.8h.02M8 10.8h.02M10.2 10.8h.02'
  ],
  // hash — number bases
  base: ['M6.2 2.5 5 13.5M11 2.5 9.8 13.5M2.7 5.9h10.6M2.4 10.1h10.6'],
  // braces — encoded payloads
  decode: [
    'M6.3 2.5c-1.6 0-1.6 1.5-1.6 3.1S3.9 7.9 3.1 7.9c.8 0 1.6.7 1.6 2.3s0 3.3 1.6 3.3',
    'M9.7 2.5c1.6 0 1.6 1.5 1.6 3.1s.8 2.3 1.6 2.3c-.8 0-1.6.7-1.6 2.3s0 3.3-1.6 3.3'
  ],
  // T — text transforms
  text: ['M3.2 3.7h9.6M8 3.7v8.6M5.9 12.3h4.2'],
  // shrinking rules — summarise
  summarize: ['M3 4.4h10M3 8h10M3 11.6h6'],
  // bulleted list — key points
  list: ['M4 4.4h.02M4 8h.02M4 11.6h.02', 'M7 4.4h6M7 8h6M7 11.6h6'],

  // brackets around an asterisk — regular expressions
  regex: [
    'M5.6 2.8H3.3v10.4h2.3M10.4 2.8h2.3v10.4h-2.3',
    'M8 5.9v4.2M6.2 6.9l3.6 2.2M9.8 6.9 6.2 9.1'
  ],
  // three finder squares — QR codes
  qr: [
    'M2.6 2.6h3.6v3.6H2.6zM9.8 2.6h3.6v3.6H9.8zM2.6 9.8h3.6v3.6H2.6z',
    'M9.8 9.8h1.5v1.5H9.8zM11.9 11.9h1.5v1.5h-1.5z'
  ],
  // map pin — coordinates
  pin: [
    'M8 1.9c2.3 0 4.2 1.9 4.2 4.2 0 3.1-4.2 7.9-4.2 7.9S3.8 9.2 3.8 6.1C3.8 3.8 5.7 1.9 8 1.9z',
    'M8 7.7a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z'
  ],
  // angle brackets — source code
  code: ['M5.7 4.3 2.2 8l3.5 3.7M10.3 4.3 13.8 8l-3.5 3.7', 'M9.4 2.7 6.6 13.3'],
  // speech bubble with a plus — add comments
  comment: [
    'M13.4 9.2a1.5 1.5 0 0 1-1.5 1.5H6.3l-3.7 2.7V4a1.5 1.5 0 0 1 1.5-1.5h7.8A1.5 1.5 0 0 1 13.4 4z',
    'M8 5.1v3.2M6.4 6.7h3.2'
  ],
  // arrow running into a wall — continue writing
  continue: ['M2.6 8h8.3M8.1 4.9 11.2 8l-3.1 3.1', 'M13.4 3.7v8.6'],

  // open book — an external reference
  source: [
    'M8 4.4S6.6 3.1 4 3.1c-.9 0-1.4.1-1.4.1v9.5s.5-.1 1.4-.1c2.6 0 4 1.3 4 1.3s1.4-1.3 4-1.3c.9 0 1.4.1 1.4.1V3.2s-.5-.1-1.4-.1c-2.6 0-4 1.3-4 1.3z',
    'M8 4.4v9.5'
  ],

  chevronRight: ['M6.2 3.6 10.6 8l-4.4 4.4'],
  chevronLeft: ['M9.8 3.6 5.4 8l4.4 4.4'],
  copy: [
    'M6 5.4h6.6a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.4a1 1 0 0 1 1-1z',
    'M3 10.6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.6a1 1 0 0 1 1 1v.4'
  ],
  replace: ['M3 5.4h8.2M8.8 3 11.2 5.4 8.8 7.8', 'M13 10.6H4.8M7.2 8.2 4.8 10.6l2.4 2.4'],
  check: ['M3.2 8.4 6.4 11.6 12.8 4.8'],
  warn: [
    'M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6z',
    'M8 4.9v3.9M8 11.2h.01'
  ],
  dot: ['M8 7.9h.02'],
  // magnifier — search with…
  search: ['M7.1 2.6a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', 'M10.4 10.4l3 3'],
  // two chain links — copy link to highlight
  link: [
    'M6.6 9.4a2.6 2.6 0 0 1 0-3.7l2-2a2.6 2.6 0 0 1 3.7 3.7l-.9.9',
    'M9.4 6.6a2.6 2.6 0 0 1 0 3.7l-2 2a2.6 2.6 0 0 1-3.7-3.7l.9-.9'
  ],
  // open book — dictionary
  book: [
    'M8 4.3S6.8 3 4.6 3H2.3v8.6h2.6c1.9 0 3.1 1.1 3.1 1.1s1.2-1.1 3.1-1.1h2.6V3h-2.3C9.2 3 8 4.3 8 4.3z',
    'M8 4.3v8.4'
  ],
  // speaker with a wave — read aloud
  speak: [
    'M3.4 6.2h2L8 3.8v8.4L5.4 9.8h-2z',
    'M10.4 6.2a2.6 2.6 0 0 1 0 3.6M12.2 4.4a5.1 5.1 0 0 1 0 7.2'
  ],
  // marker pen over a ruled line — highlight
  highlight: [
    'M4.1 9.7 9.8 4a1.7 1.7 0 0 1 2.4 2.4l-5.7 5.7-3 .6z',
    'M2.6 14.2h10.8'
  ]
};

/** Builds an <svg> glyph. Unknown names fall back to a dot. */
export function glyph(name, className = 'hh-glyph') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of PATHS[name] || PATHS.dot) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** The highlighter mark used for the little on-selection button. */
export function markGlyph() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'hh-mark');

  const nib = document.createElementNS(NS, 'path');
  nib.setAttribute('d', 'M14.2 3.6 20.4 9.8 11.6 18.6H5.4v-6.2z');
  nib.setAttribute('fill', 'var(--hh-mark-fill)');
  nib.setAttribute('stroke', 'currentColor');
  nib.setAttribute('stroke-width', '1.6');
  nib.setAttribute('stroke-linejoin', 'round');

  const rule = document.createElementNS(NS, 'path');
  rule.setAttribute('d', 'M4 21.2h16');
  rule.setAttribute('fill', 'none');
  rule.setAttribute('stroke', 'currentColor');
  rule.setAttribute('stroke-width', '1.8');
  rule.setAttribute('stroke-linecap', 'round');

  svg.append(nib, rule);
  return svg;
}
