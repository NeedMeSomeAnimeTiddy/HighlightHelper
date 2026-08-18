/**
 * Background service worker.
 *
 * Owns everything that touches the network or a secret: model calls,
 * exchange rates, the response cache, and the "Translate to…" context menu.
 * Content scripts only ever send messages here.
 */

import { MSG, AI, PORT } from '../common/constants.js';
import { getSettings, getApiKey, onSettingsChanged } from '../common/settings.js';
import { CONTEXT_MENU_LANGUAGES, languageName } from '../common/languages.js';
import { CONTEXT_TOOLS } from '../common/tools.js';
import { cacheGet, cacheSet, cacheClear, cacheStats } from '../common/cache.js';
import { cacheKey, hash } from '../common/hash.js';
import { resolveProvider } from '../common/providers.js';
import { getRates, clearRates } from './rates.js';
import { runAi, runAiStream, runChat, testApiKey } from './ai.js';
import { readHistory, remember as rememberRaw, clearHistory } from '../common/history.js';
import { lookup, searchLinks, wikiLang } from './wikipedia.js';
import { define, synonyms, dictionaryLinks, wiktLang } from './dictionary.js';

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

async function buildContextMenus(customTools = []) {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: ROOT,
    title: 'Highlight Helper',
    contexts: ['selection']
  });

  // The user's own tools, above the built-ins: they wrote them, so they are
  // looking for them. Only here — the panel builds its own from settings.
  if (customTools.length) {
    for (const tool of customTools) {
      chrome.contextMenus.create({
        id: `${PREFIX}custom:${tool.id}`,
        parentId: ROOT,
        title: tool.name,
        contexts: ['selection']
      });
    }
    chrome.contextMenus.create({
      id: `${ROOT}-sep-custom`,
      parentId: ROOT,
      type: 'separator',
      contexts: ['selection']
    });
  }

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
 *
 * The user's own tools are part of the fingerprint, which is why it is computed
 * rather than a constant: adding one in settings has to change the menu, and
 * nothing else would notice.
 */
async function menuSignature(customTools) {
  return hash(JSON.stringify([CONTEXT_TOOLS, CONTEXT_MENU_LANGUAGES, customTools]));
}

async function ensureContextMenus({ force = false } = {}) {
  try {
    const settings = await getSettings();
    const customTools = (settings.customTools || []).filter((t) => t?.id && t?.name && t?.prompt);
    const signature = await menuSignature(customTools);

    if (!force) {
      const { menuSignature: stored } = await chrome.storage.local.get('menuSignature');
      if (stored === signature) return;
    }
    await buildContextMenus(customTools);
    await chrome.storage.local.set({ menuSignature: signature });
  } catch (err) {
    console.error('[Highlight Helper] could not build the context menu:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => ensureContextMenus({ force: true }));
chrome.runtime.onStartup.addListener(() => ensureContextMenus({ force: true }));

// Editing a custom tool changes the menu, and the fingerprint above is what
// makes that a no-op when it didn't.
onSettingsChanged(() => ensureContextMenus());

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
 * Keyboard shortcut.
 *
 * The selection icon needs a mouse, and the README already lists the cases
 * where it never appears — a page that swallows mouse events, a selection made
 * with the keyboard. This is the same "open the panel on what's selected" the
 * icon does, with no pointer involved.
 *
 * `menu` is the tool id that means "just run detection", which is exactly what
 * clicking the icon does.
 */
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'open-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  // No selectionText here — a command carries none, so the page reads its own.
  deliver(tab.id, undefined, { type: MSG.RUN_TOOL, tool: 'menu', language: null, text: '' });
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

/**
 * AI call with cache-around. Returns { text, cached }.
 *
 * `onChunk` turns this into the streaming path. The cache is checked first
 * either way — a cached answer arrives whole, and pretending to stream it back
 * one token at a time would be theatre.
 */
async function handleAi({ action, text, options = {} }, onChunk = null) {
  const settings = await getSettings();
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Nothing to send');

  // Anything that changes the answer has to be in the cache key, or a second
  // call with a different target language would be served the first result.
  const usesLanguage = action === AI.TRANSLATE || action === AI.EXPLAIN;
  const usesCodeHint = action === AI.EXPLAIN_CODE || action === AI.COMMENT_CODE;
  // Resolved rather than read raw: `settings.model` is empty when the provider's
  // own default is in use, so two providers would otherwise share one cache
  // entry and the second one asked would be served the first one's answer.
  const chosen = resolveProvider(settings, options);
  const keyOpts = {
    provider: chosen.id,
    model: chosen.model,
    ...(usesLanguage ? { language: options.language || settings.language } : {}),
    ...(usesCodeHint ? { codeLanguage: options.language || '' } : {}),
    // A custom tool's answer depends entirely on its prompt, so two tools
    // pointed at the same selection must not share a cache entry.
    ...(action === AI.CUSTOM ? { tool: hash(options.systemPrompt || '') } : {})
  };
  const key = cacheKey(action, trimmed, keyOpts);
  const ttl = Math.max(0, settings.cacheDays) * 24 * 60 * 60 * 1000;

  const hit = await cacheGet(key, ttl);
  if (hit !== undefined) return { text: hit, cached: true };

  const callOptions = {
    ...options,
    language: options.language || settings.language,
    model: keyOpts.model
  };

  const { text: out } = onChunk
    ? await runAiStream(action, trimmed, callOptions, onChunk)
    : await runAi(action, trimmed, callOptions);

  await cacheSet(key, out);
  await remember({ action, label: options.label, source: trimmed, text: out });
  return { text: out, cached: false };
}

/** History honours its setting here, so no caller has to remember to check. */
async function remember(entry) {
  const settings = await getSettings();
  if (settings.keepHistory === false) return;
  await rememberRaw(entry);
}

/**
 * Streamed answers, over a port.
 *
 * One port per request, closed by the content script when the view goes away —
 * which is also the cancel signal: navigating away or pressing Back while a
 * summary is still arriving should stop it, and disconnecting is the only
 * notification a worker gets that nobody is listening any more.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT.AI) return;

  let alive = true;
  port.onDisconnect.addListener(() => { alive = false; });

  port.onMessage.addListener(async (msg) => {
    const post = (payload) => {
      if (!alive) return;
      try {
        port.postMessage(payload);
      } catch {
        alive = false;
      }
    };

    try {
      const result = msg?.type === MSG.CHAT
        ? await runChat(msg.messages || [], msg.options || {}, (text) => post({ chunk: text }))
        : await handleAi(msg, (text) => post({ chunk: text }));
      post({ done: true, ...result });
    } catch (err) {
      post({ error: String(err?.message || err) });
    }

    /*
     * The port is deliberately *not* closed here.
     *
     * Disconnecting immediately after postMessage races the message: Chrome
     * may drop anything still in flight when a port closes, so the final
     * `done` sometimes never arrived and the page saw nothing but a
     * disconnect — which it correctly, and confusingly, reported as "the
     * answer stopped partway through". Intermittently, and more often on fast
     * answers, which is the worst kind of bug to chase.
     *
     * The content script closes it the moment it has the result. That side
     * knows it received everything; this one only knows it sent it.
     */
  });
});

