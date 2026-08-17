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

import { el, blocks, replaceContent, spinner, actionRow, provenance } from '../kit.js';
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
        kind: 'async',
        loading: `Translating into ${languageName(target)}…`,
        run: (api) => translated(text, target, api)
      }
    }];
  }
};

/** One translation, described: which language it is, the text, then the row. */
async function translated(text, target, api) {
  const res = await api.ai(AI.TRANSLATE, text, { language: target });

  return [
    { type: 'label', text: `${languageName(target)}${provenance(res)}` },
    { type: 'text', text: res.text, rich: true },
    {
      /*
       * Copy/Replace with the language picker on the end of the row, kept as
       * DOM because the picker is the one genuinely live control here: it holds
       * the current target and re-runs the whole translation when it changes.
       *
       * It also belongs *inside* the actions row rather than on a line of its
       * own, which is the other reason an `actions` block plus something else
       * cannot express it — `extra` takes buttons, and this is a <select>.
       */
      type: 'custom',
      note: 'Switching language needs the browser panel.',
      render: (api) => {
        const picker = el('select', {
          class: 'hh-select',
          'aria-label': 'Translate into'
        }, ...LANGUAGES.map(([code, name]) =>
          el('option', { value: code, selected: code === target }, name)
        ));

        picker.addEventListener('change', () => retranslate(text, picker.value, api, picker));

        return actionRow(res.text, api, [picker]);
      }
    }
  ];
}

/**
 * Switching language, in place.
 *
 * The picker replaces the whole detail view — spinner, then the new answer —
 * exactly as picking the row did the first time, so the blocks are rendered
 * through the same `blocks()` the async view used rather than rebuilt by hand.
 * `from` is any node inside that view; the container is the panel's, not ours,
 * so it is found rather than held.
 */
function retranslate(text, target, api, from) {
  const box = from.closest('.hh-detail');
  if (!box) return;

  const run = () => {
    replaceContent(box, spinner(`Translating into ${languageName(target)}…`));
    translated(text, target, api).then(
      (out) => replaceContent(box, el('div', {}, ...blocks(out, api))),
      (err) => replaceContent(box, api.errorFor(err, run))
    );
  };

  run();
}
