/**
 * Translation detector.
 *
 * Always available (translating your own language into another is a real use
 * case), but it ranks itself near the top of the tab list when the local
 * guesser thinks the selection is in a language you don't read.
 *
 * Nothing is sent anywhere until you press Translate.
 */

import { el, btn, replaceContent, resultBlock, spinner } from '../kit.js';
import { LANGUAGES, languageName } from '../../common/languages.js';
import { detectLanguage, baseTag } from './langdetect.js';
import { AI } from '../../common/constants.js';

const MAX_LEN = 4000;

export default {
  id: 'translate',
  title: 'Translate',
  priority: 30,

  matches(text, settings) {
    if (!text || text.length > MAX_LEN) return null;
    if (!/[\p{L}]/u.test(text)) return null;

    const guess = detectLanguage(text);
    const foreign =
      Boolean(guess.lang) &&
      guess.confidence >= 0.35 &&
      baseTag(guess.lang) !== baseTag(settings.language);

    return {
      detected: guess.lang,
      confidence: guess.confidence,
      foreign,
      // Confidently foreign text jumps ahead of unit/currency; otherwise the
      // tab sits behind the specific detectors.
      priority: foreign ? 5 : 65
    };
  },

  render({ text, match, settings, api }) {
    const box = el('div', {});

    // Pre-selected target language, overridable from the dropdown.
    let target = api.forcedLanguage || settings.language;

    const picker = el('select', { class: 'hh-select' },
      ...LANGUAGES.map(([code, name]) =>
        el('option', { value: code, selected: code === target }, name)
      )
    );
    picker.addEventListener('change', () => { target = picker.value; });

    const goBtn = btn('Translate', () => run(), { variant: 'hh-primary' });

    const controls = el('div', { class: 'hh-row' }, picker, goBtn);

    const intro = match.foreign && match.detected
      ? el('p', { class: 'hh-sub', text: `Looks like ${languageName(match.detected)}.` })
      : null;

    const preview = el('blockquote', { class: 'hh-quote', text });

    function idle() {
      replaceContent(box, ...[intro, preview, controls].filter(Boolean));
    }

    async function run() {
      replaceContent(box, spinner(`Translating into ${languageName(target)}…`));
      try {
        const res = await api.ai(AI.TRANSLATE, text, { language: target });
        const out = el('div', {},
          resultBlock(res.text, api, { label: `${languageName(target)}${res.cached ? ' · cached' : ''}` })
        );
        out.append(el('div', { class: 'hh-row' }, btn('Change language', idle, { variant: 'hh-ghost' })));
        replaceContent(box, out);
      } catch (err) {
        replaceContent(box, api.errorFor(err, run));
      }
    }

    idle();
    // The right-click "Translate to…" menu opens straight into the result.
    if (api.forcedLanguage) run();

    return box;
  }
};
