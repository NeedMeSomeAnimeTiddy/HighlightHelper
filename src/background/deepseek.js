/**
 * DeepSeek client. OpenAI-compatible /chat/completions endpoint.
 *
 * The API key is read from chrome.storage.local at call time and never leaves
 * the service worker — content scripts ask this module to make the call, they
 * never see the key.
 */

import { AI, ERR } from '../common/constants.js';
import { getApiKey, getSettings } from '../common/settings.js';
import { languageName } from '../common/languages.js';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 30000;

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

    default:
      // Almost always a version skew rather than a typo — see ERR.STALE_WORKER.
      throw new Error(ERR.STALE_WORKER);
  }
}

/** Models like to wrap answers in quotes or fences. Strip that off. */
function cleanOutput(s) {
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

function mapHttpError(status, body) {
  if (status === 401) return ERR.BAD_KEY;
  if (status === 402) return ERR.NO_FUNDS;
  if (status === 429) return ERR.RATE_LIMIT;
  const detail = body?.error?.message || body?.message;
  return detail ? `DeepSeek error ${status}: ${detail}` : `DeepSeek error ${status}`;
}

/**
 * Runs one chat completion.
 * Returns { text, usage }. Throws Error whose message may be an ERR.* code.
 */
export async function runAi(action, text, options = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error(ERR.NO_KEY);

  const settings = await getSettings();
  const prompt = buildPrompt(action, text, options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: options.model || settings.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        stream: false
      }),
      signal: controller.signal
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? ERR.TIMEOUT : ERR.OFFLINE);
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body — handled below */
  }

  if (!res.ok) throw new Error(mapHttpError(res.status, body));

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned an empty response');

  return { text: cleanOutput(content), usage: body.usage || null };
}

/** One minimal call used by the options page's "Test key" button. */
export async function testApiKey(key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${(key || '').trim()}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 3,
        stream: false
      }),
      signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: mapHttpError(res.status, body) };
    return { ok: true, model: body?.model || 'deepseek-chat' };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? ERR.TIMEOUT : ERR.OFFLINE };
  } finally {
    clearTimeout(timer);
  }
}
