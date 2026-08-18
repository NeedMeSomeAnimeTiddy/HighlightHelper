/**
 * Which model service answers, and how to talk to it.
 *
 * One table, read by both platforms. The extension's background worker imports
 * it directly; the Android app gets it across the bridge in the `defaults`
 * payload and sends the resolved choice back with each request, so Kotlin never
 * holds a copy of this list. A provider added here appears in both settings
 * screens without either being edited.
 *
 * Almost every service worth naming speaks OpenAI's /chat/completions shape, so
 * `api: 'openai'` is the default and the whole table is mostly endpoints and
 * names. Anthropic is the exception that earns a second wire format, and
 * `custom` is the escape hatch for everything unlisted — a base URL and a model
 * id is all this code actually needs.
 *
 * The model lists are SUGGESTIONS, not a menu. Model ids change faster than any
 * extension ships, so both settings screens offer these and still let the id be
 * typed by hand; nothing here validates one.
 */

export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    api: 'openai',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keysAt: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-…',
    note: 'Cheapest of the hosted options by some margin.'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    api: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    keysAt: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-proj-…',
    /*
     * Stated here because it is the single most common wrong expectation about
     * this screen: an OpenAI *API* key is billed separately from a ChatGPT
     * subscription. Paying for Plus does not create API credit, and there is no
     * supported way for an app like this one to spend a ChatGPT plan instead.
     */
    note: 'An API key, billed separately — a ChatGPT Plus or Pro subscription does not cover it.'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    api: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5',
    models: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1'],
    keysAt: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    note: 'Billed on Anthropic Console credit, separately from a Claude.ai subscription.'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    api: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      'deepseek/deepseek-chat',
      'openai/gpt-4o-mini',
      'anthropic/claude-haiku-4.5',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.3-70b-instruct'
    ],
    keysAt: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-v1-…',
    note: 'One key, most models — including free ones. Useful if you would rather not pick.'
  },
  {
    id: 'google',
    name: 'Google Gemini',
    api: 'openai',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    keysAt: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    note: 'Google exposes an OpenAI-compatible endpoint, which is the one used here.'
  },
  {
    id: 'groq',
    name: 'Groq',
    api: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    keysAt: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    note: 'Open models, answered fast enough that streaming barely matters.'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    api: 'openai',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
    keysAt: 'https://console.mistral.ai/api-keys',
    keyHint: ''
  },
  {
    id: 'xai',
    name: 'xAI',
    api: 'openai',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    defaultModel: 'grok-4-fast',
    models: ['grok-4-fast', 'grok-4'],
    keysAt: 'https://console.x.ai',
    keyHint: 'xai-…'
  },
  {
    id: 'together',
    name: 'Together AI',
    api: 'openai',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-V3'
    ],
    keysAt: 'https://api.together.xyz/settings/api-keys',
    keyHint: ''
  },
  {
    id: 'ollama',
    name: 'Ollama (on this machine)',
    api: 'openai',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'qwen2.5', 'mistral', 'gemma3'],
    needsKey: false,
    editableEndpoint: true,
    note: 'No key and no bill — but the selection still leaves the browser for the local server.'
  },
  {
    id: 'custom',
    name: 'Anything else (OpenAI-compatible)',
    api: 'openai',
    endpoint: '',
    defaultModel: '',
    models: [],
    editableEndpoint: true,
    note: 'Paste the full chat-completions URL. LM Studio, vLLM, llama.cpp, a company gateway.'
  }
];

/** The provider used when nothing has been chosen. */
export const DEFAULT_PROVIDER = 'deepseek';

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER);
}

/**
 * The chosen provider with the user's overrides folded in.
 *
 * Every caller wants the same handful of facts — where to post, which model,
 * whether a key is needed, what to call it in an error message — and working
 * them out from settings involves three fallbacks that must not be written
 * twice.
 *
 * `settings.model` is deliberately allowed to be empty: an unset model means
 * "whatever this provider's default is", so switching provider cannot leave a
 * DeepSeek model id pointed at OpenAI.
 */
export function resolveProvider(settings = {}, overrides = {}) {
  const provider = providerById(settings.aiService || DEFAULT_PROVIDER);
  const endpoint =
    (provider.editableEndpoint && (settings.aiEndpoint || '').trim()) || provider.endpoint;

  return {
    id: provider.id,
    name: provider.name,
    api: provider.api,
    endpoint,
    model: (overrides.model || settings.model || provider.defaultModel || '').trim(),
    needsKey: provider.needsKey !== false,
    keysAt: provider.keysAt || ''
  };
}

/** The origin a provider talks to, for an optional host permission request. */
export function originFor(endpoint) {
  try {
    return `${new URL(endpoint).origin}/*`;
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ *
 * Wire formats
 * ------------------------------------------------------------------ */

/**
 * Anthropic's Messages API is not OpenAI-shaped, and the differences are all
 * structural rather than cosmetic: the system prompt is a top-level field
 * instead of a message, `max_tokens` is required rather than optional, and the
 * stream carries typed events instead of choice deltas. That is enough to earn
 * a second format; it is not enough to earn a second file.
 */
export function buildBody({ api, model, messages, temperature, maxTokens, stream }) {
  if (api === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    return {
      model,
      // Required by the API, so an unset ceiling has to become a number here
      // rather than being left out and 400-ing.
      max_tokens: maxTokens || 1024,
      ...(system ? { system } : {}),
      ...(temperature === undefined ? {} : { temperature }),
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      stream: Boolean(stream)
    };
  }

  return {
    model,
    messages,
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    stream: Boolean(stream)
  };
}

export function headersFor(api, key) {
  if (api === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Without this the API refuses requests that carry an Origin header,
      // which is every request a browser makes — including an extension
      // worker's. It is not a security bypass; it is Anthropic asking the
      // caller to acknowledge that the key is visible to the client.
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

/** The finished answer out of a non-streamed response body. */
export function readAnswer(api, body) {
  if (api === 'anthropic') {
    return (body?.content || [])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('');
  }
  return body?.choices?.[0]?.message?.content || '';
}

/**
 * One SSE `data:` payload turned into the text it adds, or '' for the many
 * events that add none — pings, role announcements, stop reasons.
 */
export function readDelta(api, payload) {
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return '';
  }

  if (api === 'anthropic') {
    if (event?.type !== 'content_block_delta') return '';
    return event?.delta?.text || '';
  }
  return event?.choices?.[0]?.delta?.content || '';
}

/**
 * An HTTP status turned into one of the sentinel codes the UI reacts to, or a
 * sentence when it is nothing the UI knows how to handle specially.
 *
 * Kept here rather than in the transport because the mapping is per-provider:
 * DeepSeek says 402 for an empty account, OpenAI says 429 with a distinct body,
 * and Anthropic says 400. Guessing wrong tells someone their key is broken when
 * they are simply out of credit.
 */
export function describeHttpError(api, status, body, name = 'The provider') {
  const detail = body?.error?.message || body?.message || '';

  if (status === 401 || status === 403) return 'BAD_KEY';
  if (status === 402) return 'NO_FUNDS';
  if (status === 429) {
    return /quota|credit|billing|insufficient/i.test(detail) ? 'NO_FUNDS' : 'RATE_LIMIT';
  }
  if (status === 400 && /credit balance|insufficient/i.test(detail)) return 'NO_FUNDS';
  if (status === 404 && /model/i.test(detail)) {
    return `${name} has no model by that name. Check the model id in settings.`;
  }
  return detail ? `${name} returned ${status}: ${detail}` : `${name} returned ${status}`;
}
