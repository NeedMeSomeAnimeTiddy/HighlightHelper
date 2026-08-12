/**
 * Where a selection can be sent to be looked up elsewhere.
 *
 * This is the largest single category in every tool of this kind — PopClip
 * carries well over a hundred of them — and shipping that many would make the
 * menu worse for everyone who wanted three. So the default list is short and
 * the real answer is that it is editable in settings.
 *
 * `{q}` is replaced with the percent-encoded selection. Nothing here is
 * automatic: a search is a button, because opening one hands the selected text
 * to a third party, and that is the user's call to make each time. It is the
 * same trade the coordinate detector's map buttons already make.
 */

export const DEFAULT_ENGINES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={q}' },
  { id: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search={q}' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query={q}' },
  { id: 'maps', name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/search?query={q}' },
  { id: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org/en-US/search?q={q}' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q={q}' },
  { id: 'stackoverflow', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q={q}' },
  { id: 'scholar', name: 'Google Scholar', url: 'https://scholar.google.com/scholar?q={q}' },
  { id: 'wayback', name: 'Wayback Machine', url: 'https://web.archive.org/web/*/{q}' }
];

/** Which of them are on by default. The rest are one tick away in settings. */
export const DEFAULT_ENABLED = ['google', 'ddg', 'wikipedia', 'youtube'];

/**
 * Fills a template.
 *
 * Returns null for a template with no `{q}` — a URL that ignores the selection
 * is a bookmark, not a search, and silently opening one on a word the user
 * highlighted would be baffling.
 */
export function searchUrlFor(template, query) {
  if (!template || !template.includes('{q}')) return null;
  return template.replace(/\{q\}/g, encodeURIComponent(query));
}

/** Merges the stored list over the defaults, keeping stored edits authoritative. */
export function resolveEngines(settings) {
  const custom = Array.isArray(settings?.searchEngines) ? settings.searchEngines : null;
  const list = custom?.length ? custom : DEFAULT_ENGINES;
  const enabled = Array.isArray(settings?.searchEnabled)
    ? settings.searchEnabled
    : DEFAULT_ENABLED;
  return list.filter((e) => e?.url && enabled.includes(e.id));
}
