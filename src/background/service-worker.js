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
import { CONTEXT_TOOLS } from '../common/tools.js';
import { cacheGet, cacheSet, cacheClear, cacheStats } from './cache.js';
import { cacheKey, hash } from '../common/hash.js';
import { getRates, clearRates } from './rates.js';
import { runAi, testApiKey } from './deepseek.js';

/*
 * Right-click menu.
 *
 * This mirrors the in-page menu so every tool is reachable even when the
 * selection icon never appears — a page that swallows mouse events, a
 * selection made with the keyboard, or a site the extension is switched off
 * for. Chrome builds these once rather than per-selection (there is no
 * "before show" event), so the entries are static and the panel explains it
 * when one does not apply to what you highlighted.
 */

const ROOT = 'hh-root';
const PREFIX = 'hh:';

async function buildContextMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: ROOT,
    title: 'Highlight Helper',
    contexts: ['selection']
  });

  let separator = 0;
  for (const item of CONTEXT_TOOLS) {
    if (item.type === 'separator') {
      chrome.contextMenus.create({
        id: `${ROOT}-sep-${separator++}`,
        parentId: ROOT,
        type: 'separator',
        contexts: ['selection']
      });
      continue;
    }

    chrome.contextMenus.create({
      // A grouping row has no tool of its own; prefixing it would make it look
      // clickable to onClicked, which only acts on ids carrying the prefix.
      id: (item.grouping ? 'hh-group-' : PREFIX) + item.id,
      parentId: ROOT,
      title: item.title,
      contexts: ['selection']
    });

    if (item.children === 'languages') {
      for (const code of CONTEXT_MENU_LANGUAGES) {
        chrome.contextMenus.create({
          id: `${PREFIX}translate@${code}`,
          parentId: PREFIX + item.id,
          title: languageName(code),
          contexts: ['selection']
        });
      }
    } else if (Array.isArray(item.children)) {
      for (const child of item.children) {
        chrome.contextMenus.create({
          id: PREFIX + child.id,
          parentId: (item.grouping ? 'hh-group-' : PREFIX) + item.id,
          title: child.title,
          contexts: ['selection']
        });
      }
    }
  }
}

/**
 * Context menus live in the browser profile, not in this file — they survive
 * until something removes them. Rebuilding only on install/startup means a
 * changed menu can stay stale indefinitely: the previous version's entries
 * simply persist, which looks exactly like the new code never shipped.
 *
 * So the current menu is fingerprinted and the fingerprint stored. Every time
 * the worker wakes it compares, and rebuilds when they differ — one storage
 * read in the common case, and no way for the menu to drift from the code.
 */
const MENU_SIGNATURE = hash(JSON.stringify([CONTEXT_TOOLS, CONTEXT_MENU_LANGUAGES]));

async function ensureContextMenus({ force = false } = {}) {
  try {
    if (!force) {
      const { menuSignature } = await chrome.storage.local.get('menuSignature');
      if (menuSignature === MENU_SIGNATURE) return;
    }
    await buildContextMenus();
    await chrome.storage.local.set({ menuSignature: MENU_SIGNATURE });
  } catch (err) {
    console.error('[Highlight Helper] could not build the context menu:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => ensureContextMenus({ force: true }));
chrome.runtime.onStartup.addListener(() => ensureContextMenus({ force: true }));

// Also on every worker start, so a stale menu heals itself without a reload.
ensureContextMenus();

/**
 * Delivers a message to the page, injecting the content script first if it
 * isn't there. The context-menu click grants activeTab, which is what makes
 * the injection permissible; re-running the loader on a frame that already has
 * it is harmless, because the ES module cache means main.js evaluates once.
 *
 * Some targets can never be reached — the PDF viewer, chrome:// pages, the Web
 * Store — and that is reported rather than retried.
 */
async function deliver(tabId, frameId, message) {
  const target = frameId != null ? { frameId } : undefined;
  try {
    return await chrome.tabs.sendMessage(tabId, message, target);
  } catch {
    /* no receiver yet — fall through and inject */
  }

  try {
    await chrome.scripting.executeScript({
      target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
      files: ['src/content/loader.js']
    });
    // The loader imports main.js asynchronously; give it a moment to listen.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return await chrome.tabs.sendMessage(tabId, message, target);
  } catch (err) {
    console.warn('[Highlight Helper] cannot reach this page:', err?.message || err);
    return null;
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (!tab?.id || !id.startsWith(PREFIX)) return;

  const raw = id.slice(PREFIX.length);
  const [tool, language] = raw.split('@');

  deliver(tab.id, info.frameId, {
    type: MSG.RUN_TOOL,
    tool,
    language: language || null,
    text: info.selectionText || ''
  });
});

/**
 * panel.css, read here rather than in the page.
 *
 * A content script's own fetch runs against the page's network context, so a
 * site with a restrictive `connect-src` can block it from reading its own
 * extension's files. Fetching in the worker is not subject to any page policy.
 * Held in memory for the life of the worker.
 */
let stylesheetCache = null;

async function readStylesheet() {
  if (stylesheetCache != null) return stylesheetCache;
  try {
    const res = await fetch(chrome.runtime.getURL('src/content/panel.css'));
    stylesheetCache = await res.text();
  } catch (err) {
    console.error('[Highlight Helper] could not read panel.css:', err);
    stylesheetCache = '';
  }
  return stylesheetCache;
}

/** AI call with cache-around. Returns { text, cached }. */
async function handleAi({ action, text, options = {} }) {
  const settings = await getSettings();
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Nothing to send');

  // Anything that changes the answer has to be in the cache key, or a second
  // call with a different target language would be served the first result.
  const usesLanguage = action === AI.TRANSLATE || action === AI.EXPLAIN;
  const usesCodeHint = action === AI.EXPLAIN_CODE || action === AI.COMMENT_CODE;
  const keyOpts = {
    model: options.model || settings.model,
    ...(usesLanguage ? { language: options.language || settings.language } : {}),
    ...(usesCodeHint ? { codeLanguage: options.language || '' } : {})
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

    case MSG.STYLESHEET:
      return { ok: true, css: await readStylesheet() };

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
