/**
 * Jargon / acronym explainer.
 *
 * Fires on short selections: an acronym (SLA, CI/CD, GDPR) or a phrase of up
 * to four words. The page title goes along as context so "PR" on a GitHub
 * page and "PR" on a marketing blog get different answers.
 */

import { el, btn, replaceContent, resultBlock, spinner } from '../kit.js';
import { AI } from '../../common/constants.js';

const MAX_CHARS = 48;
const MAX_WORDS = 4;

/** SLA, CI/CD, IPv6, 401k — capitals with at least two letters. */
const RE_ACRONYM = /^[A-Z][A-Za-z0-9]*(?:[/\-.][A-Za-z0-9]+)*$/;

function isAcronym(text) {
  if (!RE_ACRONYM.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  const caps = text.replace(/[^A-Z]/g, '').length;
  return caps >= 2 && caps / letters.length >= 0.6;
}

export default {
  id: 'jargon',
  title: 'Explain',
  priority: 40,

  matches(text) {
    const t = text.trim();
    if (!t || t.length > MAX_CHARS) return null;
    if (/[.!?;]$/.test(t)) return null;               // a sentence, not a term
    if (!/[\p{L}]/u.test(t)) return null;             // needs at least a letter

    const words = t.split(/\s+/);
    if (words.length > MAX_WORDS) return null;

    const acronym = words.length === 1 && isAcronym(t);
    if (!acronym && words.length === 1 && t.length < 3) return null;

    return { term: t, acronym, priority: acronym ? 15 : 40 };
  },

  render({ match, api }) {
    const box = el('div', {});

    const goBtn = btn(
      match.acronym ? 'What does it stand for?' : 'Explain this',
      () => run(),
      { variant: 'hh-primary' }
    );

    function idle() {
      replaceContent(
        box,
        el('div', { class: 'hh-label', text: match.acronym ? 'Acronym' : 'Term' }),
        el('div', { class: 'hh-text', text: match.term }),
        el('div', { class: 'hh-row' }, goBtn)
      );
    }

    async function run() {
      replaceContent(box, spinner('Looking it up…'));
      try {
        const res = await api.ai(AI.EXPLAIN, match.term, {
          pageContext: api.context.title
        });
        const copyBtn = btn('Copy', async () => {
          const ok = await api.copy(res.text);
          copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
        });
        replaceContent(
          box,
          el('div', { class: 'hh-label', text: match.term }),
          el('div', { class: 'hh-text', text: res.text }),
          el('div', { class: 'hh-row' }, copyBtn)
        );
      } catch (err) {
        replaceContent(box, api.errorFor(err, run));
      }
    }

    idle();
    return box;
  }
};
