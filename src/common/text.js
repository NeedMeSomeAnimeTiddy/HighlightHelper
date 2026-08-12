/**
 * Shared "is this actually prose?" helpers.
 *
 * The catch-all detectors (translate, rewrite, text tools) match on shape
 * rather than on a specific pattern, so without these they cheerfully offer to
 * translate a hex colour or rewrite a JWT. A specific detector has usually
 * already answered those selections; a second, useless row is pure noise.
 */

/** Share of non-space characters that are letters. 0 when there are none. */
export function letterRatio(text) {
  const solid = text.replace(/\s/g, '');
  if (!solid.length) return 0;
  const letters = solid.match(/\p{L}/gu);
  return letters ? letters.length / solid.length : 0;
}

/** Whitespace-separated word count. */
export function wordCount(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * True when `text` plausibly is human language rather than an identifier,
 * token, hash or colour code.
 *
 * A long unbroken run of characters with no whitespace is the giveaway: real
 * sentences have spaces, and a single word that long is a token, not a word.
 */
export function looksLikeLanguage(text, { minLetterRatio = 0.5, maxLoneWord = 30 } = {}) {
  const t = text.trim();
  if (!t) return false;
  if ((t.match(/\p{L}/gu) || []).length < 2) return false;
  if (letterRatio(t) < minLetterRatio) return false;
  if (!/\s/.test(t) && t.length > maxLoneWord) return false;
  return true;
}

const MAX_TOPICS = 3;
const MAX_TOPIC_CHARS = 60;

/**
 * Parses the model's topic list into search terms.
 *
 * Defensive because the output feeds a lookup, not a citation: bullets,
 * numbering and stray quotes get stripped, "NONE" means it found nothing worth
 * looking up, and anything sentence-length is dropped — a model that ignored
 * the instruction and wrote prose would otherwise become a nonsense query.
 */
export function parseTopics(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '')  // bullets and numbering
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')     // wrapping quotes
      .trim())
    .filter(Boolean);

  if (lines.length === 1 && /^none\.?$/i.test(lines[0])) return [];

  const seen = new Set();
  const topics = [];
  for (const line of lines) {
    if (/^none\.?$/i.test(line)) continue;
    if (line.length > MAX_TOPIC_CHARS) continue;
    if (line.split(/\s+/).length > 6) continue;   // a sentence, not a topic
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(line);
    if (topics.length >= MAX_TOPICS) break;
  }
  return topics;
}

/** "1 word" / "3 words" — small enough to inline, common enough to share. */
export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
