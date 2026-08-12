/**
 * Jargon / acronym explainer.
 *
 * Fires on short selections: an acronym (SLA, CI/CD, GDPR) or a phrase of up
 * to four words. The page title goes along as context so "PR" on a GitHub page
 * and "PR" on a marketing blog get different answers.
 *
 * Costs a DeepSeek call, so nothing happens until the row is picked.
 */

import { el, asyncView, copyButton, sourceButton, provenanceNote, followUp, textBlock }
  from '../kit.js';
import { AI } from '../../common/constants.js';
import { letterRatio } from '../../common/text.js';

const MAX_CHARS = 48;
const MAX_WORDS = 4;
const LABEL_CHARS = 22;

/** SLA, CI/CD, IPv6, 401k — capitals with at least two letters. */
const RE_ACRONYM = /^[A-Z][A-Za-z0-9]*(?:[/\-.][A-Za-z0-9]+)*$/;

function isAcronym(text) {
  if (!RE_ACRONYM.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  const caps = text.replace(/[^A-Z]/g, '').length;
  return caps >= 2 && caps / letters.length >= 0.6;
}

function short(text) {
  return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;
}

export default {
  id: 'jargon',
  title: 'Explain',
  priority: 40,

  matches(text) {
    const t = text.trim();
    if (!t || t.length > MAX_CHARS) return null;
    if (/[.!?;]$/.test(t)) return null;               // a sentence, not a term
    // Must start with a letter and be mostly letters. Without this, "#3f8ae0"
    // and "15% of 240" both read as terms worth explaining.
    if (!/^\p{L}/u.test(t)) return null;
    if (letterRatio(t) < 0.6) return null;

    const words = t.split(/\s+/);
    if (words.length > MAX_WORDS) return null;

    const acronym = words.length === 1 && isAcronym(t);
    if (!acronym && words.length === 1 && t.length < 3) return null;

    return { term: t, acronym, priority: acronym ? 15 : 40 };
  },

  items({ match }) {
    return [{
      key: 'explain',
      icon: 'explain',
      label: match.acronym ? `Expand “${short(match.term)}”` : 'Explain this',
      detailTitle: short(match.term),
      open: (ctx) => asyncView('Looking it up…', async () => {
        const res = await ctx.ai(AI.EXPLAIN, match.term, {
          pageContext: ctx.context.title
        });
        const actions = el('div', { class: 'hh-row' }, copyButton(res.text, ctx));
        const view = el('div', {},
          textBlock(res.text),
          actions,
          provenanceNote(res)
        );
        // DeepSeek has no web access and cannot cite anything, so this is a
        // real encyclopedia lookup rather than a citation from the model. The
        // explanation goes along as context: it describes the sense meant, and
        // "SLA" alone finds the Symbionese Liberation Army first.
        sourceButton(match.term, ctx, actions, { context: res.text });
        followUp({ source: match.term, answer: res.text }, ctx, view);
        return view;
      }, (err, retry) => ctx.errorFor(err, retry))
    }];
  }
};
