/**
 * The model client. One transport, any provider.
 *
 * Where to post, in what shape, and how to read the answer back all come from
 * `common/providers.js`; this file owns the parts that are the same whichever
 * service is chosen — the timeout, the SSE reassembly, the key lookup, and the
 * promise that the key never leaves the service worker. Content scripts ask
 * this module to make the call; they never see the credential.
 *
 * The prompts are in common/prompts.js, shared with the on-device provider.
 */

import { ERR } from '../common/constants.js';
import { getApiKey, getSettings } from '../common/settings.js';
import { buildPrompt, cleanOutput } from '../common/prompts.js';
import {
  buildBody,
  describeHttpError,
  headersFor,
  oauthReady,
  providerById,
  readAnswer,
  readDelta,
  resolveProvider
} from '../common/providers.js';
import { accessToken } from './signin.js';

const TIMEOUT_MS = 30000;

/**
 * Everything a request needs, resolved once: which service, its endpoint, the
 * model, and the key for *that* provider.
 *
 * Throws NO_KEY early rather than posting an unauthenticated request, because
 * the resulting 401 is indistinguishable from a wrong key and would send
 * someone off to check a key they never pasted.
 */
async function prepare(options = {}) {
  const settings = await getSettings();
  const provider = resolveProvider(settings, options);

  if (!provider.endpoint) throw new Error('No endpoint set for this provider. Check settings.');

  return { provider, key: await credentialFor(provider) };
}

/**
 * The bearer credential, however it was obtained.
 *
 * A pasted key and a token from a sign-in end up in the same header, so the
 * difference is confined to this function — which is also where an expired
 * token is quietly renewed. Callers never see the distinction, and no caller
 * has to remember to refresh.
 */
async function credentialFor(provider) {
  if (provider.auth === 'oauth') {
    const ready = oauthReady(provider.oauth);
    if (!ready.ok) {
      throw new Error(`Sign-in is not configured yet: no ${ready.missing.join(', ')}.`);
    }
    // Throws NOT_SIGNED_IN, which the panel turns into a "sign in" prompt
    // rather than a "paste a key" one.
    return accessToken(provider.id, provider.oauth);
  }

  if (!provider.needsKey) return '';

  const key = await getApiKey(provider.id);
  if (!key) throw new Error(ERR.NO_KEY);
  return key;
}

/** Provider-specific status handling, then the sentinel codes the UI knows. */
function mapHttpError(provider, status, body) {
  return describeHttpError(provider.api, status, body, provider.name);
}

async function post({ provider, key, messages, temperature, maxTokens, stream }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(provider.endpoint, {
      method: 'POST',
      headers: headersFor(provider.api, key),
      body: JSON.stringify(
        buildBody({
          api: provider.api,
          model: provider.model,
          messages,
          temperature,
          maxTokens,
          stream
        })
      ),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError' ? ERR.TIMEOUT : ERR.OFFLINE);
  }

  return { res, done: () => clearTimeout(timer) };
}

/**
 * Runs one chat completion.
 * Returns { text, usage }. Throws Error whose message may be an ERR.* code.
 */
export async function runAi(action, text, options = {}) {
  const { provider, key } = await prepare(options);
  const prompt = buildPrompt(action, text, options);

  const { res, done } = await post({
    provider,
    key,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
    stream: false
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body — handled below */
  } finally {
    done();
  }

  if (!res.ok) throw new Error(mapHttpError(provider, res.status, body));

  const content = readAnswer(provider.api, body);
  if (!content) throw new Error(`${provider.name} returned an empty response`);

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
  const { provider, key } = await prepare({ model });

  const { res, done } = await post({
    provider,
    key,
    messages,
    temperature,
    maxTokens,
    stream: true
  });

  if (!res.ok) {
    done();
    const body = await res.json().catch(() => null);
    throw new Error(mapHttpError(provider, res.status, body));
  }

  try {
    const out = await readSse(res, provider.api, onChunk);
    if (!out.trim()) throw new Error(`${provider.name} returned an empty response`);
    return cleanOutput(out);
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? ERR.TIMEOUT : String(err.message || err));
  } finally {
    done();
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
 *
 * What a `data:` line *means* differs by provider, so that one step is asked of
 * the registry; the framing above it does not differ at all.
 */
async function readSse(res, api, onChunk) {
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

      const delta = readDelta(api, payload);
      if (delta) {
        text += delta;
        onChunk?.(text);
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

/**
 * One minimal call used by the options page's "Test key" button.
 *
 * Takes the key and the provider as arguments rather than reading them from
 * storage, because the point of the button is to check what is currently typed
 * into the form — including a provider the user has selected but not yet saved.
 */
export async function testApiKey(key, { providerId, endpoint, model } = {}) {
  const registryEntry = providerById(providerId);
  const provider = {
    id: registryEntry.id,
    name: registryEntry.name,
    api: registryEntry.api,
    endpoint: (endpoint || '').trim() || registryEntry.endpoint,
    model: (model || '').trim() || registryEntry.defaultModel,
    needsKey: registryEntry.needsKey !== false
  };

  if (!provider.endpoint) return { ok: false, error: 'No endpoint set for this provider.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(provider.endpoint, {
      method: 'POST',
      headers: headersFor(provider.api, (key || '').trim()),
      body: JSON.stringify(
        buildBody({
          api: provider.api,
          model: provider.model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          maxTokens: 5,
          stream: false
        })
      ),
      signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: mapHttpError(provider, res.status, body) };
    return { ok: true, model: body?.model || provider.model };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? ERR.TIMEOUT : ERR.OFFLINE };
  } finally {
    clearTimeout(timer);
  }
}
