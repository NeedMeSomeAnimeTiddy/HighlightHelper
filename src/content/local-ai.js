/**
 * Chrome's built-in AI — Gemini Nano, running on this machine.
 *
 * No key, no network, no cost, and the selection never leaves the computer.
 * That last part is the real reason this exists: "explain this" on a line from
 * a private document should not have to be a request to a company in another
 * country.
 *
 * Four globals, all of them stable in Chrome 138+:
 *
 *   Summarizer        Summarise / Key points
 *   Translator        Translate
 *   LanguageDetector  which language to translate *from*
 *   LanguageModel     everything else, driven by the same prompts DeepSeek gets
 *
 * Writer, Rewriter and Proofreader are deliberately unused. They look like a
 * natural fit for the rewrite tones, but they are still origin-trial and simply
 * absent from a normal browser — the rewrite tones go through LanguageModel
 * with the shared prompt instead, which works today.
 *
 * ---
 *
 * Why this runs in the content script and not the service worker.
 *
 * The only reason network calls live in the worker is that the worker owns the
 * API key. There is no secret here, so that argument doesn't apply — and the
 * Prompt API is unavailable in worker contexts anyway, so the worker could not
 * do it even if we wanted. The alternative is an offscreen document, which buys
 * one central session at the cost of a permission and a lifecycle to babysit.
 * Not worth it for a provider with nothing to hide.
 *
 * ---
 *
 * The contract with main.js: `runLocal` returns null for "I can't serve this
 * one" and throws only when something genuinely broke. Anything unsupported —
 * no model, wrong language pair, selection too long — is a null, so 'auto' can
 * fall through to DeepSeek without treating an ordinary limit as a failure.
 */

import { AI } from '../common/constants.js';
import { buildPrompt, cleanOutput } from '../common/prompts.js';
import { cacheGet, cacheSet } from '../common/cache.js';
import { cacheKey } from '../common/hash.js';

/**
 * Every availability() call is raced against this.
 *
 * Not defensive padding: `Translator.availability()` for a real language pair
 * was measured taking longer than eight seconds on a machine with no language
 * pack installed, apparently while it works out what it would have to fetch.
 * A selection popup cannot wait on that, and a probe that never settles would
 * hang the row rather than falling back.
 */
const PROBE_MS = 1500;

/**
 * The context window is a few thousand tokens, and overflowing it produces a
 * truncated answer rather than an error — the worst failure mode there is.
 * Past this, the selection goes to DeepSeek, which has room for it.
 */
const MAX_MODEL_CHARS = 4000;
const MAX_SUMMARY_CHARS = 12000;

/** Model id recorded in the cache key, so local and cloud answers can't collide. */
const MODEL_ID = 'chrome-builtin';

/** Actions the purpose-built task APIs own. Everything else is LanguageModel. */
const SUMMARY_ACTIONS = new Set([AI.SUMMARIZE, AI.KEYPOINTS]);

const has = (name) => typeof self !== 'undefined' && name in self;

/** True when there is any point calling anything else in this file. */
export function isSupported() {
  return has('LanguageModel') || has('Summarizer');
}

/** 'en-GB' -> 'en'. The task APIs want base codes. */
function baseLang(tag) {
  return String(tag || 'en').split('-')[0].toLowerCase();
}

/**
 * Probe results, memoised for the life of a page.
 *
 * Without this, a browser that has the APIs but not the model pays the full
 * probe timeout on every single AI click before falling through to DeepSeek —
 * which is most of the installed base, and would make the extension feel
 * slower than it was before any of this existed. The answer barely changes
 * within one page view.
 *
 * The TTL exists so that downloading the model doesn't require reloading every
 * open tab before the extension notices.
 */
const probes = new Map();
const PROBE_TTL_MS = 60_000;

/**
 * availability(), but it always settles. Anything other than a definite
 * 'available' is treated as "not now" — including 'downloadable', because
 * calling create() on that starts a multi-gigabyte download, and a panel row
 * is not where a user should discover that. The options page offers it as a
 * button instead.
 */
async function ready(global, args) {
  if (!has(global)) return false;

  const key = `${global}|${args ? JSON.stringify(args) : ''}`;
  const memo = probes.get(key);
  if (memo && Date.now() - memo.at < PROBE_TTL_MS) return memo.value;

  let value = false;
  try {
    const result = await Promise.race([
      args === undefined ? self[global].availability() : self[global].availability(args),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), PROBE_MS))
    ]);
    value = result === 'available';
  } catch {
    // A rejected availability() means unsupported options, not a broken browser.
    value = false;
  }

  probes.set(key, { value, at: Date.now() });
  return value;
}

/* ------------------------------------------------------------------ *
 * The three paths
 * ------------------------------------------------------------------ */

/**
 * Summarise / Key points.
 *
 * `outputLanguage` is deliberately not set. The Summarizer only accepts a short
 * list of languages and throws on the rest, while the shared prompt asks for
 * the summary in the same language as the original — which is what omitting it
 * gets. A hard failure on a French page would be a worse trade than a default.
 */
async function runSummarizer(action, text) {
  if (text.length > MAX_SUMMARY_CHARS) return null;
  if (!(await ready('Summarizer'))) return null;

  const summarizer = await Summarizer.create({
    type: action === AI.KEYPOINTS ? 'key-points' : 'tldr',
    format: 'plain-text',
    length: 'short'
  });

  try {
    const out = await summarizer.summarize(text);
    return action === AI.KEYPOINTS ? bulletsToPanelStyle(out) : cleanOutput(out);
  } finally {
    summarizer.destroy?.();
  }
}

