/**
 * Read aloud.
 *
 * Local, instant, and the only tool here that is useful without looking at the
 * screen. It sits next to the text tools catch-all because it applies to any
 * prose, and it deliberately does not apply to code or to a hex colour — having
 * the browser recite "hash three f eight a e zero" is not a feature.
 */

import { el, btn, note, replaceContent } from '../kit.js';
import { looksLikeLanguage } from '../../common/text.js';
import { isCode } from './codelang.js';
import { canSpeak, speak, stopSpeaking, isSpeaking } from '../speech.js';

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

  items({ text, settings }) {
    return [{
      key: 'speak',
      icon: 'speak',
      label: 'Read aloud',
      detailTitle: 'Read aloud',
      open: () => speakView(text, settings?.language)
    }];
  }
};

/**
 * The view starts speaking on open rather than offering a second button.
 *
 * Every other tool answers when you open its row; a "Read aloud" row that then
 * made you press "Play" would be the one that asks twice. Stop is right there.
 */
function speakView(text, lang) {
  const box = el('div', { class: 'hh-detail' });

  const start = () => {
    speak(text, lang);
    render();
  };

  const render = () => {
    replaceContent(box,
      el('div', { class: 'hh-row' },
        btn('Stop', () => { stopSpeaking(); render(); }, { icon: 'warn' }),
        btn('Again', start, { variant: 'hh-primary', icon: 'speak' })
      ),
      note(isSpeaking()
        ? 'Speaking. This stops if you close the panel or leave the page.'
        : 'Finished.')
    );
  };

  start();
  return box;
}
