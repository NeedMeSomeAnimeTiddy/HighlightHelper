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
  COMMENT_CODE: 'comment-code'
};

/** Sentinel error codes the UI reacts to specially. */
export const ERR = {
  NO_KEY: 'NO_KEY',
  BAD_KEY: 'BAD_KEY',
  NO_FUNDS: 'NO_FUNDS',
  RATE_LIMIT: 'RATE_LIMIT',
  OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT'
};
