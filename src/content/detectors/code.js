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

import { el, copyButton, topicSourceButton, provenance, followUp } from '../kit.js';
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
    {
      /*
       * Copy and "Find a source", kept together and kept as DOM.
       *
       * The source button appends itself *into* this row rather than sitting
       * below it, and it only appears after the model has answered — so the row
       * is not a fixed list of buttons that a `buttons` block could describe.
       *
       * A snippet has no encyclopedia title, so the topics are derived from it
       * first — see kit.topicSourceButton. The explanation goes along as
       * ranking context, the same as it does for a plain term.
       */
      type: 'custom',
      note: '“Find a source” needs the browser panel.',
      render: (api) => {
        const actions = el('div', { class: 'hh-row' }, copyButton(res.text, api));
        topicSourceButton(text, api, actions, { context: res.text });
        return actions;
      }
    },
    ...provenanceBlocks(res),
    {
      /*
       * "What does line 4 do?" is the obvious next question, and until now
       * there was nowhere to put it.
       *
       * A live conversation that owns its own state across turns, which is the
       * other thing blocks cannot describe. Nothing is lost on Android by this
       * today, because the AI path is not wired up there at all yet.
       */
      type: 'custom',
      note: 'Follow-up questions need the browser panel.',
      render: (api) => {
        const host = el('div', {});
        followUp({ source: text, answer: res.text }, api, host);
        return host;
      }
    }
  ];
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
