/**
 * Saved highlights, in chrome.storage.local.
 *
 * Keyed per origin — `hh:hl:<host>` holds one site's highlights — so opening a
 * page reads only that site's records rather than everything ever saved. A
 * separate index lists the hosts that have any, which is what the library page
 * enumerates without reading every record.
 *
 * `local`, not `sync`, and no server. Sync has a 100 KB quota and would race
 * between machines; a server would mean an account, which is the thing that
 * makes every other tool in this category something you have to trust rather
 * than something you can just run. In common/ for the same reason cache.js is:
 * both the content script and the options page need it, and content scripts can
 * only import what web_accessible_resources lists.
 */

const PREFIX = 'hh:hl:';
const INDEX_KEY = 'hh:hlHosts';

/** Per origin. Past this the oldest go, which is the only fair rule available. */
const MAX_PER_HOST = 500;
/** Across all origins, so one heavily-used site cannot fill the quota alone. */
const MAX_HOSTS = 300;

export const COLORS = [
  { id: 'yellow', name: 'Yellow' },
  { id: 'green', name: 'Green' },
  { id: 'blue', name: 'Blue' },
  { id: 'pink', name: 'Pink' }
];

export const DEFAULT_COLOR = 'yellow';

/**
 * The key a page's highlights live under.
 *
 * The hash is deliberately not part of it and the query string is: `?id=42` is
 * usually a different article, `#section` never is.
 */
export function pageKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return String(url || '');
  }
}

export function hostKey(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function readHosts() {
  const { [INDEX_KEY]: hosts = [] } = await chrome.storage.local.get(INDEX_KEY);
  return Array.isArray(hosts) ? hosts : [];
}

/** Every highlight saved for a hostname, newest last. */
export async function forHost(host) {
  if (!host) return [];
  const key = PREFIX + host;
  const { [key]: list = [] } = await chrome.storage.local.get(key);
  return Array.isArray(list) ? list : [];
}

/** Just the ones belonging to one page. */
export async function forPage(url) {
  const page = pageKey(url);
  return (await forHost(hostKey(url))).filter((h) => h.url === page);
}

async function writeHost(host, list) {
  const key = PREFIX + host;

  if (!list.length) {
    await chrome.storage.local.remove(key);
    await chrome.storage.local.set({ [INDEX_KEY]: (await readHosts()).filter((h) => h !== host) });
    return;
  }

  // Oldest-first eviction, same rule the response cache uses.
  const trimmed = list.length > MAX_PER_HOST ? list.slice(-MAX_PER_HOST) : list;
  await chrome.storage.local.set({ [key]: trimmed });

  const hosts = await readHosts();
  if (!hosts.includes(host)) {
    hosts.push(host);
    if (hosts.length > MAX_HOSTS) {
      const dropped = hosts.splice(0, hosts.length - MAX_HOSTS);
      await chrome.storage.local.remove(dropped.map((h) => PREFIX + h));
    }
    await chrome.storage.local.set({ [INDEX_KEY]: hosts });
  }
}

/** Short, sortable, and unique enough for something scoped to one hostname. */
function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Saves one highlight and returns the stored record.
 *
 * The same text highlighted twice on the same page updates the first rather
 * than stacking a second identical record underneath it, which would paint the
 * same range twice and appear twice in the library.
 */
export async function save({ url, title, text, prefix = '', suffix = '', color = DEFAULT_COLOR, note = '' }) {
  const host = hostKey(url);
  if (!host || !text?.trim()) return null;

  const page = pageKey(url);
  const list = await forHost(host);
  const existing = list.find((h) => h.url === page && h.text === text);

  if (existing) {
    existing.color = color;
    if (note) existing.note = note;
    await writeHost(host, list);
    return existing;
  }

  const record = {
    id: newId(),
    url: page,
    title: title || page,
    text,
    prefix,
    suffix,
    color,
    note,
    createdAt: Date.now()
  };

  list.push(record);
  await writeHost(host, list);
  return record;
}

export async function update(url, id, patch) {
  const host = hostKey(url);
  const list = await forHost(host);
  const record = list.find((h) => h.id === id);
  if (!record) return null;
  Object.assign(record, patch);
  await writeHost(host, list);
  return record;
}

export async function remove(url, id) {
  const host = hostKey(url);
  const list = await forHost(host);
  const next = list.filter((h) => h.id !== id);
  if (next.length === list.length) return false;
  await writeHost(host, next);
  return true;
}

/** Everything, grouped by host — the library page's one read. */
export async function all() {
  const hosts = await readHosts();
  if (!hosts.length) return [];
  const keys = hosts.map((h) => PREFIX + h);
  const stored = await chrome.storage.local.get(keys);
  return hosts
    .map((host) => ({ host, items: Array.isArray(stored[PREFIX + host]) ? stored[PREFIX + host] : [] }))
    .filter((group) => group.items.length);
}

export async function clearAll() {
  const hosts = await readHosts();
  if (hosts.length) await chrome.storage.local.remove(hosts.map((h) => PREFIX + h));
  await chrome.storage.local.set({ [INDEX_KEY]: [] });
  return hosts.length;
}

export async function stats() {
  const groups = await all();
  return {
    sites: groups.length,
    items: groups.reduce((n, g) => n + g.items.length, 0)
  };
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/** Markdown needs its own control characters escaped, or a note reformats itself. */
function escapeMd(s) {
  return String(s || '').replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

/**
 * The whole library as Markdown, grouped by page.
 *
 * Quoted text as a blockquote, notes underneath, and every group headed by a
 * real link back to where it came from — the point of exporting is to be able
 * to return to the source, so a highlight that lost its URL would be a quote
 * with no provenance.
 */
export function toMarkdown(groups) {
  const lines = ['# Highlights', ''];

  for (const group of groups) {
    const byPage = new Map();
    for (const item of group.items) {
      if (!byPage.has(item.url)) byPage.set(item.url, []);
      byPage.get(item.url).push(item);
    }

    for (const [url, items] of byPage) {
      lines.push(`## [${escapeMd(items[0].title || url)}](${url})`, '');
      for (const item of items.slice().sort((a, b) => a.createdAt - b.createdAt)) {
        lines.push(`> ${item.text.replace(/\n/g, '\n> ')}`, '');
        if (item.note) lines.push(`${escapeMd(item.note)}`, '');
      }
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}
