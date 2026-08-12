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

import { el, menu, asyncView, quote, actionRow } from '../kit.js';
import { AI } from '../../common/constants.js';

const MAX_LEN = 6000;

const TONES = [
  { action: AI.FIX, icon: 'fix', label: 'Fix spelling & grammar', busy: 'Proofreading…' },
  { action: AI.SHORTER, icon: 'shorter', label: 'Make it shorter', busy: 'Trimming…' },
  { action: AI.FORMAL, icon: 'formal', label: 'More formal', busy: 'Formalising…' },
  { action: AI.CASUAL, icon: 'casual', label: 'More casual', busy: 'Loosening up…' }
];

/** Long enough to be worth rewriting, or clearly a full sentence. */
function looksLikeProse(text, settings) {
  const t = text.trim();
  if (t.length >= settings.minRewriteChars) return true;
  return t.split(/\s+/).length >= 6 && /[.!?]/.test(t);
}

export default {
  id: 'rewrite',
  title: 'Rewrite',
  priority: 50,

  matches(text, settings) {
    const t = text.trim();
    if (!t || t.length > MAX_LEN) return null;
    if (!looksLikeProse(t, settings)) return null;
    return { words: t.split(/\s+/).length, chars: t.length };
  },

  items({ text, match }) {
    return [{
      key: 'rewrite',
      icon: 'rewrite',
      label: 'Rewrite',
      value: `${match.words} words`,
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
  return asyncView(tone.busy, async () => {
    const res = await api.ai(tone.action, text);
    return el('div', {},
      el('div', { class: 'hh-label', text: `Was${res.cached ? ' · cached' : ''}` }),
      quote(text),
      el('div', { class: 'hh-label', text: tone.label }),
      el('div', { class: 'hh-text', text: res.text }),
      actionRow(res.text, api)
    );
  }, (err, retry) => api.errorFor(err, retry));
}
