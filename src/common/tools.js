/**
 * The right-click menu tree.
 *
 * Every `id` here is also a menu-row `key` in the panel, so a context-menu
 * click is just "open the panel and drill straight to this row". The two lists
 * are checked against each other in test/detectors.test.js, which is what stops
 * them drifting apart — this file deliberately does not import the detectors,
 * so the service worker stays free of content-script code.
 *
 * Every tool is here, including the pattern-matched ones. Chrome builds these
 * once rather than per-selection, so a "Calculate" entry is present even when
 * you highlighted a sentence — but a menu that is missing the entry you want at
 * the moment you want it is worse than one carrying a few that don't apply, and
 * the panel explains when one doesn't.
 */

export const CONTEXT_TOOLS = [
  { id: 'menu', title: 'Open Highlight Helper' },
  { type: 'separator' },

  { id: 'explain', title: 'Explain this' },
  { id: 'translate', title: 'Translate to…', children: 'languages' },

  { type: 'separator' },

  { id: 'summarize', title: 'Summarise' },
  { id: 'keypoints', title: 'Key points' },
  {
    id: 'rewrite',
    title: 'Rewrite',
    children: [
      { id: 'rewrite:fix', title: 'Fix spelling & grammar' },
      { id: 'rewrite:shorter', title: 'Make it shorter' },
      { id: 'rewrite:formal', title: 'More formal' },
      { id: 'rewrite:casual', title: 'More casual' },
      { id: 'rewrite:continue', title: 'Continue writing' }
    ]
  },

  { type: 'separator' },

  {
    id: 'convert',
    title: 'Convert & decode',
    // A grouping row, not a tool: `convert` is never a menu-row key, so the
    // panel never receives it — only its children are clickable.
    grouping: true,
    children: [
      { id: 'calc', title: 'Calculate' },
      { id: 'currency', title: 'Convert currency' },
      { id: 'unit', title: 'Convert units' },
      { id: 'datetime', title: 'Date & time' },
      { id: 'coords', title: 'Coordinates' },
      { id: 'color', title: 'Colour' },
      { id: 'numberbase', title: 'Number base' },
      { id: 'regex', title: 'Explain this regex' },
      { id: 'decode', title: 'Decode (JWT, base64, JSON)' }
    ]
  },

  { type: 'separator' },

  { id: 'code', title: 'Explain this code' },
  { id: 'code:comment', title: 'Add comments to this code' },
  {
    id: 'texttools',
    title: 'Text tools',
    children: [
      { id: 'texttools:count', title: 'Count words & characters' },
      { id: 'texttools:upper', title: 'UPPERCASE' },
      { id: 'texttools:lower', title: 'lowercase' },
      { id: 'texttools:title', title: 'Title Case' },
      { id: 'texttools:sentence', title: 'Sentence case' },
      { id: 'texttools:camel', title: 'camelCase' },
      { id: 'texttools:pascal', title: 'PascalCase' },
      { id: 'texttools:snake', title: 'snake_case' },
      { id: 'texttools:kebab', title: 'kebab-case' },
      { id: 'texttools:slug', title: 'URL slug' },
      { id: 'texttools:strip', title: 'Collapse whitespace' }
    ]
  },
  { id: 'qr', title: 'QR code' }
];

/**
 * Why a tool might not be available for the current selection. Shown at the
 * top of the panel when a right-click asks for something that does not apply,
 * so the answer is a reason rather than a silently missing row.
 */
export const TOOL_HINTS = {
  calc: "That doesn't parse as an arithmetic expression. Try \"12 * 8 + 3\" or \"15% of 240\".",
  currency: 'No currency amount found — an amount needs a symbol or a code, like "$50" or "30 EUR".',
  unit: 'No measurement found in that selection.',
  datetime: 'Dates are read as Unix timestamps or ISO 8601, like 1700000000 or 2024-03-15.',
  coords: 'No coordinates found — try "37.7749, -122.4194" or a degrees/minutes/seconds pair.',
  color: 'No colour found — #hex, rgb() and hsl() are recognised; colour names are not.',
  numberbase: 'No number to convert — try 0x1F4, 0b1011, or a whole number over 255.',
  regex: 'That doesn\'t look like a regular expression. Wrapping it in /…/ makes it unambiguous.',
  decode: 'Nothing to decode — this reads JWTs, base64, percent-encoding and JSON.',
  explain: 'Explain works on a term or short phrase — up to four words.',
  translate: 'Translation needs some actual text.',
  summarize: 'Summarising needs a paragraph or more.',
  keypoints: 'Key points needs a paragraph or more.',
  rewrite: 'Rewriting needs at least five words of prose, and does not apply to code.',
  code: "That selection doesn't look like code.",
  texttools: 'Text tools needs a few characters of text.',
  qr: "That selection is too long, or isn't the kind of thing worth scanning."
};

/** 'rewrite:fix' -> 'rewrite'. Used to look up a hint for a submenu item. */
export function toolFamily(id) {
  return String(id).split(':')[0];
}

/**
 * Which detector owns a tool. Mostly the family name, but a few rows live in a
 * detector called something else — "Explain this" is the jargon detector, and
 * both summary rows come from `summarize`.
 */
const OWNER = {
  explain: 'jargon',
  keypoints: 'summarize'
};

export function detectorForTool(id) {
  const family = toolFamily(id);
  return OWNER[family] || family;
}
