/**
 * Detector registry.
 *
 * A detector is a plain object:
 *
 *   {
 *     id:       'currency',            // stable key, also the settings toggle
 *     title:    'Currency',            // human name, used in options
 *     priority: 10,                    // lower = more specific, sorted first
 *     matches(text, settings)          // -> falsy | match object
 *     items(ctx)                       // -> menu rows for the matched text
 *   }
 *
 * `matches` must be cheap and side-effect free — it runs on every selection.
 * A match object may carry `priority` to override the detector's default (the
 * translate detector uses this to rank itself higher when it is confident the
 * text is foreign).
 *
 * `items` receives { text, match, settings, api } and returns menu rows:
 *
 *   {
 *     key,                  // unique; lets the panel open a row directly
 *     icon,                 // glyph name from ../icons.js
 *     label,                // row text
 *     value,                // optional right-hand result: string | Promise
 *     detailTitle,          // header of the drilled-in view
 *     open(api) -> Node     // omit entirely for a static, unclickable row
 *   }
 *
 * `value` may be a Promise when the answer is free but not instant (currency
 * waits on cached rates); the row shows a pulse until it resolves. Anything
 * that costs money must wait for `open` — that click is the user's consent.
 *
 * `open` returns an element synchronously. Use kit.asyncView for the
 * spinner-then-result-or-retry shape, and kit.menu to nest a submenu.
 *
 * Adding a detector = write the file, import it, add it to LIST, and add its
 * id to DEFAULTS.detectors in src/common/settings.js.
 */

import color from './color.js';
import datetime from './datetime.js';
import currency from './currency.js';
import calc from './calc.js';
import numberbase from './numberbase.js';
import unit from './unit.js';
import decode from './decode.js';
import translate from './translate.js';
import jargon from './jargon.js';
import summarize from './summarize.js';
import rewrite from './rewrite.js';
import texttools from './texttools.js';

export const LIST = [
  color, datetime, currency, calc, numberbase, unit,
  decode, translate, jargon, summarize, rewrite, texttools
];

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
