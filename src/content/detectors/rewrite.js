/**
 * Rewriter + spell/grammar fixer for longer selections.
 *
 * "Rewrite" drills into a tone submenu rather than a flyout — a flyout near a
 * screen edge has to flip sides and is awkward on touch, and the extra depth
 * costs one keystroke.
 *
 * Results arrive with the original above them, so a grammar fix can be checked
 * against what it replaced.
 */

import { el, menu, streamView, quote, actionRow, provenance } from '../kit.js';
import { AI } from '../../common/constants.js';
import { wordCount, looksLikeLanguage, plural } from '../../common/text.js';
import { isCode } from './codelang.js';

const MAX_LEN = 6000;

export const TONES = [
  { action: AI.FIX, icon: 'fix', label: 'Fix spelling & grammar', busy: 'Proofreading…' },
  { action: AI.SHORTER, icon: 'shorter', label: 'Make it shorter', busy: 'Trimming…' },
  { action: AI.FORMAL, icon: 'formal', label: 'More formal', busy: 'Formalising…' },
  { action: AI.CASUAL, icon: 'casual', label: 'More casual', busy: 'Loosening up…' },
  // Continue appends instead of replacing, so its result view differs — see
  // continueView. Copy and Replace act on selection + continuation together,
  // because replacing your paragraph with only its ending would be wrong.
  { action: AI.CONTINUE, icon: 'continue', label: 'Continue writing', busy: 'Writing on…', appends: true }
];

const MIN_WORDS = 5;

/** Long enough to be worth rewriting, or clearly a full sentence. */
function looksLikeProse(text, settings) {
  const t = text.trim();
  // A 76-character JWT clears the character threshold but is not prose.
  if (wordCount(t) < MIN_WORDS) return false;
  if (!looksLikeLanguage(t)) return false;
  // "Fix spelling & grammar" on a function body is actively destructive.
  if (isCode(t)) return false;
  if (t.length >= settings.minRewriteChars) return true;
  return wordCount(t) >= 6 && /[.!?]/.test(t);
}

export default {
  id: 'rewrite',
  title: 'Rewrite',
  priority: 50,

  matches(text, settings) {
    const t = text.trim();
    if (!t || t.length > MAX_LEN) return null;
    if (!looksLikeProse(t, settings)) return null;
    return { words: wordCount(t), chars: t.length };
  },

  items({ text, match }) {
    return [{
      key: 'rewrite',
      icon: 'rewrite',
      label: 'Rewrite',
      value: plural(match.words, 'word'),
      detailTitle: 'Rewrite',
      open: (api) => menu(
        TONES.map((tone) => ({
          key: `rewrite:${tone.action}`,
          icon: tone.icon,
          label: tone.label,
          detailTitle: tone.label,
          open: (ctx) => resultView(text, tone, ctx)
        })),
        api
      )
    }];
  }
};

function resultView(text, tone, api) {
  return streamView(
    tone.busy,
    (emit) => api.ai(tone.action, text, {}, emit),
    (res) => (tone.appends
      ? continueView(text, res, api)
      : el('div', {},
          el('div', { class: 'hh-label', text: `Was${provenance(res)}` }),
          quote(text),
          el('div', { class: 'hh-label', text: tone.label }),
          el('div', { class: 'hh-text', text: res.text }),
          actionRow(res.text, api)
        )),
    (err, retry) => api.errorFor(err, retry)
  );
}

/**
 * The whole passage, with the original dimmed and the new text in normal
 * weight, so it is obvious what was added. Copy and Replace take both.
 */
function continueView(original, res, api) {
  const joined = /\s$/.test(original) ? original + res.text : `${original} ${res.text}`;
  return el('div', {},
    el('div', { class: 'hh-label', text: `Continued${provenance(res)}` }),
    el('div', { class: 'hh-text' },
      el('span', { class: 'hh-dim', text: original.trimEnd() }),
      ' ',
      el('span', { text: res.text })
    ),
    actionRow(joined, api)
  );
}
