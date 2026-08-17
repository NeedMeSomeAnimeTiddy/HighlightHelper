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

import { linkToSelection } from '../anchor.js';
import { ordinalOfSelection } from '../locate.js';
import { looksLikeLanguage } from '../../common/text.js';

const MIN_CHARS = 3;
/** Longer than this and the fragment is a paragraph; anchor.js refuses anyway. */
const MAX_CHARS = 600;

function openTab(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

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

  rows({ text }) {
    return [{
      key: 'link',
      icon: 'link',
      label: 'Link to this text',
      detailTitle: 'Link to this text',
      // Spinner first, then the answer: an async view, because working out
      // whether the text can be pinned down means walking the whole document.
      detail: {
        kind: 'async',
        loading: 'Finding this text on the page…',
        /*
         * The turn of the event loop is load-bearing, not ceremony.
         *
         * Walking the document is expensive, and the work happens once, here,
         * after the click — never in matches(). Yielding first is what lets the
         * spinner actually reach the screen before the walk blocks the thread;
         * resolving on a microtask would paint the finished view and nothing else.
         */
        run: () => new Promise((resolve) => {
          setTimeout(() => resolve(linkBlocks(text)), 0);
        })
      }
    }];
  }
};

function linkBlocks(text) {
  let url = null;
  try {
    /*
     * Which occurrence of the text was selected.
     *
     * Without it the link anchors to the first one on the page — fine for a
     * unique sentence, and quietly wrong for a repeated phrase: selecting the
     * fourth "however" produced a valid link to the first.
     *
     * An ordinal rather than a position, because the two files measure text
     * differently — anchor.js collapses whitespace, locate.js removes it —
     * and "which one" survives that where "how far in" would not.
     */
    const selection = window.getSelection();
    const ordinal = selection?.rangeCount
      ? ordinalOfSelection(text, selection.getRangeAt(0))
      : 0;

    url = linkToSelection(text, { ordinal });
  } catch (err) {
    console.warn('[Highlight Helper] could not build a text fragment:', err);
  }

  return url ? found(url) : notFound();
}

function found(url) {
  return [
    { type: 'label', text: 'Link' },
    { type: 'text', text: url },
    {
      // `copy` is named rather than left as another callback so the button can
      // confirm on itself, and so a native renderer gets a real copy affordance.
      type: 'buttons',
      items: [
        { copy: url },
        { label: 'Open it', icon: 'link', run: () => openTab(url) }
      ]
    },
    { type: 'note', text: 'Opens the page scrolled to this text, with it highlighted. Works in Chrome, Edge and Safari.' }
  ];
}

/**
 * Refusing is a real answer here.
 *
 * A fragment that resolves to the wrong paragraph looks like it worked, which
 * is worse than not offering one — so when the text cannot be pinned down
 * uniquely, say so and offer the plain page link instead of guessing.
 */
function notFound() {
  const plain = location.href.split('#')[0];
  return [
    { type: 'note', text: "This text appears in too many places on the page to link to precisely — a link would land on the wrong one." },
    { type: 'buttons', items: [{ copy: plain }] },
    { type: 'note', text: 'That copies the plain page link instead.' }
  ];
}
