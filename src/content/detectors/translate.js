/**
 * Translation.
 *
 * Always offered — translating *out of* your own language is a real use — but
 * it ranks to the top of the menu when the local guesser thinks the selection
 * is in a language you don't read.
 *
 * Picking the row translates into your default language straight away; the
 * language picker sits next to Copy/Replace for switching afterwards.
 */

import { el, replaceContent, spinner, actionRow, provenance } from '../kit.js';
import { LANGUAGES, languageName } from '../../common/languages.js';
import { detectLanguage, baseTag } from './langdetect.js';
import { AI } from '../../common/constants.js';
import { looksLikeLanguage } from '../../common/text.js';
import { isCode } from './codelang.js';

const MAX_LEN = 4000;

export default {
  id: 'translate',
  title: 'Translate',
  priority: 30,

  matches(text, settings) {
    if (!text || text.length > MAX_LEN) return null;
    // Hex colours, JWTs and hashes contain letters but aren't language.
    if (!looksLikeLanguage(text)) return null;

    const guess = detectLanguage(text);
    const foreign =
      Boolean(guess.lang) &&
      guess.confidence >= 0.35 &&
      baseTag(guess.lang) !== baseTag(settings.language) &&
      // Identifiers and keywords fool a stopword guesser. Translating comments
      // in a snippet is a fair thing to want, so the row stays — it just
      // doesn't get to sit above the code rows.
      !isCode(text);

    return {
      detected: guess.lang,
      confidence: guess.confidence,
      foreign,
      // Confidently foreign text jumps ahead of unit/currency; otherwise the
      // row sits behind the specific detectors.
      priority: foreign ? 5 : 65
    };
  },

  items({ text, match, settings, api }) {
    const initial = api.forcedLanguage || settings.language;

    return [{
      key: 'translate',
      icon: 'translate',
      label: `Translate to ${languageName(initial)}`,
      detailTitle: match.foreign && match.detected
        ? `From ${languageName(match.detected)}`
        : 'Translation',
      open: (ctx) => view(text, initial, ctx)
    }];
  }
};

function view(text, initialLanguage, api) {
  const box = el('div', { class: 'hh-detail' });
  let target = initialLanguage;

  const picker = el('select', {
    class: 'hh-select',
    'aria-label': 'Translate into'
  }, ...LANGUAGES.map(([code, name]) =>
    el('option', { value: code, selected: code === target }, name)
  ));

  picker.addEventListener('change', () => {
    target = picker.value;
    run();
  });

  function run() {
    replaceContent(box, spinner(`Translating into ${languageName(target)}…`));
    api.ai(AI.TRANSLATE, text, { language: target }).then(
      (res) => {
        picker.value = target;
        replaceContent(box,
          el('div', {
            class: 'hh-label',
            text: `${languageName(target)}${provenance(res)}`
          }),
          el('div', { class: 'hh-text', text: res.text }),
          actionRow(res.text, api, [picker])
        );
      },
      (err) => replaceContent(box, api.errorFor(err, run))
    );
  }

  run();
  return box;
}
