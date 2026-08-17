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

  rows({ text, settings }) {
    return [{
      key: 'speak',
      icon: 'speak',
      label: 'Read aloud',
      detailTitle: 'Read aloud',
      detail: {
        kind: 'blocks',
        blocks: [{
          /*
           * The one view here that a `buttons` block cannot stand in for.
           *
           * Not because of the two buttons — those would describe fine — but
           * because the view *does* something when it opens (it starts
           * speaking), and then rewrites itself: the note underneath reads
           * "Speaking." or "Finished." depending on what the synthesiser is
           * doing right now, and every press re-renders it. Blocks are a
           * description handed over once; this is live state, and there is no
           * block that means "run this on open and redraw on change".
           *
           * Which is the honest place to stop. A native renderer has its own
           * text-to-speech and its own transport controls, and it should build
           * them against its own engine rather than be handed a description of
           * this one.
           */
          type: 'custom',
          note: 'Reading aloud uses the browser’s own speech synthesis.',
          render: () => speakView(text, settings?.language)
        }]
      }
    }];
  }
};

/**
 * The view starts speaking on open rather than offering a second button.
 *
 * Every other tool answers when you open its row; a "Read aloud" row that then
 * made you press "Play" would be the one that asks twice. Stop is right there.
 *
 * The container is plain: the panel's own `hh-detail` wrapper is around this
 * block already, and a second one would pad the view twice.
 */
function speakView(text, lang) {
  const box = el('div', {});

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
