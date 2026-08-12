/**
 * Summarising, for selections long enough to be worth compressing.
 *
 * Two separate rows rather than a submenu: "summarise" and "pull out the key
 * points" are different intents, and burying either behind a drill-in would
 * cost a click for no grouping benefit.
 *
 * Both cost a DeepSeek call, so nothing runs until a row is picked.
 */

import { el, asyncView, actionRow } from '../kit.js';
import { AI } from '../../common/constants.js';

const MIN_CHARS = 280;
const MAX_LEN = 12000;

export default {
  id: 'summarize',
  title: 'Summarise',
  priority: 45,

  matches(text) {
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_LEN) return null;
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
  return asyncView(busy, async () => {
    const res = await api.ai(action, text);
    return el('div', {},
      el('div', { class: 'hh-label', text: `${label}${res.cached ? ' · cached' : ''}` }),
      el('div', { class: 'hh-text', text: res.text }),
      actionRow(res.text, api)
    );
  }, (err, retry) => api.errorFor(err, retry));
}
