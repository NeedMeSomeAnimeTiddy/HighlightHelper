/**
 * Code explainer — DeepSeek.
 *
 * Offers a plain-English walkthrough, and a commented copy of the same code
 * that Replace can write straight back into the editor it came from.
 *
 * The guessed language goes into the prompt rather than being shown as fact:
 * the guesser is a keyword heuristic, and a wrong label in the UI would be
 * more annoying than a wrong hint in a prompt the model can ignore.
 */

import { el, asyncView, actionRow, copyButton } from '../kit.js';
import { AI } from '../../common/constants.js';
import { isCode, guessLanguage } from './codelang.js';

const MIN_CHARS = 24;
const MAX_LEN = 8000;

export default {
  id: 'code',
  title: 'Code',
  priority: 22,

  matches(text) {
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_LEN) return null;
    if (!isCode(t)) return null;
    return { language: guessLanguage(t) };
  },

  items({ text, match }) {
    return [
      {
        key: 'code',
        icon: 'code',
        label: 'Explain this code',
        value: match.language || null,
        detailTitle: match.language ? `${match.language} code` : 'Code',
        open: (api) => asyncView('Reading the code…', async () => {
          const res = await api.ai(AI.EXPLAIN_CODE, text, { language: match.language });
          return el('div', {},
            el('div', { class: 'hh-text', text: res.text }),
            el('div', { class: 'hh-row' }, copyButton(res.text, api)),
            res.cached ? el('p', { class: 'hh-sub', text: 'From cache' }) : null
          );
        }, (err, retry) => api.errorFor(err, retry))
      },
      {
        key: 'code:comment',
        icon: 'comment',
        label: 'Add comments',
        detailTitle: 'Commented',
        open: (api) => asyncView('Commenting…', async () => {
          const res = await api.ai(AI.COMMENT_CODE, text, { language: match.language });
          return el('div', {},
            el('pre', { class: 'hh-code', text: res.text }),
            actionRow(res.text, api)
          );
        }, (err, retry) => api.errorFor(err, retry))
      }
    ];
  }
};
