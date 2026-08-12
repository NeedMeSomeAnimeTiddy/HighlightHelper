/**
 * Definitions and synonyms for a single word.
 *
 * The gap this fills: selecting one ordinary English word used to offer
 * "Explain this", which costs a model call to answer a question a dictionary
 * answers better and for free. Google Dictionary's four million users are
 * entirely this feature.
 *
 * Two keyless sources, both optional to each other:
 *
 *   Wiktionary  definitions, parts of speech, examples. Wikimedia infrastructure,
 *               which the "Find a source" lookup already talks to, so the same
 *               Api-User-Agent courtesy applies.
 *   Datamuse    synonyms. Free, no key, no account. Fetched only when asked.
 *
 * Pronunciation deliberately uses no API at all — speechSynthesis is in the
 * browser already, so the read-aloud tool covers it and there is no second
 * request to make.
 */

import { stripTags } from './wikipedia.js';
import { LANGUAGES } from '../common/languages.js';

const TIMEOUT_MS = 8000;
/** Enough to be useful, few enough that the panel stays a panel. */
const MAX_ENTRIES = 4;
const MAX_DEFINITIONS = 3;
const MAX_SYNONYMS = 12;

const API_UA = 'HighlightHelper/0.1.0 (Chrome extension; dictionary lookup for highlighted text)';

const KNOWN = new Set(LANGUAGES.map(([code]) => code.split('-')[0].toLowerCase()));

/** Wiktionary subdomains use the bare language code, same as Wikipedia. */
export function wiktLang(language) {
  const base = String(language || 'en').split('-')[0].toLowerCase();
  return KNOWN.has(base) ? base : 'en';
}

export function definitionUrl(lang, word) {
  return `https://${lang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
}

export function synonymUrl(word) {
  return `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=${MAX_SYNONYMS}`;
}

async function getJson(url, { headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', ...headers }
    });
    // 404 is the ordinary "no such word" answer, not a failure to report.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The dictionary took too long to answer');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reshapes Wiktionary's payload into something the panel can render.
 *
 * It is keyed by language code and every definition is a fragment of HTML, so
 * the tags come out here rather than in the content script — the panel sets
 * textContent and would otherwise display the markup literally.
 *
 * Only the requested language is kept. A Wiktionary page for an English word
 * usually also carries its Latin, Dutch and Middle French entries, which is not
 * what anyone highlighting a word on an English page wanted.
 */
export function shapeDefinitions(payload, lang) {
  const entries = payload?.[lang];
  if (!Array.isArray(entries)) return [];

  return entries
    .slice(0, MAX_ENTRIES)
    .map((entry) => ({
      partOfSpeech: stripTags(entry?.partOfSpeech || ''),
      definitions: (entry?.definitions || [])
        .slice(0, MAX_DEFINITIONS)
        .map((d) => ({
          text: stripTags(d?.definition || ''),
          example: stripTags((d?.parsedExamples?.[0]?.example) || d?.examples?.[0] || '')
        }))
        .filter((d) => d.text)
    }))
    .filter((e) => e.definitions.length);
}

/** Definitions for one word, or an empty list when there is no entry. */
export async function define(word, language) {
  const lang = wiktLang(language);
  const payload = await getJson(definitionUrl(lang, word), { 'Api-User-Agent': API_UA });
  return { lang, entries: shapeDefinitions(payload, lang) };
}

/**
 * Synonyms, English only.
 *
 * Datamuse is an English corpus, so offering it for a French word would return
 * nothing and look broken. Better to not offer it.
 */
export async function synonyms(word, language) {
  if (wiktLang(language) !== 'en') return [];
  const payload = await getJson(synonymUrl(word));
  if (!Array.isArray(payload)) return [];
  return payload.map((r) => String(r?.word || '')).filter(Boolean).slice(0, MAX_SYNONYMS);
}

/** Where to read more, when there is no entry — a real link, never a made-up one. */
export function dictionaryLinks(word, language) {
  const lang = wiktLang(language);
  return [
    { label: 'Wiktionary', url: `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(word)}` },
    { label: 'Search Wiktionary', url: `https://${lang}.wiktionary.org/w/index.php?search=${encodeURIComponent(word)}` }
  ];
}
