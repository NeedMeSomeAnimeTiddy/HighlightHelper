/**
 * DeepSeek client. OpenAI-compatible /chat/completions endpoint.
 *
 * The API key is read from chrome.storage.local at call time and never leaves
 * the service worker — content scripts ask this module to make the call, they
 * never see the key.
 *
 * The prompts themselves are in common/prompts.js, shared with the on-device
 * provider. This file owns the transport and the key, nothing more.
 */

import { ERR } from '../common/constants.js';
import { getApiKey, getSettings } from '../common/settings.js';
import { buildPrompt, cleanOutput } from '../common/prompts.js';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 30000;

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

/**
 * The same call, delivering tokens as they arrive.
 *
 * `onChunk` receives the text so far, not the delta, because every caller wants
 * to render the whole thing and making each of them accumulate would be four
 * copies of the same three lines.
 *
 * Returns the finished { text }. A stream that fails halfway throws like any
 * other failure — a partial answer presented as complete would be worse than an
 * error, since there is no way to tell from the text that it stopped early.
 */
async function chatStream({ messages, temperature, maxTokens, model }, onChunk) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error(ERR.NO_KEY);

  const settings = await getSettings();
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
        model: model || settings.model || 'deepseek-chat',
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError' ? ERR.TIMEOUT : ERR.OFFLINE);
  }

  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.json().catch(() => null);
    throw new Error(mapHttpError(res.status, body));
  }

  try {
    const out = await readSse(res, onChunk);
    if (!out.trim()) throw new Error('DeepSeek returned an empty response');
    return cleanOutput(out);
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? ERR.TIMEOUT : String(err.message || err));
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiStream(action, text, options = {}, onChunk) {
  const prompt = buildPrompt(action, text, options);
  const out = await chatStream({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
    model: options.model
  }, onChunk);
  return { text: out };
}

/**
 * Server-sent events, reassembled.
 *
 * A chunk off the network is not a whole line and a line is not a whole event,
 * so the tail of each read is carried forward rather than parsed. Splitting on
 * newlines and hoping works until a token happens to straddle a packet
 * boundary, at which point it drops a word somewhere in the middle of a
 * paragraph — the kind of failure nobody reports because it reads like the
 * model wrote it.
 */
async function readSse(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;

      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onChunk?.(text);
        }
      } catch {
        /* a keep-alive or a comment line — not every event carries a delta */
      }
    }
  }

  return text;
}

/**
 * A follow-up turn: the conversation so far, and a new question.
 *
 * Not cached. Every other call is keyed on the exact selection and action, so
 * repeating one is genuinely the same request; a follow-up depends on
 * everything said before it, and a cache keyed loosely enough to hit would
 * sometimes answer the wrong question.
 */
export async function runChat(messages, options = {}, onChunk) {
  const out = await chatStream({
    messages,
    // Roomier than any single-shot action: a follow-up is a question, and the
    // fixed prompts' tight ceilings exist to stop a summary sprawling, which is
    // not the failure mode here.
    temperature: 0.5,
    maxTokens: 900,
    model: options.model
  }, onChunk);
  return { text: out };
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
