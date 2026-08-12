/**
 * Background service worker.
 *
 * Owns everything that touches the network or a secret: DeepSeek calls,
 * exchange rates, the response cache, and the "Translate to…" context menu.
 * Content scripts only ever send messages here.
 */

import { MSG, AI } from '../common/constants.js';
import { getSettings, getApiKey } from '../common/settings.js';
import { CONTEXT_MENU_LANGUAGES, languageName } from '../common/languages.js';
import { cacheGet, cacheSet, cacheClear, cacheStats } from './cache.js';
import { cacheKey } from '../common/hash.js';
import { getRates, clearRates } from './rates.js';
import { runAi, testApiKey } from './deepseek.js';

const MENU_PARENT = 'hh-translate-to';

async function buildContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_PARENT,
    title: 'Translate to…',
    contexts: ['selection']
  });
  for (const code of CONTEXT_MENU_LANGUAGES) {
    chrome.contextMenus.create({
      id: `${MENU_PARENT}:${code}`,
      parentId: MENU_PARENT,
      title: languageName(code),
      contexts: ['selection']
    });
  }
}

chrome.runtime.onInstalled.addListener(buildContextMenus);
chrome.runtime.onStartup.addListener(buildContextMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !String(info.menuItemId).startsWith(`${MENU_PARENT}:`)) return;
  const language = String(info.menuItemId).slice(MENU_PARENT.length + 1);
  chrome.tabs
    .sendMessage(
      tab.id,
      {
        type: MSG.TRANSLATE_SELECTION,
        language,
        text: info.selectionText || ''
      },
      info.frameId != null ? { frameId: info.frameId } : undefined
    )
    .catch(() => {
      // No content script in that frame (e.g. a PDF viewer or the web store).
    });
});

/** AI call with cache-around. Returns { text, cached }. */
async function handleAi({ action, text, options = {} }) {
  const settings = await getSettings();
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Nothing to send');

  const keyOpts = {
    model: options.model || settings.model,
    ...(action === AI.TRANSLATE || action === AI.EXPLAIN
      ? { language: options.language || settings.language }
      : {})
  };
  const key = cacheKey(action, trimmed, keyOpts);
  const ttl = Math.max(0, settings.cacheDays) * 24 * 60 * 60 * 1000;

  const hit = await cacheGet(key, ttl);
  if (hit !== undefined) return { text: hit, cached: true };

  const { text: out } = await runAi(action, trimmed, {
    ...options,
    language: options.language || settings.language,
    model: keyOpts.model
  });
  await cacheSet(key, out);
  return { text: out, cached: false };
}

async function handle(msg) {
  switch (msg?.type) {
    case MSG.AI:
      return { ok: true, ...(await handleAi(msg)) };

    case MSG.RATES: {
      const settings = await getSettings();
      const data = await getRates(msg.base || settings.targetCurrency);
      return { ok: true, ...data };
    }

    case MSG.TEST_KEY:
      return testApiKey(msg.key);

    case MSG.CLEAR_CACHE: {
      const responses = await cacheClear();
      const rates = await clearRates();
      return { ok: true, responses, rates };
    }

    case MSG.CACHE_STATS: {
      const stats = await cacheStats();
      return { ok: true, ...stats, hasKey: Boolean(await getApiKey()) };
    }

    case MSG.OPEN_OPTIONS:
      chrome.runtime.openOptionsPage();
      return { ok: true };

    default:
      return { ok: false, error: `Unknown message: ${msg?.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // keep the channel open for the async response
});
