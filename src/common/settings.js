/**
 * Settings live in two places on purpose:
 *   chrome.storage.sync  -> preferences (small, roam between machines)
 *   chrome.storage.local -> API keys, rate cache, response cache
 *
 * API keys are NEVER put in sync storage and never ship in the source.
 */

import { DEFAULT_PROVIDER } from './providers.js';

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
   * 'auto' prefers Chrome's on-device model and falls back to the hosted
   * service, which is what makes the extension useful before anyone has pasted
   * a key.
   *
   * This is *where* an answer comes from. Which hosted service it falls back to
   * is `aiService` below — a separate axis, because "keep my text on this
   * machine" and "I have an OpenAI key rather than a DeepSeek one" are
   * unrelated questions.
   */
  aiProvider: 'auto',

  /** Which hosted service. An id from common/providers.js. */
  aiService: DEFAULT_PROVIDER,

  /**
   * The endpoint, for the providers that have no fixed one — `custom` and a
   * self-hosted Ollama. Empty means "use whatever the registry says".
   */
  aiEndpoint: '',

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
  /**
   * Model id. Empty means the chosen provider's own default, which is what
   * makes switching provider safe — a stored `deepseek-chat` would otherwise
   * follow the user to OpenAI and 404 there.
   */
  model: ''
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

/**
 * API keys, one per provider. Local storage only — background script use.
 *
 * Keyed by provider id rather than kept as a single string, because otherwise
 * trying OpenAI for an afternoon and going back to DeepSeek means pasting a key
 * twice. Storage is cheap; re-finding a key on a provider's dashboard is not.
 */
async function allKeys() {
  const { apiKeys = {}, deepseekApiKey = '' } = await chrome.storage.local.get([
    'apiKeys',
    'deepseekApiKey'
  ]);

  // The pre-registry single key. Read here rather than migrated on install,
  // because an update handler that runs once has no second chance if it throws,
  // and a fold that happens on every read cannot be missed. It is written back
  // under the new shape the first time a key is saved.
  if (deepseekApiKey && !apiKeys.deepseek) {
    return { ...apiKeys, deepseek: deepseekApiKey.trim() };
  }
  return apiKeys;
}

export async function getApiKey(providerId) {
  const id = providerId || (await getSettings()).aiService || DEFAULT_PROVIDER;
  const keys = await allKeys();
  return (keys[id] || '').trim();
}

export async function setApiKey(providerId, key) {
  const id = providerId || (await getSettings()).aiService || DEFAULT_PROVIDER;
  const keys = { ...(await allKeys()), [id]: (key || '').trim() };
  if (!keys[id]) delete keys[id];
  await chrome.storage.local.set({ apiKeys: keys });
  // The old single-key entry is dropped once its value has a home in the new
  // map, so the credential does not sit in two places on disk.
  await chrome.storage.local.remove('deepseekApiKey');
}

/** Which providers currently have a key — for "is anything configured at all". */
export async function configuredProviders() {
  const keys = await allKeys();
  return Object.keys(keys).filter((id) => (keys[id] || '').trim());
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
