/**
 * Summarising, for selections long enough to be worth compressing.
 *
 * Two separate rows rather than a submenu: "summarise" and "pull out the key
 * points" are different intents, and burying either behind a drill-in would
 * cost a click for no grouping benefit.
 *
 * Both cost a DeepSeek call, so nothing runs until a row is picked.
 */

import { provenance, lookupBlocks } from '../kit.js';
import { AI } from '../../common/constants.js';
import { parseTopics } from '../../common/text.js';
import { isCode } from './codelang.js';

const MIN_CHARS = 280;
const MAX_LEN = 12000;

export default {
  id: 'summarize',
  title: 'Summarise',
  priority: 45,

  matches(text) {
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_LEN) return null;
    // The code detector already offers a walkthrough, which is the better tool.
    if (isCode(t)) return null;
    return { words: t.split(/\s+/).length };
  },

  rows({ text }) {
    return [
      {
        key: 'summarize',
        icon: 'summarize',
        label: 'Summarise',
        detailTitle: 'Summary',
        detail: streamed(text, AI.SUMMARIZE, 'Summarising…', 'Summary')
      },
      {
        key: 'keypoints',
        icon: 'list',
        label: 'Key points',
        detailTitle: 'Key points',
        detail: streamed(text, AI.KEYPOINTS, 'Pulling out the points…', 'Key points')
      }
    ];
  }
};

function streamed(text, action, busy, label) {
  return {
    // Summaries are the longest thing this extension produces, so they stream —
    // the first sentence is readable while the rest is still being written.
    kind: 'stream',
    loading: busy,
    run: (api, emit) => api.ai(action, text, {}, emit),
    done: (res) => [
      { type: 'label', text: `${label}${provenance(res)}` },
      { type: 'text', text: res.text, rich: true },
      { type: 'actions', text: res.text },
      // A paragraph has no encyclopedia title. The topics are derived from the
      // original text rather than the summary, so nothing the model introduced
      // while condensing can become a search term of its own.
      topicSourceDisclosure(text, res.text),
      { type: 'conversation', source: text, answer: res.text }
    ]
  };
}

/**
 * "Find a source" for a selection with no obvious title.
 *
 * Searching Wikipedia for a whole paragraph returns noise, so the model is
 * asked what the text is *about* first. That is the one thing it can do here
 * without risk: it picks the search term, and Wikipedia decides whether such an
 * article exists. An invented topic simply finds nothing.
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




