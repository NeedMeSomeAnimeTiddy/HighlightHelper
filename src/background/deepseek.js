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
