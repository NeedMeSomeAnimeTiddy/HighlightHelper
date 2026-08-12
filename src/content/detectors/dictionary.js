/**
 * Dictionary — what a single word means, for free.
 *
 * Selecting one ordinary word used to offer "Explain this", which spends a
 * model call answering a question a dictionary answers better, faster and for
 * nothing. So this ranks ahead of the jargon detector for anything that looks
 * like a plain word, and jargon keeps the acronyms and the multi-word phrases
 * it is actually good at.
 *
 * Definitions come from Wiktionary, synonyms from Datamuse, both via the worker
 * — no page policy can block them there, and it is where every other network
 * call in this extension already lives.
 *
 * Pronunciation is the read-aloud tool, not a second request. The browser can
 * already say the word.
 */

import { el, btn, note, spinner, replaceContent, errorBox, copyButton } from '../kit.js';
import { MSG } from '../../common/constants.js';
import { speak, canSpeak } from '../speech.js';

const MAX_CHARS = 32;

/**
 * One word, letters only.
 *
 * Hyphens and apostrophes are allowed because "self-evident" and "o'clock" are
 * dictionary words; digits and symbols are not, because those selections belong
 * to a detector that recognised something specific.
 */
const WORD = /^[\p{L}][\p{L}'’-]*$/u;

export default {
  id: 'dictionary',
  title: 'Dictionary',
  // Ahead of jargon (40), so a plain word gets the free answer first.
  priority: 38,

  matches(text) {
    const t = text.trim();
    if (!t || t.length > MAX_CHARS) return null;
    if (!WORD.test(t)) return null;
    // A single letter is never a dictionary lookup worth making.
    if (t.length < 2) return null;
    return { word: t };
  },

  items({ match }) {
    return [{
      key: 'dictionary',
      icon: 'book',
      label: 'Define',
      value: match.word.toLowerCase(),
      detailTitle: match.word,
      open: (api) => defineView(match.word, api)
    }];
  }
};

function defineView(word, api) {
  const box = el('div', { class: 'hh-detail' });

  const run = async () => {
    replaceContent(box, spinner(`Looking up “${word}”…`));
    try {
      const res = await api.send({
        type: MSG.DEFINE,
        word,
        language: api.settings?.language
      });
      if (!res?.ok) throw new Error(res?.error || 'Lookup failed');
      replaceContent(box, res.entries?.length
        ? entriesView(word, res, api)
        : noEntry(word, res.links || []));
    } catch (err) {
      replaceContent(box, errorBox(String(err.message || err), { onRetry: run }));
    }
    api.resize?.();
  };

  run();
  return box;
}

function entriesView(word, res, api) {
  const wrap = el('div', {});

  const header = el('div', { class: 'hh-row' },
    el('span', { class: 'hh-label', text: `Wiktionary · ${res.lang}${res.cached ? ' · cached' : ''}` })
  );
  if (canSpeak()) {
    header.append(btn('Say it', () => speak(word, res.lang), { icon: 'speak' }));
  }
  wrap.append(header);

  for (const entry of res.entries) {
    wrap.append(el('div', { class: 'hh-label hh-pos', text: entry.partOfSpeech || '—' }));
    const list = el('ol', { class: 'hh-defs' });
    for (const def of entry.definitions) {
      const li = el('li', {}, el('span', { text: def.text }));
      if (def.example) li.append(el('em', { class: 'hh-sub', text: def.example }));
      list.append(li);
    }
    wrap.append(list);
  }

  const first = res.entries[0]?.definitions[0]?.text || '';
  const actions = el('div', { class: 'hh-row' }, copyButton(first, api));
  wrap.append(actions);

  // Synonyms are a second request, so they wait for a second click. Most
  // lookups are "what does this mean", not "what else could I have said".
  synonymButton(word, api, wrap);

  return wrap;
}

function synonymButton(word, api, host) {
  const panel = el('div', {});
  const button = btn('Synonyms', async () => {
    button.replaceWith(panel);
    replaceContent(panel, spinner('Looking for synonyms…'));
    try {
      const res = await api.send({ type: MSG.SYNONYMS, word, language: api.settings?.language });
      if (!res?.ok) throw new Error(res?.error || 'Lookup failed');
      replaceContent(panel, res.words?.length
        ? el('div', {},
            el('div', { class: 'hh-label', text: 'Synonyms' }),
            el('div', { class: 'hh-text', text: res.words.join(', ') }),
            el('div', { class: 'hh-row' }, copyButton(res.words.join(', '), api)))
        : note('No synonyms found.'));
    } catch (err) {
      replaceContent(panel, errorBox(String(err.message || err)));
    }
    api.resize?.();
  }, { icon: 'book' });

  host.append(el('div', { class: 'hh-row' }, button));
  return button;
}

function noEntry(word, links) {
  return el('div', {},
    note(`No dictionary entry for “${word}”.`),
    el('div', { class: 'hh-row' },
      ...links.map((l) => btn(l.label, () => window.open(l.url, '_blank', 'noopener,noreferrer'))))
  );
}
