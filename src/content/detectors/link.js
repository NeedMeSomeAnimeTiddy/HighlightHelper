/**
 * Copy link to highlight — a URL that scrolls to and highlights this exact text.
 *
 * `#:~:text=…`, the text fragment. Chrome has this natively but buried in a
 * right-click submenu, and PopClip ships it as one of its most-used extensions.
 * It is local, free, and the single most useful thing you can do with a
 * selection you want to point somebody at.
 *
 * The work is all in ../anchor.js, which is deliberately shared: re-finding a
 * saved highlight on a page that has changed is the same problem, and gets the
 * same answer.
 *
 * The `matches` gate here is cheap on purpose. Working out whether the text can
 * actually be pinned down needs the page's whole text, which forces a layout —
 * far too expensive to do on every selection. So `matches` only checks what is
 * free, and the real work happens on the click.
 */

import { el, btn, note, copyButton, replaceContent, spinner } from '../kit.js';
import { linkToSelection } from '../anchor.js';
import { collectText, offsetOfRange } from '../locate.js';
import { looksLikeLanguage } from '../../common/text.js';

const MIN_CHARS = 3;
/** Longer than this and the fragment is a paragraph; anchor.js refuses anyway. */
const MAX_CHARS = 600;

export default {
  id: 'link',
  title: 'Link to this text',
  // Above the catch-alls, below anything that recognised the content itself.
  priority: 80,

  matches(text) {
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_CHARS) return null;

    // A fragment only means anything on a real page at a real URL. Extension
    // pages, files and about:blank are all out — as is any context with no
    // document at all, which is what the tests run in.
    if (typeof location === 'undefined') return null;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;

    // A text fragment is for prose you want to point somebody at. On "$50" or
    // "#3f8ae0" a specific detector has already answered, and a second row
    // offering to link to it is the same noise text tools is kept away from.
    // The right-click menu still reaches this tool for anything, by name.
    if (!looksLikeLanguage(t, { minLetterRatio: 0.45 })) return null;

    return { host: location.hostname };
  },

  items({ text }) {
    return [{
      key: 'link',
      icon: 'link',
      label: 'Link to this text',
      detailTitle: 'Link to this text',
      open: (api) => linkView(text, api)
    }];
  }
};

function linkView(text, api) {
  const box = el('div', { class: 'hh-detail' });
  replaceContent(box, spinner('Finding this text on the page…'));

  // Walking the document is expensive, so it happens once, here, after the
  // click — never in matches().
  setTimeout(() => {
    let url = null;
    try {
      /*
       * The page's text and the position of the selection within it come from
       * the same walk, so they share one coordinate system.
       *
       * Without the position, the link anchors to the first occurrence of the
       * text — fine for a unique sentence, and quietly wrong for a repeated
       * phrase: selecting the fourth "however" produced a link to the first.
       */
      const index = collectText(document.body);
      const selection = window.getSelection();
      const at = selection?.rangeCount
        ? offsetOfRange(index, selection.getRangeAt(0))
        : null;

      url = linkToSelection(text, { pageText: index.text, at });
    } catch (err) {
      console.warn('[Highlight Helper] could not build a text fragment:', err);
    }

    replaceContent(box, url ? found(url, api) : notFound(api));
    api.resize?.();
  }, 0);

  return box;
}

function found(url, api) {
  return el('div', {},
    el('div', { class: 'hh-label', text: 'Link' }),
    el('div', { class: 'hh-text', text: url }),
    el('div', { class: 'hh-row' },
      copyButton(url, api),
      btn('Open it', () => window.open(url, '_blank', 'noopener,noreferrer'), { icon: 'link' })
    ),
    note('Opens the page scrolled to this text, with it highlighted. Works in Chrome, Edge and Safari.')
  );
}

/**
 * Refusing is a real answer here.
 *
 * A fragment that resolves to the wrong paragraph looks like it worked, which
 * is worse than not offering one — so when the text cannot be pinned down
 * uniquely, say so and offer the plain page link instead of guessing.
 */
function notFound(api) {
  const plain = location.href.split('#')[0];
  return el('div', {},
    note("This text appears in too many places on the page to link to precisely — a link would land on the wrong one."),
    el('div', { class: 'hh-row' }, copyButton(plain, api)),
    note('That copies the plain page link instead.')
  );
}
