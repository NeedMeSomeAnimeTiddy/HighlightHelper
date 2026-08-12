/**
 * Settings live in two places on purpose:
 *   chrome.storage.sync  -> preferences (small, roam between machines)
 *   chrome.storage.local -> the DeepSeek API key, rate cache, response cache
 *
 * The API key is NEVER put in sync storage and never ships in the source.
 */

export const DEFAULTS = {
  /** ISO 4217 code that currency amounts get converted into. */
  targetCurrency: 'USD',
  /** 'metric' | 'imperial' — the system unit conversions aim for. */
  unitSystem: 'metric',
  /** 'us' | 'uk' — which gallon/pint/fl-oz to use for imperial volumes. */
  imperialFlavor: 'us',
  /** Language translations are produced in (BCP-47-ish tag). */
  language: 'en',

  /**
   * 'auto' | 'local' | 'cloud' — see PROVIDER in constants.js.
   *
   * 'auto' prefers Chrome's on-device model and falls back to DeepSeek, which
   * is what makes the extension useful before anyone has pasted a key.
   */
  aiProvider: 'auto',

  /** Per-detector on/off switches, keyed by detector id. */
  detectors: {
    color: true,
    datetime: true,
    currency: true,
    coords: true,
    calc: true,
    numberbase: true,
    regex: true,
    unit: true,
    code: true,
    decode: true,
    dictionary: true,
    translate: true,
    jargon: true,
    summarize: true,
    rewrite: true,
    qr: true,
    custom: true,
    highlight: true,
    link: true,
    search: true,
    speak: true,
    texttools: true
  },

  /**
   * "Search with…" — which sites are offered, and the list they come from.
   *
   * Empty means "use the defaults in common/searchengines.js". Storing an empty
   * list rather than a copy of the defaults means a later release can add an
   * engine and existing users see it.
   */
  searchEngines: [],
  searchEnabled: ['google', 'ddg', 'wikipedia', 'youtube'],

  /**
   * Tools the user wrote: [{ id, name, prompt }].
   *
   * PopClip's actual model — don't ship 250 actions, ship the ability to write
   * the 251st — and the cheapest possible answer to every "could it also…".
   * Each becomes a menu row and a right-click entry.
   */
  customTools: [],

  /** Whether recent answers are kept for the history list. */
  keepHistory: true,

  /** Master switch + per-origin opt-outs (hostnames). */
  enabled: true,
  disabledSites: [],

  /** Selections at least this long get the rewrite/spellcheck tab. */
  minRewriteChars: 40,
  /** How long AI responses stay cached, in days. */
  cacheDays: 7,
  /** DeepSeek model id. */
  model: 'deepseek-chat'
};

/** Reads settings merged over defaults (nested `detectors` merged too). */
export async function getSettings() {
  let stored = {};
  try {
    ({ settings: stored = {} } = await chrome.storage.sync.get('settings'));
  } catch {
    /* sync unavailable (e.g. not signed in) — fall back to defaults */
  }
  return {
    ...DEFAULTS,
    ...stored,
    detectors: { ...DEFAULTS.detectors, ...(stored.detectors || {}) }
  };
}

/** Shallow-merges `patch` into the stored settings. */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
    detectors: { ...current.detectors, ...(patch.detectors || {}) }
  };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

/** The DeepSeek key. Local storage only — background script use. */
export async function getApiKey() {
  const { deepseekApiKey = '' } = await chrome.storage.local.get('deepseekApiKey');
  return deepseekApiKey.trim();
}

export async function setApiKey(key) {
  await chrome.storage.local.set({ deepseekApiKey: (key || '').trim() });
}

/** Fires `cb(newSettings)` whenever preferences change in any context. */
export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'sync' && changes.settings) cb(await getSettings());
  });
}

/** True when the extension should act on the given hostname. */
export function isEnabledFor(settings, hostname) {
  if (!settings.enabled) return false;
  return !settings.disabledSites.includes(hostname);
}
