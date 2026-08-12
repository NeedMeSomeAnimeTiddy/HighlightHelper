/**
 * A tiny TTL + LRU cache on top of chrome.storage.local.
 *
 * DeepSeek calls cost money, so every AI response is cached by
 * hash(action + options + text). Repeating a selection is free.
 */

const PREFIX = 'hh:c:';
const INDEX_KEY = 'hh:cacheIndex';
const MAX_ENTRIES = 400;

async function readIndex() {
  const { [INDEX_KEY]: idx = [] } = await chrome.storage.local.get(INDEX_KEY);
  return Array.isArray(idx) ? idx : [];
}

/** Returns the cached value, or undefined if missing/expired. */
export async function cacheGet(key, ttlMs) {
  const k = PREFIX + key;
  const { [k]: rec } = await chrome.storage.local.get(k);
  if (!rec) return undefined;
  if (ttlMs > 0 && Date.now() - rec.t > ttlMs) {
    await chrome.storage.local.remove(k);
    return undefined;
  }
  return rec.v;
}

/** Stores a value and prunes the oldest entries once over MAX_ENTRIES. */
export async function cacheSet(key, value) {
  const k = PREFIX + key;
  await chrome.storage.local.set({ [k]: { v: value, t: Date.now() } });

  const idx = (await readIndex()).filter((x) => x !== k);
  idx.push(k);

  if (idx.length > MAX_ENTRIES) {
    const drop = idx.splice(0, idx.length - MAX_ENTRIES);
    await chrome.storage.local.remove(drop);
  }
  await chrome.storage.local.set({ [INDEX_KEY]: idx });
}

/** Wipes every cached AI response (rate cache is handled separately). */
export async function cacheClear() {
  const idx = await readIndex();
  if (idx.length) await chrome.storage.local.remove(idx);
  await chrome.storage.local.set({ [INDEX_KEY]: [] });
  return idx.length;
}

export async function cacheStats() {
  const idx = await readIndex();
  return { entries: idx.length, max: MAX_ENTRIES };
}
