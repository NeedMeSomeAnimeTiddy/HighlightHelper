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
      {
        /*
         * Copy/Replace, "Find a source" and the follow-up thread, kept together
         * and kept as DOM.
         *
         * Not laziness about the block vocabulary: the source button appends
         * itself *into* the actions row, and the follow-up is a live
         * conversation that owns its own state across turns. Describing either
         * as data would mean inventing blocks that only one view uses, and
         * splitting them apart would move "Find a source" onto its own line —
         * a real layout change to a shipped view, for no gain.
         *
         * Nothing is lost on Android by this today, because the AI path is not
         * wired up there at all yet. When it is, this splits into a native
         * actions block plus a real conversation view, and that is the right
         * time to design one — not now, guessing.
         */
        type: 'custom',
        note: 'Follow-up questions need the browser panel.',
        render: (api) => {
          const host = el('div', {});
          const actions = actionRow(res.text, api);
          host.append(actions);
          // A paragraph has no encyclopedia title. The topics are derived from
          // the original text rather than the summary, so nothing the model
          // introduced while condensing can become a search term of its own.
          topicSourceButton(text, api, actions, { context: res.text });
          followUp({ source: text, answer: res.text }, api, host);
          return host;
        }
      }
    ]
  };
}
