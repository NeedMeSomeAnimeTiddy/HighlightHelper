/**
 * QR code — local, no API.
 *
 * Mainly for getting a link off the screen and onto a phone, so a selection
 * that is a URL ranks near the top; anything else short enough to encode is
 * offered near the bottom of the menu.
 */

import { el, replaceContent, copyButton, note } from '../kit.js';
import { encode, toSvgElement, maxBytes } from '../qr.js';
import { looksLikeLanguage } from '../../common/text.js';

const MAX_CHARS = 400;
const MIN_TEXT_CHARS = 12;

const RE_URL = /^(?:https?:\/\/|www\.)\S+$/i;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Must start with "+" — otherwise a bare Unix timestamp reads as a phone number.
const RE_PHONE = /^\+\d[\d\s()-]{6,19}$/;

const MAX_TEXT_CHARS = 140;

function classify(text) {
  const t = text.trim();
  if (RE_URL.test(t)) return 'link';
  if (RE_EMAIL.test(t)) return 'email';
  if (RE_PHONE.test(t)) return 'phone';
  return 'text';
}

/**
 * Plain text is only worth a QR when it's the sort of thing you retype into a
 * phone — a wifi string, an address, a reference. A prose sentence is not, and
 * offering one would put a dead row in almost every menu, so anything ending
 * in sentence punctuation is skipped.
 */
function worthEncoding(text) {
  if (text.length < MIN_TEXT_CHARS || text.length > MAX_TEXT_CHARS) return false;
  if (/[.!?]["')\]]?$/.test(text)) return false;
  return looksLikeLanguage(text);
}

export default {
  id: 'qr',
  title: 'QR code',
  priority: 85,

  matches(text) {
    const t = text.trim();
    if (!t || t.length > MAX_CHARS) return null;
    // Byte length, not character length — an emoji is four bytes.
    if (new TextEncoder().encode(t).length > maxBytes()) return null;

    // Something you'd actually want on a phone. A QR of "$50", "#3f8ae0" or a
    // JWT is a row nobody will ever pick, and every menu would carry one.
    const kind = classify(t);
    if (kind === 'text' && !worthEncoding(t)) return null;

    return {
      kind,
      // A link is the main reason anyone wants this, so it jumps the queue.
      priority: kind === 'text' ? 85 : 35
    };
  },

  rows({ text, match }) {
    return [{
      key: 'qr',
      icon: 'qr',
      label: match.kind === 'link' ? 'QR code for this link' : 'QR code',
      detailTitle: 'QR code',
      detail: {
        kind: 'blocks',
        blocks: [{
          /*
           * A matrix of black and white squares, and nothing in the block
           * vocabulary draws one. There is no image or bitmap block, and
           * inventing one for the single view that needs it would be a block
           * type the other twenty never use.
           *
           * Encoding stays inside `render` on purpose. rows() runs for every
           * selection that matches, and Reed-Solomon over a few hundred bytes
           * is real work to do just to fill in a menu nobody has clicked yet —
           * so the code is built on the drill-in, as it always was, and that is
           * also where a failure to encode can still be shown as a message.
           */
          type: 'custom',
          note: 'A QR code is an image, so it needs the browser panel to draw it.',
          render: (api) => detailView(text.trim(), api)
        }]
      }
    }];
  }
};

/**
 * The container is plain: the panel's own `hh-detail` wrapper is around this
 * block already, and a second one would pad the view twice.
 */
function detailView(text, api) {
  const box = el('div', {});

  let result;
  try {
    result = encode(text);
  } catch (err) {
    replaceContent(box, note(String(err.message || err), 'hh-warn'));
    return box;
  }

  const frame = el('div', { class: 'hh-qr' }, toSvgElement(result.modules));

  replaceContent(box,
    frame,
    el('p', { class: 'hh-sub', text: `Version ${result.version} · ${result.size}×${result.size} modules · error correction M` }),
    el('div', { class: 'hh-row' }, copyButton(text, api))
  );
  return box;
}
