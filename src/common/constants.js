/**
 * Message types exchanged between content scripts / options page and the
 * background service worker. Keep these in one place so a typo can't silently
 * create a message nobody listens for.
 */
export const MSG = {
  AI: 'hh:ai',                       // { action, text, options } -> DeepSeek
  RATES: 'hh:rates',                 // { base } -> exchange rates
  TEST_KEY: 'hh:test-key',           // options page "test API key" button
  CLEAR_CACHE: 'hh:clear-cache',
  CACHE_STATS: 'hh:cache-stats',
  OPEN_OPTIONS: 'hh:open-options',
  /** Content script asking the worker for panel.css — see main.js loadCss. */
  STYLESHEET: 'hh:stylesheet',
  /** Popup -> content script: "are you running on this page?" */
  PING: 'hh:ping',
  /** Look a term up in Wikipedia — a real reference, not a model citation. */
  SOURCE: 'hh:source',
  /** background -> content script: open the panel, optionally at one tool. */
  RUN_TOOL: 'hh:run-tool'
};

/** AI actions. Each maps to a prompt in src/background/deepseek.js. */
export const AI = {
  EXPLAIN: 'explain',
  TRANSLATE: 'translate',
  FIX: 'fix',
  SHORTER: 'shorter',
  FORMAL: 'formal',
  CASUAL: 'casual',
  SUMMARIZE: 'summarize',
  KEYPOINTS: 'keypoints',
  CONTINUE: 'continue',
  EXPLAIN_CODE: 'explain-code',
  COMMENT_CODE: 'comment-code',
  /**
   * Names things in the text worth looking up. The model only chooses what to
   * search for — Wikipedia decides whether it exists, so an invented topic
   * comes back as "no article" rather than as a fake citation.
   */
  TOPICS: 'topics'
};

/**
 * Where AI answers come from.
 *
 * 'local' is Chrome's built-in Gemini Nano: no key, no network, no cost, and
 * the selection never leaves the machine. It is not always possible — the
 * model is a multi-gigabyte download and the hardware bar is real — so 'auto'
 * uses it when it can and DeepSeek when it can't.
 */
export const PROVIDER = {
  AUTO: 'auto',
  LOCAL: 'local',
  CLOUD: 'cloud'
};

/** Sentinel error codes the UI reacts to specially. */
export const ERR = {
  NO_KEY: 'NO_KEY',
  BAD_KEY: 'BAD_KEY',
  NO_FUNDS: 'NO_FUNDS',
  RATE_LIMIT: 'RATE_LIMIT',
  OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT',
  /**
   * The page asked for an action the background script doesn't know.
   *
   * In practice this means the two halves are running different versions:
   * content scripts are re-injected on every page load and pick up new code
   * immediately, while the service worker keeps its old bundle until the
   * extension is reloaded. So a new tool can appear in the menu before the
   * worker can answer it.
   */
  STALE_WORKER: 'STALE_WORKER',
  /**
   * Answers were pinned to the on-device model and it can't serve this one.
   * Only ever raised when the user chose 'local' explicitly — on 'auto' an
   * unavailable local model is not an error, it is a quiet fall back to
   * DeepSeek.
   */
  NO_LOCAL_MODEL: 'NO_LOCAL_MODEL'
};
