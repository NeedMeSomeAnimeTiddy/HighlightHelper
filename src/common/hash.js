/**
 * FNV-1a 32-bit. Not cryptographic — it only has to give stable, short keys
 * for the response cache. Length is appended to make collisions unlikely.
 */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + '-' + str.length.toString(36);
}

/** Cache key for an AI call: action + model + options + text. */
export function cacheKey(action, text, options = {}) {
  const parts = Object.keys(options)
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join('&');
  return `${action}|${parts}|${hash(text)}`;
}
