/**
 * Wikipedia lookup — a real reference for a term, with a real URL.
 *
 * This exists because the model cannot cite anything. DeepSeek has no web
 * access, so asking it for sources produces plausible, well-formatted, entirely
 * invented URLs — worse than offering nothing, because a fabricated citation
 * reads as authoritative. So the "source" button does not ask the model at all:
 * it looks the term up in an encyclopedia and hands back what that says.
 *
 * The result is deliberately presented next to the explanation rather than
 * underneath it as a citation. It corroborates or contradicts; it is not
 * evidence for what the model said.
 *
 * Keyless, no account, and run in the worker so no page policy can block it.
 */

import { LANGUAGES } from '../common/languages.js';

const TIMEOUT_MS = 8000;
/**
 * Search wide, fetch narrow.
 *
 * The top few hits for an ambiguous term often don't contain the sense meant —
 * Wikipedia's search for "SLA" returns Symbionese Liberation Army and Patty
 * Hearst before Service-level agreement. Ranking can't fix a pool that lacks
 * the right article, so the pool is wide; but a summary costs a request each,
 * so only the best few are actually fetched.
 */
const SEARCH_RESULTS = 10;
const SUMMARIES = 3;

/**
 * Wikipedia subdomains use the bare language code.
 *
 * Checked against the languages the extension actually offers rather than a
 * shape test: "not-a-language" is shaped like a code and would send the lookup
 * to a subdomain that doesn't exist.
 */
const KNOWN = new Set(LANGUAGES.map(([code]) => code.split('-')[0].toLowerCase()));

export function wikiLang(language) {
  const base = String(language || 'en').split('-')[0].toLowerCase();
  return KNOWN.has(base) ? base : 'en';
}

export function searchUrl(lang, term) {
  return `https://${lang}.wikipedia.org/w/rest.php/v1/search/page` +
    `?q=${encodeURIComponent(term)}&limit=${SEARCH_RESULTS}`;
}

/** Search excerpts come back with <span class="searchmatch"> markup. */
export function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function summaryUrl(lang, key) {
  return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/` +
    encodeURIComponent(key);
}

/**
 * Is this summary worth showing? Disambiguation pages list a dozen unrelated
 * meanings and answer nothing, and a stub with two words of extract is noise.
 */
export function isUsable(summary) {
  if (!summary || summary.type === 'disambiguation') return false;
  const extract = String(summary.extract || '').trim();
  return extract.length >= 40;
}

/**
 * Wikimedia asks every client to identify itself and rate-limits those that
 * don't. `User-Agent` is a forbidden header in a browser, so they accept
 * `Api-User-Agent` from browser-based callers instead.
 */
const API_UA = 'HighlightHelper/0.1.0 (Chrome extension; term lookup for highlighted text)';

/**
 * Returns parsed JSON, or null when the resource genuinely isn't there (404).
 *
 * Anything else throws. The distinction matters because the caller caches the
 * result: "this term has no article" is worth remembering for a week, whereas
 * a rate-limit or a dropped connection must not be, or one bad moment would
 * leave the button permanently answering "no source found".
 */
async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Api-User-Agent': API_UA }
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? 'Wikipedia took too long to answer'
      : "Couldn't reach Wikipedia");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('Wikipedia is rate-limiting. Try again shortly.');
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);

  try {
    return await res.json();
  } catch {
    throw new Error('Wikipedia sent a response we could not read');
  }
}

const STOPWORDS = new Set(('the of and to a in that is it for on with as was be this are at by ' +
  'not from have but you an or if which used using such other more into can also its').split(' '));

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu)
    ?.filter((w) => !STOPWORDS.has(w)) || [];
}

/**
 * Orders candidates by how much they look like what was being talked about.
 *
 * Search alone is not enough: "SLA" returns Symbionese Liberation Army before
 * Service-level agreement, and on a page about uptime that is simply the wrong
 * article. The explanation already produced for the term is a free description
 * of the intended sense, so candidates are scored on word overlap with it.
 *
 * Exported and pure so the ranking can be tested without the network.
 */
/**
 * Wikipedia's own relevance ranking, kept as a prior rather than discarded.
 *
 * Word overlap alone is gameable by an article that merely repeats the phrase:
 * "Globule (CDN)" is described as a "Discontinued content delivery network",
 * which out-scores the actual Content delivery network article even though
 * Wikipedia ranked that one first. The prior is weighted to be worth roughly
 * two or three title matches — enough that a marginal overlap edge cannot
 * overturn search, not enough to hold down a clearly better match.
 */
const PRIOR_SPAN = 10;
const PRIOR_WEIGHT = 0.8;

export function rankByContext(candidates, context) {
  const wanted = new Set(tokens(context));
  if (!wanted.size) return [...candidates];

  const score = (c, i) => {
    const body = new Set(tokens(`${c.title} ${c.description} ${c.extract}`));
    let hits = 0;
    for (const w of body) if (wanted.has(w)) hits++;
    // A match in the title says far more than one buried in the extract.
    const titleHits = tokens(`${c.title} ${c.description}`)
      .filter((w) => wanted.has(w)).length;
    const prior = Math.max(0, PRIOR_SPAN - i) * PRIOR_WEIGHT;
    return hits + titleHits * 3 + prior;
  };

  return [...candidates]
    .map((c, i) => ({ c, i, s: score(c, i) }))
    .sort((a, b) => b.s - a.s || a.i - b.i) // ties keep Wikipedia's own order
    .map((x) => x.c);
}

async function candidatesIn(lang, term, context) {
  const found = await getJson(searchUrl(lang, term));
  const pages = found?.pages;
  if (!Array.isArray(pages) || !pages.length) return [];

  // Rank on what search already gave us, so the summary requests are spent on
  // the articles most likely to be the one meant.
  const ranked = rankByContext(
    pages.map((p) => ({ ...p, extract: stripTags(p.excerpt) })),
    context
  );

  const out = [];
  for (const page of ranked) {
    if (out.length >= SUMMARIES) break;
    const key = page.key || page.title;
    if (!key) continue;
    let summary;
    try {
      summary = await getJson(summaryUrl(lang, key));
    } catch {
      continue; // one bad candidate shouldn't sink the whole lookup
    }
    if (!isUsable(summary)) continue;
    out.push({
      title: summary.title || page.title,
      description: summary.description || '',
      extract: summary.extract,
      url: summary.content_urls?.desktop?.page ||
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(key)}`,
      lang
    });
  }
  return out;
}

/**
 * Looks `term` up, preferring the user's own language and falling back to
 * English — smaller Wikipedias miss a lot of technical terms.
 *
 * Returns every usable candidate, best first, so the panel can offer the
 * alternatives rather than silently committing to one reading of an ambiguous
 * term. Empty when there genuinely is no article. Throws if Wikipedia could
 * not be reached, which the caller must not cache.
 */
export async function lookup(term, language, context = '') {
  const primary = wikiLang(language);
  const langs = primary === 'en' ? ['en'] : [primary, 'en'];
  for (const lang of langs) {
    // Already in ranked order — summaries are fetched best-first. Ranking a
    // second time would apply the search prior twice.
    const found = await candidatesIn(lang, term, context);
    if (found.length) return found;
  }
  return [];
}

/** Real search URLs, offered when there is no article to point at. */
export function searchLinks(term, language) {
  const q = encodeURIComponent(term);
  return [
    { label: 'Wikipedia search', url: `https://${wikiLang(language)}.wikipedia.org/w/index.php?search=${q}` },
    { label: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${q}` },
    { label: 'Google', url: `https://www.google.com/search?q=${q}` }
  ];
}
