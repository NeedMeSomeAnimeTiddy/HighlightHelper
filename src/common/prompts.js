/**
 * The prompts, and the tidy-up every model answer goes through.
 *
 * These live in common/ because two providers answer from them: the DeepSeek
 * client in the service worker, and Chrome's on-device model in the content
 * script. One selection should read the same whichever one served it, and the
 * only way to guarantee that is for there to be one set of words.
 */

import { AI, ERR } from './constants.js';
import { languageName } from './languages.js';

/**
 * Builds the system prompt + user message for an action.
 * Every prompt insists on a bare answer so the popup can show it verbatim.
 */
export function buildPrompt(action, text, options = {}) {
  const lang = languageName(options.language || 'en');

  switch (action) {
    case AI.EXPLAIN: {
      const where = options.pageContext
        ? ` The term was highlighted on a page titled "${options.pageContext}".`
        : '';
      return {
        system:
          'You are a plain-English glossary. Given a term, acronym, or short phrase, ' +
          'reply with ONE sentence of at most 25 words explaining what it means. ' +
          'Expand acronyms first, like "CDN (Content Delivery Network) is …". ' +
          `Answer in ${lang}. No preamble, no quotes, no markdown, no follow-up questions.` +
          where,
        user: text,
        maxTokens: 120,
        temperature: 0.2
      };
    }

    case AI.TRANSLATE:
      return {
        system:
          `Translate the user's text into ${lang}. Reply with the translation only — ` +
          'no quotes, no romanisation, no explanation, no alternatives. ' +
          'Preserve line breaks, names, numbers, and formatting.',
        user: text,
        maxTokens: Math.min(2000, Math.ceil(text.length / 2) + 200),
        temperature: 0.2
      };

    case AI.FIX:
      return {
        system:
          "Correct spelling, grammar, and punctuation in the user's text. " +
          'Keep the original meaning, voice, and formatting. Do not rephrase for style. ' +
          'If the text is already correct, return it unchanged. Reply with the corrected text only.',
        user: text,
        maxTokens: Math.min(2000, Math.ceil(text.length / 2) + 200),
        temperature: 0.1
      };

    case AI.SHORTER:
      return {
        system:
          "Rewrite the user's text to be noticeably shorter while keeping every essential " +
          'point. Keep the original language. Reply with the rewritten text only.',
        user: text,
        maxTokens: Math.min(2000, Math.ceil(text.length / 3) + 150),
        temperature: 0.4
      };

    case AI.FORMAL:
      return {
        system:
          "Rewrite the user's text in a formal, professional register. Keep the meaning and " +
          'the original language. Reply with the rewritten text only.',
        user: text,
        maxTokens: Math.min(2000, Math.ceil(text.length / 2) + 200),
        temperature: 0.4
      };

    case AI.CASUAL:
      return {
        system:
          "Rewrite the user's text in a relaxed, conversational tone. Keep the meaning and " +
          'the original language. Reply with the rewritten text only.',
        user: text,
        maxTokens: Math.min(2000, Math.ceil(text.length / 2) + 200),
        temperature: 0.6
      };

    case AI.SUMMARIZE:
      return {
        system:
          "Summarise the user's text in two or three sentences, in the same language as " +
          'the original. Keep every load-bearing fact, number and name. Do not add opinions, ' +
          'caveats or anything not present in the text. Reply with the summary only.',
        user: text,
        maxTokens: 400,
        temperature: 0.3
      };

    case AI.KEYPOINTS:
      return {
        system:
          "Pull the key points out of the user's text as a short bulleted list, in the same " +
          'language as the original. Use "• " to start each line, one point per line, at most ' +
          'six points, no sub-bullets and no heading. Each point is one clause, not a ' +
          'paragraph. Do not add anything not present in the text. Reply with the list only.',
        user: text,
        maxTokens: 500,
        temperature: 0.3
      };

    case AI.CONTINUE:
      return {
        system:
          "Continue the user's text from exactly where it stops. Match its voice, tense, " +
          'register and language, and stay on its subject. Two or three sentences. Reply ' +
          'with the continuation only — do not repeat any of the text you were given, and ' +
          'do not introduce it.',
        user: text,
        maxTokens: 350,
        temperature: 0.7
      };

    case AI.EXPLAIN_CODE: {
      const hint = options.language ? ` It is probably ${options.language}.` : '';
      return {
        system:
          'Explain what the code does, in plain English, for a competent programmer who ' +
          'has not seen it before. Lead with the one-sentence purpose, then the notable ' +
          'details. Mention a bug or footgun only if you can point at the specific line. ' +
          'No line-by-line narration, no markdown headings, no code fences.' + hint,
        user: text,
        maxTokens: 700,
        temperature: 0.2
      };
    }

    case AI.COMMENT_CODE: {
      const hint = options.language ? ` The language is probably ${options.language}.` : '';
      return {
        system:
          'Add comments to the code. Keep every line of the original exactly as it is, ' +
          'including its indentation, and change nothing but the comments you insert. ' +
          "Use the language's own comment syntax. Comment the why, not the obvious what; " +
          'skip lines that speak for themselves. Reply with the code only — no fences, no ' +
          'explanation before or after.' + hint,
        user: text,
        maxTokens: Math.min(3000, text.length + 800),
        temperature: 0.2
      };
    }

    case AI.TOPICS:
      return {
        system:
          "Name up to three things in the user's text that a general encyclopedia would " +
          'have an article on — a technology, concept, standard, organisation, place or ' +
          'person the text is actually about. One per line. No numbering, no bullets, no ' +
          'explanation, nothing but the names. Prefer the specific over the generic: ' +
          '"Reed–Solomon error correction", not "mathematics". Name only what is genuinely ' +
          'present. If nothing in the text warrants an encyclopedia article, reply with the ' +
          'single word NONE.',
        user: text,
        maxTokens: 60,
        temperature: 0.1
      };

    default:
      // Almost always a version skew rather than a typo — see ERR.STALE_WORKER.
      throw new Error(ERR.STALE_WORKER);
  }
}

/**
 * Models like to wrap answers in quotes or fences. Strip that off.
 *
 * Both providers need this. The on-device model is smaller and does it more
 * often, not less.
 */
export function cleanOutput(s) {
  let out = (s || '').trim();
  out = out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  const pairs = [['"', '"'], ["'", "'"], ['“', '”'], ['«', '»'], ['「', '」']];
  for (const [open, close] of pairs) {
    if (out.length > 1 && out.startsWith(open) && out.endsWith(close)) {
      const inner = out.slice(open.length, -close.length);
      // Only unwrap if the quotes really are a wrapper, not part of the text.
      if (!inner.includes(close)) out = inner.trim();
      break;
    }
  }
  return out;
}
