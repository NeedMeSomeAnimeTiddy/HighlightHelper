/**
 * Read aloud.
 *
 * Local, instant, and the only tool here that is useful without looking at the
 * screen. It sits next to the text tools catch-all because it applies to any
 * prose, and it deliberately does not apply to code or to a hex colour — having
 * the browser recite "hash three f eight a e zero" is not a feature.
 */

import { looksLikeLanguage } from '../../common/text.js';
import { isCode } from './codelang.js';
import { canSpeak } from '../speech.js';

const MIN_CHARS = 8;
const MAX_CHARS = 20000;

export default {
  id: 'speak',
  title: 'Read aloud',
  priority: 88,

  matches(text) {
    if (!canSpeak()) return null;
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_CHARS) return null;
    if (!looksLikeLanguage(t)) return null;
    if (isCode(t)) return null;
    return { chars: t.length };
  },

  rows({ text, settings }) {
    return [{
      key: 'speak',
      icon: 'speak',
      label: 'Read aloud',
      detailTitle: 'Read aloud',
      /*
       * What to say and which voice to say it in, and nothing about how.
       *
       * Every platform that can run this already has speech synthesis and its
       * own transport controls, so the play/stop behaviour belongs to whatever
       * draws the block rather than to the detector describing it.
       */
      detail: {
        kind: 'blocks',
        blocks: [{ type: 'speech', text, lang: settings?.language }]
      }
    }];
  }
};
