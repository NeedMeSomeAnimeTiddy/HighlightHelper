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

  rows({ match }) {
    return [{
      key: 'dictionary',
      icon: 'book',
      label: 'Define',
      value: match.word.toLowerCase(),
      detailTitle: match.word,
      // Wiktionary is a network call, and `rows` runs on every selection, so
      // the lookup waits for the click that opens the row.
      detail: {
        kind: 'async',
        loading: `Looking up “${match.word}”…`,
        run: (api) => defineBlocks(match.word, api)
      }
    }];
  }
};

async function defineBlocks(word, api) {
  const res = await api.send({
    type: MSG.DEFINE,
    word,
    language: api.settings?.language
  });
  // Thrown rather than caught: the async view turns a rejection into the
  // panel's own error box, with the retry already wired to run this again.
  if (!res?.ok) throw new Error(res?.error || 'Lookup failed');
  return res.entries?.length
    ? entryBlocks(word, res)
    : noEntryBlocks(word, res.links || []);
}

function entryBlocks(word, res) {
  const first = res.entries[0]?.definitions[0]?.text || '';

  return [
    { type: 'label', text: `Wiktionary · ${res.lang}${res.cached ? ' · cached' : ''}` },
    // Pronunciation is the browser's own speech synthesis, not a second
    // request — so the button only appears where there is a voice to use it.
    ...(canSpeak()
      ? [{
          type: 'buttons',
          items: [{ label: 'Say it', icon: 'speak', run: () => speak(word, res.lang) }]
        }]
      : []),

    // One heading per part of speech, then its senses. The numbering used to
    // come from an <ol>; as data it has to be in the text, because a list is
    // not something the block vocabulary can describe.
    ...res.entries.flatMap((entry) => [
      { type: 'label', text: entry.partOfSpeech || '—' },
      ...entry.definitions.flatMap((def, i) => [
        { type: 'text', text: `${i + 1}. ${def.text}` },
        ...(def.example ? [{ type: 'sub', text: def.example }] : [])
      ])
    ]),

    { type: 'buttons', items: [{ copy: first }] },

    {
      /*
       * Synonyms are a second request, so they wait for a second click. Most
       * lookups are "what does this mean", not "what else could I have said".
       *
       * A rejection is left to travel: the disclosure turns it into the
       * panel's own error box rather than one built here.
       */
      type: 'disclosure',
      label: 'Synonyms',
      icon: 'book',
      busy: 'Looking for synonyms…',
      run: async (api) => {
        const res = await api.send({ type: MSG.SYNONYMS, word, language: api.settings?.language });
        if (!res?.ok) throw new Error(res?.error || 'Lookup failed');
        if (!res.words?.length) return [{ type: 'note', text: 'No synonyms found.' }];

        const words = res.words.join(', ');
        return [
          { type: 'label', text: 'Synonyms' },
          { type: 'text', text: words },
          { type: 'buttons', items: [{ copy: words }] }
        ];
      }
    }
  ];
}

function noEntryBlocks(word, links) {
  return [
    { type: 'note', text: `No dictionary entry for “${word}”.` },
    {
      // `run` is a callback, not a node, so the fallbacks stay describable: a
      // native renderer draws its own buttons and calls back in to open the tab.
      type: 'buttons',
      items: links.map((l) => ({ label: l.label, run: () => openTab(l.url) }))
    }
  ];
}

function openTab(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
