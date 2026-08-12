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
  dot: ['M8 7.9h.02']
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
