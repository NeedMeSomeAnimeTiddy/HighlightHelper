/**
 * Rewriter + spell/grammar fixer for longer selections.
 *
 * Intent comes first: you pick a tone button, and only then does anything get
 * sent. The result arrives with Copy and Replace, where Replace writes back
 * into the textarea/contenteditable the text came from.
 */

import { el, btn, replaceContent, resultBlock, spinner } from '../kit.js';
import { AI } from '../../common/constants.js';

const MAX_LEN = 6000;

const TONES = [
  { action: AI.FIX, label: 'Fix grammar', busy: 'Proofreading…', title: 'Correct spelling, grammar and punctuation' },
  { action: AI.SHORTER, label: 'Shorter', busy: 'Trimming…', title: 'Condense while keeping the meaning' },
  { action: AI.FORMAL, label: 'Formal', busy: 'Formalising…', title: 'Rewrite in a professional register' },
  { action: AI.CASUAL, label: 'Casual', busy: 'Loosening up…', title: 'Rewrite in a conversational tone' }
];

/** Long enough to be worth rewriting, or clearly a full sentence. */
function looksLikeProse(text, settings) {
  const t = text.trim();
  if (t.length >= settings.minRewriteChars) return true;
  const words = t.split(/\s+/).length;
  return words >= 6 && /[.!?]/.test(t);
}

export default {
  id: 'rewrite',
  title: 'Rewrite',
  priority: 50,

  matches(text, settings) {
    const t = text.trim();
    if (!t || t.length > MAX_LEN) return null;
    if (!looksLikeProse(t, settings)) return null;
    return {
      words: t.split(/\s+/).length,
      chars: t.length
    };
  },

  render({ text, match, api }) {
    const box = el('div', {});

    function idle() {
      const buttons = TONES.map((tone) =>
        btn(tone.label, () => run(tone), { title: tone.title })
      );
      replaceContent(
        box,
        el('p', { class: 'hh-sub', text: `${match.words} words selected` }),
        el('blockquote', { class: 'hh-quote', text }),
        el('div', { class: 'hh-row' }, ...buttons)
      );
    }

    async function run(tone) {
      replaceContent(box, spinner(tone.busy));
      try {
        const res = await api.ai(tone.action, text);
        const out = el('div', {},
          resultBlock(res.text, api, {
            label: `${tone.label}${res.cached ? ' · cached' : ''}`
          })
        );
        out.append(
          el('div', { class: 'hh-row' },
            ...TONES.filter((t) => t.action !== tone.action).map((t) =>
              btn(t.label, () => run(t), { variant: 'hh-ghost', title: t.title })
            )
          )
        );
        replaceContent(box, out);
      } catch (err) {
        replaceContent(box, api.errorFor(err, () => run(tone)));
      }
    }

    idle();
    return box;
  }
};