/**
 * The panel renders key points as "• " lines, because that is what the DeepSeek
 * prompt asks for. The Summarizer uses whatever markdown bullet it likes, so
 * normalise rather than letting the same row look different per provider.
 */
export function bulletsToPanelStyle(out) {
  return cleanOutput(out)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `• ${line.replace(/^[-*+•]\s*/, '')}`)
    .join('\n');
}

/**
 * Translate.
 *
 * Needs a source language, which the selection does not carry. The heuristic in
 * detectors/langdetect.js is good enough to decide how prominently to rank the
 * Translate row, but not good enough to pick a translation model — so the real
 * LanguageDetector answers this one, and a low-confidence guess falls through
 * to DeepSeek rather than translating from the wrong language.
 */
async function runTranslator(text, targetTag) {
  const target = baseLang(targetTag);
  const source = await detectLanguage(text);
  if (!source) return null;

  // Already in the target language: nothing to do, and DeepSeek would at least
  // say so. Let it.
  if (source === target) return null;

  if (!(await ready('Translator', { sourceLanguage: source, targetLanguage: target }))) return null;

  const translator = await Translator.create({ sourceLanguage: source, targetLanguage: target });
  try {
    return cleanOutput(await translator.translate(text));
  } finally {
    translator.destroy?.();
  }
}

/** Best-guess source language, or null when it isn't confident enough to use. */
async function detectLanguage(text) {
  if (!(await ready('LanguageDetector'))) return null;
  let detector;
  try {
    detector = await LanguageDetector.create();
    const [best] = await detector.detect(text.slice(0, 1000));
    if (!best || best.confidence < 0.5) return null;
    return baseLang(best.detectedLanguage);
  } catch {
    return null;
  } finally {
    detector?.destroy?.();
  }
}

/**
 * Everything else — explain, the rewrite tones, code, topics.
 *
 * Same prompts as DeepSeek, because a tool should not change its mind about
 * what it is depending on who answered. The system prompt becomes the session's
 * initial prompt and the selection becomes the turn.
 */
async function runModel(action, text, options) {
  if (text.length > MAX_MODEL_CHARS) return null;
  if (!(await ready('LanguageModel'))) return null;

  // Throws ERR.STALE_WORKER for an action with no prompt, which is the right
  // answer here too — a tool newer than the code that has to serve it.
  const prompt = buildPrompt(action, text, options);

  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: prompt.system }],
    // These two are a pair: supplying one without the other is rejected.
    temperature: prompt.temperature,
    topK: 3
  });

  try {
    return cleanOutput(await session.prompt(prompt.user));
  } finally {
    session.destroy?.();
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Runs one action on-device.
 *
 * Returns { text, cached } when it could, null when it could not. Throws only
 * on a real failure — a session that was created and then died.
 */
export async function runLocal(action, text, options = {}, { cacheDays = 7 } = {}) {
  if (!isSupported()) return null;

  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  // `model` differs per provider, so a local answer and a DeepSeek answer for
  // the same selection can never be served to each other.
  const key = cacheKey(action, trimmed, {
    model: MODEL_ID,
    ...(action === AI.TRANSLATE || action === AI.EXPLAIN
      ? { language: options.language || 'en' }
      : {}),
    ...(action === AI.EXPLAIN_CODE || action === AI.COMMENT_CODE
      ? { codeLanguage: options.language || '' }
      : {})
  });
  const ttl = Math.max(0, cacheDays) * 24 * 60 * 60 * 1000;

  const hit = await cacheGet(key, ttl);
  if (hit !== undefined) return { text: hit, cached: true, local: true };

  let out;
  if (SUMMARY_ACTIONS.has(action)) out = await runSummarizer(action, trimmed);
  else if (action === AI.TRANSLATE) out = await runTranslator(trimmed, options.language);
  else out = await runModel(action, trimmed, options);

  // An empty answer is a failed answer. Better to let DeepSeek try than to show
  // a blank panel and call it a result.
  if (!out) return null;

  await cacheSet(key, out);
  return { text: out, cached: false, local: true };
}

/* ------------------------------------------------------------------ *
 * For the options page
 * ------------------------------------------------------------------ */

/**
 * What this machine can actually do, for the "Where AI runs" card.
 *
 * Reports the raw availability string rather than a boolean, because
 * 'downloadable' and 'unavailable' need completely different things said about
 * them: one is a button, the other is bad news about the hardware.
 */
export async function localStatus() {
  if (!isSupported()) {
    return { supported: false, model: 'unavailable', summarizer: 'unavailable' };
  }

  const probe = async (global) => {
    if (!has(global)) return 'unavailable';
    try {
      return await Promise.race([
        self[global].availability(),
        new Promise((resolve) => setTimeout(() => resolve('unknown'), PROBE_MS * 4))
      ]);
    } catch {
      return 'unavailable';
    }
  };

  const [model, summarizer] = await Promise.all([probe('LanguageModel'), probe('Summarizer')]);
  return { supported: true, model, summarizer };
}

/**
 * Fetches the model, reporting progress as a 0–1 fraction.
 *
 * This is the multi-gigabyte download, which is exactly why it lives behind a
 * button on the options page and is never reachable from a panel row. The
 * Summarizer runs on the same base model, so one download serves both.
 */
export async function downloadModel(onProgress) {
  if (!has('LanguageModel')) throw new Error('This browser has no built-in model.');

  const session = await LanguageModel.create({
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        onProgress?.(typeof e.loaded === 'number' ? e.loaded : 0);
      });
    }
  });
  session.destroy?.();
  return true;
}
