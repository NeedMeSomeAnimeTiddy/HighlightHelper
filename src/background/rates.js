/**
 * Exchange rates from open.er-api.com — the keyless endpoint of the
 * exchangerate-api.com family. No signup, no API key.
 *
 * Rates are cached per base currency in chrome.storage.local. The API tells us
 * when it next updates; we honour that, clamped to a 1h..24h window, and
 * default to 6h if the field is missing.
 */

import { ERR } from '../common/constants.js';

const ENDPOINT = 'https://open.er-api.com/v6/latest/';
const MIN_TTL = 60 * 60 * 1000;        // 1 hour
const MAX_TTL = 24 * 60 * 60 * 1000;   // 1 day
const DEFAULT_TTL = 6 * 60 * 60 * 1000;

const inFlight = new Map();

function key(base) {
  return `hh:rates:${base}`;
}

async function fetchRates(base) {
  let res;
  try {
    res = await fetch(ENDPOINT + encodeURIComponent(base), { cache: 'no-store' });
  } catch {
    throw new Error(ERR.OFFLINE);
  }
  if (!res.ok) throw new Error(`Rate service returned ${res.status}`);

  const data = await res.json();
  if (data.result !== 'success' || !data.rates) {
    throw new Error(data['error-type'] || 'Rate service returned no rates');
  }

  let ttl = DEFAULT_TTL;
  if (data.time_next_update_unix) {
    ttl = data.time_next_update_unix * 1000 - Date.now();
  }
  ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, ttl));

  const record = {
    base: data.base_code || base,
    rates: data.rates,
    updated: (data.time_last_update_unix || Math.floor(Date.now() / 1000)) * 1000,
    expires: Date.now() + ttl
  };
  await chrome.storage.local.set({ [key(base)]: record });
  return record;
}

/**
 * Returns { base, rates, updated, expires, stale }. On a network failure we
 * fall back to expired cached rates rather than showing nothing, flagged with
 * `stale: true` so the UI can say so.
 */
export async function getRates(base) {
  const k = key(base);
  const { [k]: cached } = await chrome.storage.local.get(k);

  if (cached && cached.expires > Date.now()) return { ...cached, stale: false };

  if (inFlight.has(base)) return inFlight.get(base);

  const p = fetchRates(base)
    .then((r) => ({ ...r, stale: false }))
    .catch((err) => {
      if (cached) return { ...cached, stale: true };
      throw err;
    })
    .finally(() => inFlight.delete(base));

  inFlight.set(base, p);
  return p;
}

/** Drops every cached rate table. */
export async function clearRates() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('hh:rates:'));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}
