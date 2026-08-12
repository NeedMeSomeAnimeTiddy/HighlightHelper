/**
 * Search with… — hand the selection to somewhere else.
 *
 * The one thing every tool in this space has and this one did not. It costs
 * nothing, needs no permission and no key: a search is `window.open` with the
 * selection in the query string.
 *
 * One row that drills into the engines rather than one row per engine, for the
 * same reason text tools works that way — four search engines at the top of the
 * menu would push the detector that actually recognised something below the
 * fold.
 *
 * It matches almost anything, so it is ranked just above the text tools
 * catch-all and below everything specific.
 */

import { el, menu, btn, note, replaceContent } from '../kit.js';
import { resolveEngines, searchUrlFor } from '../../common/searchengines.js';
import { looksLikeLanguage } from '../../common/text.js';

const MIN_CHARS = 2;
/** Past this it is a passage, not a query, and every engine will truncate it. */
const MAX_CHARS = 300;
const PREVIEW_CHARS = 28;

export default {
  id: 'search',
  title: 'Search with…',
  // 86 rather than 85: qr already holds 85, and a tie would leave the order of
  // two rows depending on how the sort happened to break it.
  priority: 86,

  matches(text, settings) {
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_CHARS) return null;

    // "$50", "#3f8ae0", "0x1F4" and a JWT all already have a detector that
    // recognised them and answered. A second row offering to throw the same
    // string at Google is noise, and the same gate keeps text tools off them.
    if (!looksLikeLanguage(t, { minLetterRatio: 0.45 })) return null;

    const engines = resolveEngines(settings);
    return engines.length ? { engines } : null;
  },

  items({ text, match }) {
    const query = text.trim().replace(/\s+/g, ' ');

    return [{
      key: 'search',
      icon: 'search',
      label: 'Search with…',
      value: match.engines.length > 1 ? `${match.engines.length} sites` : match.engines[0].name,
      detailTitle: 'Search with',
      open: (api) => menu(
        match.engines.map((engine) => ({
          key: `search:${engine.id}`,
          icon: 'search',
          label: engine.name,
          value: preview(query),
          detailTitle: engine.name,
          open: () => openView(engine, query)
        })),
        api
      )
    }];
  }
};

function preview(q) {
  return q.length > PREVIEW_CHARS ? `${q.slice(0, PREVIEW_CHARS - 1)}…` : q;
}

/**
 * Drilling in opens the tab, rather than the row opening it directly.
 *
 * Every other row in the panel drills into a view, and a row that instead threw
 * a new tab in front of you would be the one exception. This way the tab opens
 * on a second, deliberate click and the view says exactly where it is going —
 * which matters more here than elsewhere, because this is the one action that
 * hands your selection to someone else.
 */
function openView(engine, query) {
  const box = el('div', { class: 'hh-detail' });
  const url = searchUrlFor(engine.url, query);

  if (!url) {
    return replaceContent(box, note(`${engine.name} has no {q} in its URL, so there is nowhere to put the selection.`, 'hh-warn'));
  }

  return replaceContent(box,
    el('div', { class: 'hh-label', text: engine.name }),
    el('div', { class: 'hh-text', text: query }),
    el('div', { class: 'hh-row' },
      btn(`Open ${engine.name}`, () => {
        window.open(url, '_blank', 'noopener,noreferrer');
      }, { variant: 'hh-primary', icon: 'search' })
    ),
    note('This sends the selected text to that site.')
  );
}
