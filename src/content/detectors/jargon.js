/**
 * Jargon / acronym explainer.
 *
 * Fires on short selections: an acronym (SLA, CI/CD, GDPR) or a phrase of up
 * to four words. The page title goes along as context so "PR" on a GitHub page
 * and "PR" on a marketing blog get different answers.
 *
 * Costs a DeepSeek call, so nothing happens until the row is picked.
 */

import { provenance, lookupBlocks } from '../kit.js';
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

/**
 * The line provenanceNote() draws, as data: "cached, on-device" with a capital,
 * or nothing at all when the answer was neither. Said as its own line here
 * because the explanation above it has no label to hang the suffix on.
 */
function provenanceLine(res) {
  const text = provenance(res).replace(/^ · /, '');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
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

  rows({ match }) {
    return [{
      key: 'explain',
      icon: 'explain',
      label: match.acronym ? `Expand “${short(match.term)}”` : 'Explain this',
      detailTitle: short(match.term),
      // One call and one answer, so the view waits behind a spinner rather than
      // streaming: an explanation is a sentence or two, not a page.
      detail: {
        kind: 'async',
        loading: 'Looking it up…',
        run: (api) => explainBlocks(match.term, api)
      }
    }];
  }
};

async function explainBlocks(term, api) {
  const res = await api.ai(AI.EXPLAIN, term, { pageContext: api.context.title });
  const source = provenanceLine(res);

  return [
    { type: 'text', text: res.text, rich: true },
    { type: 'buttons', items: [{ copy: res.text }] },
    // DeepSeek has no web access and cannot cite anything, so this is a real
    // encyclopedia lookup rather than a citation from the model. The
    // explanation goes along as context: it describes the sense meant, and
    // "SLA" alone finds the Symbionese Liberation Army first.
    sourceDisclosure(term, res.text),
    ...(source ? [{ type: 'sub', text: source }] : []),
    { type: 'conversation', source: term, answer: res.text }
  ];
}

/**
 * "Find a source" for a selection that already *is* the term.
 *
 * A lookup costs a request and most readers accept the explanation and move
 * on, so it waits for the click rather than running because the view opened.
 */
function sourceDisclosure(term, context) {
  return {
    type: 'disclosure',
    label: 'Find a source',
    icon: 'source',
    busy: `Looking up “${term}”…`,
    run: (api) => lookupBlocks(api, term, context)
  };
}




