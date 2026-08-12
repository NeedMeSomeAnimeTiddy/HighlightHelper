/**
 * Detector registry.
 *
 * A detector is a plain object:
 *
 *   {
 *     id:       'currency',            // stable key, also the settings toggle
 *     title:    'Currency',            // tab label
 *     priority: 10,                    // lower = more specific, sorted first
 *     matches(text, settings)          // -> falsy | match object
 *     render(ctx)                      // -> HTMLElement (sync; may fill async)
 *   }
 *
 * `matches` must be cheap and side-effect free — it runs on every selection.
 * A match object may carry `priority` to override the detector's default (the
 * translate detector uses this to rank itself higher when it is confident the
 * text is foreign).
 *
 * `render` receives:
 *   { text, match, settings, api }
 * and returns an element immediately. Anything slow (network, AI) is the
 * detector's own job to run with a spinner — see kit.withLoading.
 *
 * Adding a detector = write the file, import it, add it to LIST, and add its
 * id to DEFAULTS.detectors in src/common/settings.js.
 */

import currency from './currency.js';
import unit from './unit.js';
import translate from './translate.js';
import jargon from './jargon.js';
import rewrite from './rewrite.js';

export const LIST = [currency, unit, translate, jargon, rewrite];

export function getDetector(id) {
  return LIST.find((d) => d.id === id);
}

/**
 * Runs every enabled detector over the selection.
 * Returns [{ detector, match }] sorted most-specific first.
 */
export function detect(text, settings) {
  const hits = [];
  for (const d of LIST) {
    if (settings.detectors[d.id] === false) continue;
    let match;
    try {
      match = d.matches(text, settings);
    } catch (err) {
      console.warn(`[Highlight Helper] detector "${d.id}" threw:`, err);
      continue;
    }
    if (!match) continue;
    hits.push({ detector: d, match, priority: match.priority ?? d.priority });
  }
  return hits.sort((a, b) => a.priority - b.priority);
}
