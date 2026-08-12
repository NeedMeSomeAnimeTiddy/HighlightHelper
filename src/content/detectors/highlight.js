/**
 * Highlight this — the feature the extension is named after.
 *
 * Saves the selection, paints it, and finds it again on the next visit. Local,
 * free, no account, and nothing leaves the machine.
 *
 * The row changes depending on whether this text is already highlighted, which
 * is the only affordance available: a painted range is not an element, so there
 * is nothing to click on the page itself. Re-selecting the text is how you get
 * back to a highlight you already made.
 */

import { el, btn, note, replaceContent, glyph } from '../kit.js';
import { looksLikeLanguage } from '../../common/text.js';
import { COLORS, DEFAULT_COLOR, save, remove, update } from '../../common/highlights-store.js';
import { contextFor } from '../locate.js';
import * as painter from '../highlights.js';

const MIN_CHARS = 4;
const MAX_CHARS = 2000;

export default {
  id: 'highlight',
  title: 'Highlight',
  // Above the other catch-alls: when you have selected a sentence to highlight,
  // that is what you came for.
  priority: 60,

  matches(text) {
    if (!painter.isSupported()) return null;
    if (typeof location === 'undefined') return null;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;

    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_CHARS) return null;
    // Same gate as the other shape-matched tools: a hex colour or a JWT already
    // has a detector that answered.
    if (!looksLikeLanguage(t, { minLetterRatio: 0.45 })) return null;

    return { existing: painter.findByText(t) };
  },

  items({ text, match }) {
    const existing = match.existing;
    return [{
      key: 'highlight',
      icon: 'highlight',
      label: existing ? 'Highlighted' : 'Highlight this',
      value: existing ? COLORS.find((c) => c.id === existing.color)?.name : null,
      detailTitle: 'Highlight',
      open: (api) => highlightView(text, existing, api)
    }];
  }
};

function highlightView(text, existing, api) {
  const box = el('div', { class: 'hh-detail' });
  let record = existing;

  const render = () => {
    replaceContent(box,
      el('div', { class: 'hh-label', text: record ? 'Saved' : 'Pick a colour' }),
      swatches(record?.color || DEFAULT_COLOR, async (color) => {
        record = record
          ? await update(location.href, record.id, { color })
          : await create(text, color, api);
        if (record) {
          painter.recolour(record.id, color);
          if (!existing) painter.add(record);
        }
        render();
      }),
      record ? noteField(record, api) : null,
      record
        ? el('div', { class: 'hh-row' },
            btn('Remove highlight', async () => {
              await remove(location.href, record.id);
              painter.drop(record.id);
              record = null;
              render();
            }, { icon: 'warn' }))
        : null,
      note(record
        ? 'Saved on this machine. It comes back when you revisit this page.'
        : 'Saved locally — no account, and nothing is sent anywhere.')
    );
    api.resize?.();
  };

  render();
  return box;
}

/**
 * Captures the surrounding words at save time, not at restore time.
 *
 * They are what lets the highlight survive the page gaining a paragraph
 * somewhere above it, and they can only be read while the text is still where
 * the user found it.
 */
async function create(text, color, api) {
  let context = { prefix: '', suffix: '' };
  try {
    const selection = window.getSelection();
    if (selection?.rangeCount) context = contextFor(selection.getRangeAt(0));
  } catch {
    /* no live selection any more — the text alone still anchors most pages */
  }

  return save({
    url: location.href,
    title: api.context?.title || document.title,
    text: text.trim(),
    prefix: context.prefix,
    suffix: context.suffix,
    color
  });
}

function swatches(current, onPick) {
  const row = el('div', { class: 'hh-row hh-swatches' });
  for (const colour of COLORS) {
    const button = el('button', {
      class: `hh-swatch hh-swatch--${colour.id}${colour.id === current ? ' hh-swatch--on' : ''}`,
      type: 'button',
      title: colour.name,
      'aria-label': colour.name,
      onclick: () => onPick(colour.id)
    });
    if (colour.id === current) button.append(glyph('check', 'hh-glyph hh-swatch-tick'));
    row.append(button);
  }
  return row;
}

/** A note, saved as you leave the field rather than on every keystroke. */
function noteField(record, api) {
  const input = el('textarea', {
    class: 'hh-note-input',
    rows: '2',
    placeholder: 'Add a note…',
    onchange: () => update(location.href, record.id, { note: input.value.trim() })
  });
  input.value = record.note || '';
  input.addEventListener('blur', () => {
    update(location.href, record.id, { note: input.value.trim() });
  });
  // The panel captures arrow keys for menu navigation; a textarea needs them.
  input.addEventListener('keydown', (e) => e.stopPropagation());
  api.resize?.();
  return input;
}