async function handle(msg) {
  switch (msg?.type) {
    case MSG.AI:
      return { ok: true, ...(await handleAi(msg)) };

    case MSG.CHAT: {
      const result = await runChat(msg.messages || [], msg.options || {});
      return { ok: true, ...result };
    }

    case MSG.HISTORY:
      return { ok: true, entries: await readHistory() };

    case MSG.CLEAR_HISTORY:
      return { ok: true, cleared: await clearHistory() };

    case MSG.RATES: {
      const settings = await getSettings();
      const data = await getRates(msg.base || settings.targetCurrency);
      return { ok: true, ...data };
    }

    case MSG.TEST_KEY:
      // The provider travels with the request: the options page tests what is
      // in the form, which may be a service the user has selected but not yet
      // saved.
      return testApiKey(msg.key, {
        providerId: msg.providerId,
        endpoint: msg.endpoint,
        model: msg.model
      });

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

    case MSG.SOURCE: {
      const settings = await getSettings();
      const term = String(msg.term || '').trim();
      if (!term) return { ok: false, error: 'Nothing to look up' };

      const lang = wikiLang(msg.language || settings.language);
      const context = String(msg.context || '');
      // The context changes the ranking, so it belongs in the key.
      const key = `wiki|${lang}|${hash(`${term.toLowerCase()}|${context}`)}`;
      const ttl = 7 * 24 * 60 * 60 * 1000;

      const hit = await cacheGet(key, ttl);
      if (hit !== undefined) {
        return { ok: true, articles: hit, cached: true, links: searchLinks(term, lang) };
      }

      // A definite answer is cached either way — a term with no article still
      // has none tomorrow. A transport failure is not cached, or one rate-limit
      // would leave this term answering "no source" for a week.
      const articles = await lookup(term, lang, context);
      await cacheSet(key, articles);
      return { ok: true, articles, cached: false, links: searchLinks(term, lang) };
    }

    case MSG.DEFINE: {
      const settings = await getSettings();
      const word = String(msg.word || '').trim();
      if (!word) return { ok: false, error: 'Nothing to look up' };

      const lang = wiktLang(msg.language || settings.language);
      const key = `dict|${lang}|${hash(word.toLowerCase())}`;
      const ttl = 7 * 24 * 60 * 60 * 1000;

      const hit = await cacheGet(key, ttl);
      if (hit !== undefined) {
        return { ok: true, ...hit, cached: true, links: dictionaryLinks(word, lang) };
      }

      // A word with no entry today has none tomorrow, so that answer is cached
      // too. A transport failure is not — see the same reasoning under SOURCE.
      const result = await define(word, lang);
      await cacheSet(key, result);
      return { ok: true, ...result, cached: false, links: dictionaryLinks(word, lang) };
    }

    case MSG.SYNONYMS: {
      const settings = await getSettings();
      const word = String(msg.word || '').trim();
      if (!word) return { ok: false, error: 'Nothing to look up' };

      const lang = wiktLang(msg.language || settings.language);
      const key = `syn|${lang}|${hash(word.toLowerCase())}`;
      const ttl = 7 * 24 * 60 * 60 * 1000;

      const hit = await cacheGet(key, ttl);
      if (hit !== undefined) return { ok: true, words: hit, cached: true };

      const words = await synonyms(word, lang);
      await cacheSet(key, words);
      return { ok: true, words, cached: false };
    }

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
