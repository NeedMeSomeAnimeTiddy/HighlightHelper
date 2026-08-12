/**
 * Summarising, for selections long enough to be worth compressing.
 *
 * Two separate rows rather than a submenu: "summarise" and "pull out the key
 * points" are different intents, and burying either behind a drill-in would
 * cost a click for no grouping benefit.
 *
 * Both cost a DeepSeek call, so nothing runs until a row is picked.
 */

import { el, streamView, actionRow, topicSourceButton, provenance, followUp, textBlock }
  from '../kit.js';
import { AI } from '../../common/constants.js';
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

  items({ text }) {
    return [
      {
        key: 'summarize',
        icon: 'summarize',
        label: 'Summarise',
        detailTitle: 'Summary',
        open: (api) => run(text, AI.SUMMARIZE, 'Summarising…', 'Summary', api)
      },
      {
        key: 'keypoints',
        icon: 'list',
        label: 'Key points',
        detailTitle: 'Key points',
        open: (api) => run(text, AI.KEYPOINTS, 'Pulling out the points…', 'Key points', api)
      }
    ];
  }
};

function run(text, action, busy, label, api) {
  // Summaries are the longest thing this extension produces, so they stream —
  // the first sentence is readable while the rest is still being written.
  return streamView(
    busy,
    (emit) => api.ai(action, text, {}, emit),
    (res) => {
      const actions = actionRow(res.text, api);
      const view = el('div', {},
        el('div', { class: 'hh-label', text: `${label}${provenance(res)}` }),
        textBlock(res.text),
        actions
      );
      // A paragraph has no encyclopedia title. The topics are derived from the
      // original text rather than the summary, so nothing the model introduced
      // while condensing can become a search term of its own.
      topicSourceButton(text, api, actions, { context: res.text });
      followUp({ source: text, answer: res.text }, api, view);
      return view;
    },
    (err, retry) => api.errorFor(err, retry)
  );
}
