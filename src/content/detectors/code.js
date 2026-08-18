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

import { provenance, lookupBlocks } from '../kit.js';
import { AI } from '../../common/constants.js';
import { parseTopics } from '../../common/text.js';
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

  rows({ text, match }) {
    return [
      {
        key: 'code',
        icon: 'code',
        label: 'Explain this code',
        value: match.language || null,
        detailTitle: match.language ? `${match.language} code` : 'Code',
        // Both rows cost a model call, so nothing runs until one is opened.
        detail: {
          // A walkthrough of a whole function is long enough that reading along
          // as it arrives beats waiting for the finished paragraph.
          kind: 'stream',
          loading: 'Reading the code…',
          run: (api, emit) => api.ai(AI.EXPLAIN_CODE, text, { language: match.language }, emit),
          done: (res) => explainBlocks(text, res)
        }
      },
      {
        key: 'code:comment',
        icon: 'comment',
        label: 'Add comments',
        detailTitle: 'Commented',
        detail: {
          kind: 'async',
          loading: 'Commenting…',
          run: async (api) => {
            const res = await api.ai(AI.COMMENT_CODE, text, { language: match.language });
            // A `code` block, not `text`: the whitespace is load-bearing, and
            // commented source set in a proportional face that wraps is not
            // the thing anyone asked to copy.
            return [
              { type: 'code', text: res.text },
              { type: 'actions', text: res.text }
            ];
          }
        }
      }
    ];
  }
};

/** The finished walkthrough: the prose, what you can do with it, where it came from. */
function explainBlocks(text, res) {
  return [
    { type: 'text', text: res.text, rich: true },
    { type: 'buttons', items: [{ copy: res.text }] },
    // A snippet has no encyclopedia title, so the topics are derived from it
    // first. The explanation goes along as ranking context, the same as it
    // does for a plain term.
    topicSourceDisclosure(text, res.text),
    ...provenanceBlocks(res),
    // "What does line 4 do?" is the obvious next question, and the thread is
    // where it goes.
    { type: 'conversation', source: text, answer: res.text }
  ];
}

/**
 * "Find a source" for a selection with no obvious title.
 *
 * Searching Wikipedia for a whole snippet returns noise, so the model is asked
 * what the code is *about* first. That is the one thing it can do here without
 * risk: it picks the search term, and Wikipedia decides whether such an article
 * exists. An invented topic simply finds nothing.
 *
 * Only the first topic is looked up, so the common case costs one search rather
 * than three — and none at all until the button is pressed.
 */
function topicSourceDisclosure(text, context) {
  return {
    type: 'disclosure',
    label: 'Find a source',
    icon: 'source',
    busy: 'Working out what this is about…',
    run: async (api) => {
      const res = await api.ai(AI.TOPICS, text);
      const topics = parseTopics(res.text);
      if (!topics.length) {
        return [{ type: 'note', text: 'Nothing here that an encyclopedia would have an article on.' }];
      }
      return [
        { type: 'sub', text: `In this text: ${topics[0]}` },
        ...(await lookupBlocks(api, topics[0], context))
      ];
    }
  };
}





/**
 * kit.provenanceNote as data — the same line, minus the DOM.
 *
 * Where an answer came from is stated, not implied, and an answer with nothing
 * to say about its origin says nothing rather than an empty line.
 */
function provenanceBlocks(res) {
  const text = provenance(res).replace(/^ · /, '');
  return text ? [{ type: 'sub', text: text[0].toUpperCase() + text.slice(1) }] : [];
}
