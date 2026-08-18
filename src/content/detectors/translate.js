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

import { provenance } from '../kit.js';
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

  rows({ text, match, settings, context = {} }) {
    // A right-click "Translate to French" names the target before the row is
    // even built, so the label and the spinner both say French. This used to
    // be readable only from `api` inside the view, which meant the menu row
    // behind an opened translation claimed the wrong language.
    const target = context.forcedLanguage || settings.language;

    return [{
      key: 'translate',
      icon: 'translate',
      label: `Translate to ${languageName(target)}`,
      detailTitle: match.foreign && match.detected
        ? `From ${languageName(match.detected)}`
        : 'Translation',
      detail: {
        kind: 'blocks',
        blocks: [{
          /*
           * The picker owns the translation rather than sitting under one.
           *
           * A `choice` renders its current selection immediately, so the view
           * is "translate into <language>: <answer>" from the first frame, and
           * switching replaces the answer instead of adding a second one below
           * the first. That is what the old in-place rebuild did, without
           * needing a live <select> built into DOM the panel owns — and it
           * means the control exists at all away from the panel.
           */
          type: 'choice',
          label: 'Translate into',
          value: target,
          options: LANGUAGES,
          busy: `Translating into ${languageName(target)}…`,
          run: (api, code) => translateInto(text, code || target, api)
        }]
      }
    }];
  }
};

/** The answer itself: where it came from, what it says, what you can do with it. */
async function translateInto(text, target, api) {
  const res = await api.ai(AI.TRANSLATE, text, { language: target });

  return [
    { type: 'label', text: `${languageName(target)}${provenance(res)}` },
    { type: 'text', text: res.text, rich: true },
    { type: 'actions', text: res.text }
  ];
}
