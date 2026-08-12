/**
 * The right-click menu tree.
 *
 * Every `id` here is also a menu-row `key` in the panel, so a context-menu
 * click is just "open the panel and drill straight to this row". The two lists
 * are checked against each other in test/detectors.test.js, which is what stops
 * them drifting apart — this file deliberately does not import the detectors,
 * so the service worker stays free of content-script code.
 *
 * Only tools that work on *any* text get their own entry. The pattern-matched
 * ones (colour, dates, currency, units, coordinates, regex, bases, decoding)
 * are reached through "Open Highlight Helper", which runs detection properly
 * and would otherwise fill the menu with entries that usually say "not found".
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
