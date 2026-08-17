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
 * `rows` receives { text, match, settings, context } and returns menu rows.
 *
 * `context` is the page, as plain data — { forcedLanguage, title, host, url }.
 * Facts, never capabilities: a row may need to say "Translate to French"
 * because the right-click asked for French, but it must not be able to build
 * DOM or start a request. The Android bridge supplies its own, mostly empty,
 * because an intent carries a string and no page.
 *
 * The rows themselves:
 *
 *   {
 *     key,                  // unique; lets the panel open a row directly
 *     icon,                 // glyph name from ../icons.js
 *     label,                // row text
 *     value,                // right-hand result: string | { task(api) }
 *     detailTitle,          // header of the drilled-in view
 *     detail                // a view spec; omit for a static, unclickable row
 *   }
 *
 * `value` as `{ task(api) }` is for an answer that is free but not instant
 * (currency waits on cached rates); the row pulses until it resolves. Anything
 * that costs money must wait for `detail` — that click is the user's consent.
 *
 * A `detail` spec is one of four kinds, all rendered by kit.renderView:
 *
 *   { kind: 'blocks', blocks }                     static content
 *   { kind: 'menu',   rows }                       a nested submenu
 *   { kind: 'async',  loading, run(api) }          spinner, then blocks
 *   { kind: 'stream', loading, run(api, emit), done(res, api) }
 *
 * and the block types are listed in kit.js: label, note, sub, quote, headline,
 * facts, steps, text, code, swatch, actions, buttons, menu, and `custom` as the
 * escape hatch for the few genuinely browser-shaped views.
 *
 * Reach for `custom` only when a view is genuinely a live widget — one that
 * runs on open, redraws itself, or owns state across turns. Using it to avoid
 * describing something that blocks could express costs the Android app a panel
 * for nothing.
 *
 * ---
 *
 * Why data and not DOM.
 *
 * `rows` describes the menu; it does not build it. That is what lets the same
 * detector drive the extension's panel and the Android app's native sheet
 * without either owning the other's widgets — see ANDROID.md. The rule that
 * makes it work is simple: nothing a detector returns may be a DOM node. Build
 * nothing, describe everything, and let the renderer decide what a "headline"
 * looks like on its platform.
 *
 * `items({ text, match, settings, api }) -> rows with open(api) -> Node` is the
 * older form and still runs. Detectors are being moved across one at a time; a
 * detector has one or the other, never both, and the test suite enforces it.
 *
 * Adding a detector = write the file, import it, add it to LIST, and add its
 * id to DEFAULTS.detectors in src/common/settings.js.
 */

import color from './color.js';
import datetime from './datetime.js';
import currency from './currency.js';
import coords from './coords.js';
import calc from './calc.js';
import numberbase from './numberbase.js';
import regex from './regex.js';
import unit from './unit.js';
import code from './code.js';
import decode from './decode.js';
import translate from './translate.js';
import jargon from './jargon.js';
import summarize from './summarize.js';
import rewrite from './rewrite.js';
import qr from './qr.js';
import texttools from './texttools.js';
import dictionary from './dictionary.js';
import search from './search.js';
import link from './link.js';
import speak from './speak.js';
import highlight from './highlight.js';
import custom from './custom.js';

export const LIST = [
  color, datetime, currency, coords, calc, numberbase, regex, unit,
  code, decode, dictionary, translate, jargon, summarize, rewrite, qr,
  custom, highlight, link, search, speak, texttools
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
