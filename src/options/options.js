import {
  getSettings,
  saveSettings,
  getApiKey,
  setApiKey,
  DEFAULTS
} from '../common/settings.js';
import { CURRENCIES } from '../common/currencies.js';
import { LANGUAGES } from '../common/languages.js';
import { MSG, ERR, PROVIDER } from '../common/constants.js';
import { PROVIDERS, DEFAULT_PROVIDER, providerById, originFor } from '../common/providers.js';
import { LIST as DETECTOR_LIST } from '../content/detectors/index.js';
import { localStatus, downloadModel } from '../content/local-ai.js';
import { DEFAULT_ENGINES } from '../common/searchengines.js';
import {
  all as allHighlights,
  remove as removeHighlight,
  clearAll as clearHighlights,
  stats as highlightStats,
  toMarkdown
} from '../common/highlights-store.js';

const $ = (id) => document.getElementById(id);

const DETECTOR_BLURB = {
  color: 'Shows a swatch and converts #hex, rgb() and hsl(). Local.',
  datetime: 'Unix timestamps and ISO dates in your local time. Local.',
  currency: 'Converts amounts like "$50" or "30 EUR" into your currency.',
  coords: 'Latitude/longitude in decimal and DMS, with map links. Local.',
  calc: 'Works out "12 * 8 + 3" or "15% of 240". Local.',
  numberbase: 'Converts between decimal, hex, binary and octal. Local.',
  regex: 'Breaks a regular expression down token by token. Local.',
  unit: 'Converts miles, kg, °F and friends. Local, no API calls.',
  code: 'Explains a code selection, or adds comments to it. Uses AI.',
  decode: 'Decodes JWTs, base64 and URL-encoding; formats JSON. Local.',
  translate: 'Translates the selection. Uses AI.',
  jargon: 'One-line plain-English explanation of a term or acronym. Uses AI.',
  summarize: 'Summary or key points for a long selection. Uses AI.',
  rewrite: 'Fix grammar, rewrite in another tone, or continue writing. Uses AI.',
  qr: 'Turns a link or short text into a scannable QR code. Local.',
  dictionary: 'Definitions and synonyms for a single word. Free — Wiktionary, no key.',
  custom: 'Your own prompts, from the My tools card below. Uses AI.',
  highlight: 'Saves a highlight and paints it again on your next visit. Local, stored in this browser.',
  link: 'Copies a URL that scrolls to and highlights this exact text. Local.',
  search: 'Opens the selection in a search engine or reference site. Local.',
  speak: "Reads the selection aloud with the browser's own voice. Local.",
  texttools: 'Counts, case conversion, line operations, extraction and SHA-256. Local, ranked last.'
};

let settings = DEFAULTS;
let statusTimer = 0;

function flash(node, message, kind = '') {
  node.textContent = message;
  node.className = `status ${kind}`.trim();
  clearTimeout(statusTimer);
  if (message) {
    statusTimer = setTimeout(() => {
      node.textContent = '';
      node.className = 'status';
    }, 3500);
  }
}

function fillSelect(select, pairs) {
  select.replaceChildren(
    ...pairs.map(([value, label]) => new Option(label, value))
  );
}

async function persist(patch) {
  settings = await saveSettings(patch);
  flash($('saveStatus'), 'Saved', 'ok');
}

/* ---------- preferences ---------- */

function wirePreferences() {
  fillSelect($('currency'), CURRENCIES.map(([c, n]) => [c, `${c} — ${n}`]));
  fillSelect($('language'), LANGUAGES);

  $('currency').value = settings.targetCurrency;
  $('unitSystem').value = settings.unitSystem;
  $('imperialFlavor').value = settings.imperialFlavor;
  $('language').value = settings.language;
  $('minRewriteChars').value = settings.minRewriteChars;
  $('cacheDays').value = settings.cacheDays;
  $('enabled').checked = settings.enabled;

  $('currency').addEventListener('change', (e) => persist({ targetCurrency: e.target.value }));
  $('unitSystem').addEventListener('change', (e) => persist({ unitSystem: e.target.value }));
  $('imperialFlavor').addEventListener('change', (e) => persist({ imperialFlavor: e.target.value }));
  $('language').addEventListener('change', (e) => persist({ language: e.target.value }));
  $('enabled').addEventListener('change', (e) => persist({ enabled: e.target.checked }));

  $('minRewriteChars').addEventListener('change', (e) => {
    const n = Math.min(500, Math.max(10, Number(e.target.value) || DEFAULTS.minRewriteChars));
    e.target.value = n;
    persist({ minRewriteChars: n });
  });

  $('cacheDays').addEventListener('change', (e) => {
    const n = Math.min(90, Math.max(0, Number(e.target.value) || 0));
    e.target.value = n;
    persist({ cacheDays: n });
  });
}

/* ---------- detectors ---------- */

function wireDetectors() {
  const list = $('detectors');
  list.replaceChildren(
    ...DETECTOR_LIST.map((d) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = settings.detectors[d.id] !== false;
      input.addEventListener('change', () =>
        persist({ detectors: { [d.id]: input.checked } })
      );

      const label = document.createElement('label');
      label.className = 'check';
      const text = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = d.title;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = ` — ${DETECTOR_BLURB[d.id] || ''}`;
      text.append(name, desc);
      label.append(input, text);

      const li = document.createElement('li');
      li.append(label);
      return li;
    })
  );
}

/* ---------- custom tools ---------- */

function renderCustomTools() {
  const list = $('customTools');
  const tools = settings.customTools || [];

  if (!tools.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'None yet. A tool is a name and a prompt.';
    list.replaceChildren(li);
    return;
  }

  list.replaceChildren(...tools.map((tool) => {
    const li = document.createElement('li');

    const body = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = tool.name;
    const prompt = document.createElement('p');
    prompt.className = 'desc';
    prompt.textContent = tool.prompt;
    body.append(name, prompt);

    const remove = document.createElement('button');
    remove.className = 'ghost';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await persist({ customTools: (settings.customTools || []).filter((t) => t.id !== tool.id) });
      renderCustomTools();
    });

    li.append(body, remove);
    return li;
  }));
}

function wireCustomTools() {
  renderCustomTools();

  $('addTool').addEventListener('click', async () => {
    const name = $('toolName').value.trim();
    const prompt = $('toolPrompt').value.trim();
    const status = $('toolStatus');

    if (!name || !prompt) {
      flash(status, 'A tool needs both a name and a prompt.', 'bad');
      return;
    }

    // Ids are generated, not derived from the name, so renaming a tool later
    // cannot orphan the right-click entry that points at it.
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await persist({ customTools: [...(settings.customTools || []), { id, name, prompt }] });

    $('toolName').value = '';
    $('toolPrompt').value = '';
    flash(status, `Added ${name}. It is on the right-click menu too.`, 'ok');
    renderCustomTools();
  });
}

/* ---------- history ---------- */

async function renderHistory() {
  const list = $('historyList');
  const res = await chrome.runtime.sendMessage({ type: MSG.HISTORY });
  const entries = res?.ok ? res.entries : [];

  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = settings.keepHistory === false
      ? 'History is switched off.'
      : 'Nothing yet.';
    list.replaceChildren(li);
    return;
  }

  list.replaceChildren(...entries.map((entry) => {
    const li = document.createElement('li');
    li.className = 'library-item';

    const body = document.createElement('div');

    const source = document.createElement('blockquote');
    source.textContent = entry.source;
    body.append(source);

    const answer = document.createElement('p');
    answer.className = 'library-note';
    answer.textContent = entry.text;
    body.append(answer);

    const when = document.createElement('span');
    when.className = 'desc';
    when.textContent = `${entry.action} · ${new Date(entry.at).toLocaleString()}`;
    body.append(when);

    li.append(body);
    return li;
  }));
}

function wireHistory() {
  $('keepHistory').checked = settings.keepHistory !== false;
  $('keepHistory').addEventListener('change', async (e) => {
    await persist({ keepHistory: e.target.checked });
    renderHistory();
  });

  $('clearHistoryBtn').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: MSG.CLEAR_HISTORY });
    flash($('historyStatus'), res?.ok ? `Cleared ${res.cleared}.` : 'Clear failed.',
      res?.ok ? 'ok' : 'bad');
    renderHistory();
  });

  renderHistory();
}

/* ---------- highlights library ---------- */

function highlightEntry(item, onChanged) {
  const li = document.createElement('li');
  li.className = 'library-item';

  const swatch = document.createElement('span');
  swatch.className = `library-dot library-dot--${item.color || 'yellow'}`;

  const body = document.createElement('div');
  const quote = document.createElement('blockquote');
  quote.textContent = item.text;
  body.append(quote);

  if (item.note) {
    const note = document.createElement('p');
    note.className = 'library-note';
    note.textContent = item.note;
    body.append(note);
  }

  const when = document.createElement('span');
  when.className = 'desc';
  when.textContent = new Date(item.createdAt).toLocaleDateString();
  body.append(when);

  const remove = document.createElement('button');
  remove.className = 'ghost';
  remove.textContent = 'Delete';
  remove.addEventListener('click', async () => {
    await removeHighlight(item.url, item.id);
    onChanged();
  });

  li.append(swatch, body, remove);
  return li;
}

async function renderLibrary() {
  const list = $('highlightLibrary');
  const groups = await allHighlights();

  if (!groups.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing highlighted yet. Select text on a page and pick Highlight this.';
    list.replaceChildren(li);
    return;
  }

  const nodes = [];
  for (const group of groups) {
    // Grouped by page rather than by site: a highlight's context is the article
    // it came from, and a site with fifty pages would otherwise be one long list.
    const byPage = new Map();
    for (const item of group.items) {
      if (!byPage.has(item.url)) byPage.set(item.url, []);
      byPage.get(item.url).push(item);
    }

    for (const [url, items] of byPage) {
      const head = document.createElement('li');
      head.className = 'library-page';
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = items[0].title || url;
      head.append(link);
      nodes.push(head);

      for (const item of items.slice().sort((a, b) => a.createdAt - b.createdAt)) {
        nodes.push(highlightEntry(item, renderLibrary));
      }
    }
  }

  list.replaceChildren(...nodes);
}

function wireHighlights() {
  renderLibrary();

  $('exportHighlights').addEventListener('click', async () => {
    const groups = await allHighlights();
    if (!groups.length) {
      flash($('highlightStatus'), 'Nothing to export yet.', 'bad');
      return;
    }

    // A blob and a click, so the file never touches the network.
    const blob = new Blob([toMarkdown(groups)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `highlights-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);

    flash($('highlightStatus'), 'Exported.', 'ok');
  });

  $('clearHighlights').addEventListener('click', async () => {
    // Deleting every highlight is not recoverable and not obviously reversible
    // from the button's label alone, so it asks first.
    const { items } = await highlightStats();
    if (!items) {
      flash($('highlightStatus'), 'Nothing to delete.', 'bad');
      return;
    }
    if (!confirm(`Delete all ${items} saved highlights? This cannot be undone.`)) return;

    await clearHighlights();
    await renderLibrary();
    flash($('highlightStatus'), `Deleted ${items}.`, 'ok');
  });
}

/* ---------- search engines ---------- */

/** The stored list if there is one, otherwise the shipped defaults. */
function engineList() {
  return settings.searchEngines?.length ? settings.searchEngines : DEFAULT_ENGINES;
}

function renderEngines() {
  const list = $('searchEngines');
  const enabled = settings.searchEnabled || [];

  list.replaceChildren(...engineList().map((engine) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabled.includes(engine.id);
    input.addEventListener('change', async () => {
      const next = input.checked
        ? [...new Set([...(settings.searchEnabled || []), engine.id])]
        : (settings.searchEnabled || []).filter((id) => id !== engine.id);
      await persist({ searchEnabled: next });
    });

    const label = document.createElement('label');
    label.className = 'check';
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = engine.name;
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = ` — ${engine.url}`;
    text.append(name, desc);
    label.append(input, text);

    const li = document.createElement('li');
    li.append(label);

    // Only the ones the user added can be removed. Unticking a shipped engine
    // is what "I don't want this" means for those, and deleting them would
    // mean a later release could never add one back.
    if (!DEFAULT_ENGINES.some((d) => d.id === engine.id)) {
      const remove = document.createElement('button');
      remove.className = 'ghost';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        await persist({
          searchEngines: engineList().filter((e) => e.id !== engine.id),
          searchEnabled: (settings.searchEnabled || []).filter((id) => id !== engine.id)
        });
        renderEngines();
      });
      li.append(remove);
    }

    return li;
  }));
}

function wireSearchEngines() {
  renderEngines();

  $('addEngine').addEventListener('click', async () => {
    const name = $('customEngineName').value.trim();
    const url = $('customEngine').value.trim();
    const status = $('engineStatus');

    if (!name || !url) {
      flash(status, 'Both a name and a URL, please.', 'bad');
      return;
    }
    // A URL with nowhere to put the selection is a bookmark, not a search.
    if (!url.includes('{q}')) {
      flash(status, 'The URL needs {q} where the selected text should go.', 'bad');
      return;
    }
    try {
      const parsed = new URL(url.replace('{q}', 'x'));
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad scheme');
    } catch {
      flash(status, "That doesn't look like a web address.", 'bad');
      return;
    }

    const id = `custom:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const next = engineList().filter((e) => e.id !== id).concat([{ id, name, url }]);
    await persist({
      searchEngines: next,
      searchEnabled: [...new Set([...(settings.searchEnabled || []), id])]
    });

    $('customEngineName').value = '';
    $('customEngine').value = '';
    flash(status, `Added ${name}.`, 'ok');
    renderEngines();
  });
}

/* ---------- where AI runs ---------- */

const providerHints = (name) => ({
  [PROVIDER.AUTO]:
    'Anything the on-device model can handle stays on this machine. Long selections and ' +
    `anything it cannot do fall through to ${name}.`,
  [PROVIDER.LOCAL]:
    `Nothing is ever sent to ${name}. Tools the on-device model cannot serve — usually ` +
    'because the selection is too long for its context window — will say so instead.',
  [PROVIDER.CLOUD]:
    `Every AI tool goes to ${name} and needs the API key below.`
});

/** Turns the raw availability strings into one sentence and maybe a button. */
function describeLocal({ supported, model, summarizer }) {
  if (!supported) {
    return {
      text: 'Not available in this browser. Needs Chrome 138 or newer.',
      kind: 'bad',
      offerDownload: false
    };
  }
  if (model === 'available' || summarizer === 'available') {
    return { text: 'Ready — answers stay on this machine.', kind: 'ok', offerDownload: false };
  }
  if (model === 'downloading' || summarizer === 'downloading') {
    return { text: 'Downloading… this page can be closed.', kind: '', offerDownload: false };
  }
  if (model === 'downloadable' || summarizer === 'downloadable') {
    return { text: 'Supported, but the model needs downloading first.', kind: '', offerDownload: true };
  }
  if (model === 'unknown') {
    return { text: "Chrome didn't answer in time — reopen this page to retry.", kind: '', offerDownload: false };
  }
  return {
    text: "This machine can't run it — usually not enough disk space or GPU memory.",
    kind: 'bad',
    offerDownload: false
  };
}

async function refreshLocalStatus() {
  const status = $('localStatus');
  const button = $('downloadModel');
  const state = describeLocal(await localStatus());

  status.textContent = state.text;
  status.className = `status ${state.kind}`.trim();
  button.hidden = !state.offerDownload;
}

function refreshProviderHint() {
  const select = $('aiProvider');
  const name = providerById(settings.aiService || DEFAULT_PROVIDER).name;
  $('providerHint').textContent = providerHints(name)[select.value] || '';
}

function wireProvider() {
  const select = $('aiProvider');
  select.value = settings.aiProvider || PROVIDER.AUTO;
  refreshProviderHint();

  select.addEventListener('change', (e) => {
    persist({ aiProvider: e.target.value }).then(refreshProviderHint);
  });

  $('downloadModel').addEventListener('click', async () => {
    const button = $('downloadModel');
    const status = $('localStatus');
    button.disabled = true;
    status.className = 'status';
    status.textContent = 'Starting…';

    try {
      // The click is also what satisfies the API's user-activation requirement,
      // which is the other reason the download is not automatic.
      await downloadModel((fraction) => {
        status.textContent = `Downloading… ${Math.round(fraction * 100)}%`;
      });
      await refreshLocalStatus();
    } catch (err) {
      flash(status, `Download failed: ${err.message || err}`, 'bad');
    } finally {
      button.disabled = false;
    }
  });

  refreshLocalStatus();
}

/* ---------- which service, and its key ---------- */

/**
 * Permission for the origin this provider talks to.
 *
 * Only DeepSeek's host is in `host_permissions`; every other one is optional
 * and asked for here, at the moment somebody picks it. That keeps the install
 * prompt honest — an extension that declares nine AI companies up front looks
 * like it talks to nine AI companies — and it means the "anything else"
 * provider can reach a host nobody could have listed in advance.
 *
 * Must be called from inside a click handler: Chrome rejects a permission
 * request that isn't attached to a user gesture, and awaiting anything first
 * consumes it.
 */
async function ensureOrigin(endpoint) {
  const origin = originFor(endpoint);
  if (!origin) return true;
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    // Some origins can't be requested at all (a bare IP with no scheme, say).
    // Letting the call proceed produces a real network error, which says more
    // than a permissions message would.
    return true;
  }
}

/** The form's current state, which may differ from what is saved. */
function formProvider() {
  const id = $('aiService').value;
  const entry = providerById(id);
  return {
    id,
    entry,
    endpoint: ($('aiEndpoint').value || '').trim() || entry.endpoint,
    model: ($('model').value || '').trim() || entry.defaultModel
  };
}

/** Redraws everything that depends on which service is selected. */
async function renderService() {
  const entry = providerById($('aiService').value);

  $('serviceNote').textContent = entry.note || '';
  if (entry.keysAt) {
    const link = document.createElement('a');
    link.href = entry.keysAt;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = 'Get a key';
    $('serviceNote').append(' ', link);
  }

  $('endpointField').hidden = !entry.editableEndpoint;
  $('aiEndpoint').placeholder = entry.endpoint || 'https://…/v1/chat/completions';

  const signsIn = entry.auth === 'oauth';
  $('oauthFields').hidden = !signsIn;
  if (signsIn) await refreshSignInState();

  $('keyField').hidden = entry.needsKey === false || signsIn;
  $('apiKey').placeholder = entry.keyHint || '';
  $('keyHint').textContent = entry.needsKey === false
    ? ''
    : 'Stored in this browser only, and sent to nowhere but this service.';

  const suggestions = $('modelSuggestions');
  suggestions.replaceChildren(
    ...entry.models.map((id) => Object.assign(document.createElement('option'), { value: id }))
  );
  $('model').placeholder = entry.defaultModel || 'model id';

  // The key belongs to the provider, not to the form, so switching the picker
  // shows that provider's saved key rather than carrying the last one across.
  const saved = await getApiKey(entry.id);
  $('apiKey').value = saved;
  flash($('keyStatus'), saved ? 'A key is saved for this service.' : '', saved ? 'ok' : '');
}

/* ---------- signing in instead of pasting a key ---------- */

/** The five OAuth inputs, by the settings key each one writes. */
const OAUTH_FIELDS = {
  clientId: 'oauthClientId',
  authUrl: 'oauthAuthUrl',
  tokenUrl: 'oauthTokenUrl',
  scope: 'oauthScope',
  audience: 'oauthAudience'
};

async function refreshSignInState() {
  const res = await chrome.runtime.sendMessage({
    type: MSG.SIGN_IN_STATE,
    providerId: 'oauth'
  });
  $('signInStatus').textContent = res?.state || '';
  $('signInStatus').className = /Not signed in/.test(res?.state || '') ? 'status' : 'status ok';
  // Read from the worker rather than composed here: it is derived from the
  // extension id, and the worker is the side that owns the identity API.
  if (res?.redirectUri) $('redirectUri').value = res.redirectUri;
}

function wireSignIn() {
  for (const [key, id] of Object.entries(OAUTH_FIELDS)) {
    $(id).value = settings.oauth?.[key] || '';
    // Saved per field rather than on a Save button: the sign-in reads these out
    // of settings, so a client id typed but not saved would produce a failure
    // whose cause is invisible.
    $(id).addEventListener('change', () => persist({ oauth: { [key]: $(id).value.trim() } }));
  }

  $('copyRedirect').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('redirectUri').value);
    flash($('signInStatus'), 'Redirect URI copied.', 'ok');
  });

  $('signIn').addEventListener('click', async () => {
    /*
     * Three origins are involved and only two need permission. The sign-in
     * window itself is a browser window on the provider's own site, so it needs
     * none; the token exchange and the chat requests are `fetch` from the
     * worker, so they do. Asked for here because a permission request must ride
     * on a click, and this is the click.
     */
    const tokenUrl = $('oauthTokenUrl').value.trim();
    if (!tokenUrl) {
      flash($('signInStatus'), 'Fill in the token URL first.', 'bad');
      return;
    }
    if (!(await ensureOrigin(tokenUrl))) {
      flash($('signInStatus'), 'Sign-in needs permission to reach the token URL.', 'bad');
      return;
    }
    const endpoint = $('aiEndpoint').value.trim();
    if (endpoint && !(await ensureOrigin(endpoint))) {
      flash($('signInStatus'), 'Answers need permission to reach the endpoint.', 'bad');
      return;
    }

    flash($('signInStatus'), 'Opening the sign-in window…');
    const res = await chrome.runtime.sendMessage({ type: MSG.SIGN_IN, providerId: 'oauth' });
    if (res?.ok) {
      flash($('signInStatus'), res.state, 'ok');
    } else {
      flash($('signInStatus'), res?.error || 'Sign-in failed.', 'bad');
    }
  });

  $('signOut').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: MSG.SIGN_OUT, providerId: 'oauth' });
    flash($('signInStatus'), res?.state || 'Signed out.', '');
  });
}

async function wireService() {
  fillSelect($('aiService'), PROVIDERS.map((p) => [p.id, p.name]));
  $('aiService').value = settings.aiService || DEFAULT_PROVIDER;
  $('aiEndpoint').value = settings.aiEndpoint || '';
  $('model').value = settings.model || '';
  wireSignIn();
  await renderService();

  $('aiService').addEventListener('change', async (e) => {
    /*
     * The model is cleared, not kept. `deepseek-chat` following someone to
     * OpenAI is a 404 that reads like a broken extension, and the empty value
     * already means "this service's default" everywhere it is read.
     */
    $('model').value = '';
    $('aiEndpoint').value = '';
    await persist({ aiService: e.target.value, model: '', aiEndpoint: '' });
    await renderService();
    refreshProviderHint();
  });

  $('model').addEventListener('change', () => persist({ model: $('model').value.trim() }));
  $('aiEndpoint').addEventListener('change', () =>
    persist({ aiEndpoint: $('aiEndpoint').value.trim() })
  );

  const input = $('apiKey');
  const status = $('keyStatus');

  $('toggleKey').addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    $('toggleKey').textContent = showing ? 'Show' : 'Hide';
  });

  $('saveKey').addEventListener('click', async () => {
    const { id, entry, endpoint, model } = formProvider();
    const value = input.value.trim();

    if (entry.needsKey !== false && !value) {
      flash(status, 'Paste a key first.', 'bad');
      return;
    }
    if (!endpoint) {
      flash(status, 'This service needs an endpoint.', 'bad');
      return;
    }
    if (!(await ensureOrigin(endpoint))) {
      flash(status, `Not saved — ${entry.name} needs permission to be reached.`, 'bad');
      return;
    }

    await setApiKey(id, value);
    await persist({
      aiService: id,
      model: ($('model').value || '').trim(),
      aiEndpoint: ($('aiEndpoint').value || '').trim()
    });
    refreshProviderHint();
    flash(status, `Saved. Answers will come from ${entry.name} (${model}).`, 'ok');
  });

  $('clearKey').addEventListener('click', async () => {
    const { id } = formProvider();
    await setApiKey(id, '');
    input.value = '';
    flash(status, 'Key removed.', 'ok');
  });

  $('testKey').addEventListener('click', async () => {
    const { id, entry, endpoint, model } = formProvider();
    const value = input.value.trim();

    if (entry.needsKey !== false && !value) {
      flash(status, 'Paste a key first.', 'bad');
      return;
    }
    if (!endpoint) {
      flash(status, 'This service needs an endpoint.', 'bad');
      return;
    }
    if (!(await ensureOrigin(endpoint))) {
      flash(status, `Can't test — ${entry.name} needs permission to be reached.`, 'bad');
      return;
    }

    flash(status, 'Testing…');
    const res = await chrome.runtime.sendMessage({
      type: MSG.TEST_KEY,
      key: value,
      providerId: id,
      endpoint,
      model
    });

    if (res?.ok) {
      flash(status, `Works — responded as ${res.model}.`, 'ok');
    } else {
      const messages = {
        [ERR.BAD_KEY]: `${entry.name} rejected that key.`,
        [ERR.NO_FUNDS]: 'Key is valid but the account has no credit.',
        [ERR.RATE_LIMIT]: 'Rate-limited — try again shortly.',
        [ERR.OFFLINE]: `Couldn't reach ${entry.name}.`,
        [ERR.TIMEOUT]: 'The test timed out.'
      };
      flash(status, messages[res?.error] || res?.error || 'Test failed.', 'bad');
    }
  });
}

/* ---------- cache ---------- */

async function refreshCacheStats() {
  const res = await chrome.runtime.sendMessage({ type: MSG.CACHE_STATS });
  if (res?.ok) {
    $('cacheStatus').textContent = `${res.entries} cached answer${res.entries === 1 ? '' : 's'}`;
    $('cacheStatus').className = 'status';
  }
}

function wireCache() {
  $('clearCache').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: MSG.CLEAR_CACHE });
    flash(
      $('cacheStatus'),
      res?.ok ? `Cleared ${res.responses} answers and ${res.rates} rate tables.` : 'Clear failed.',
      res?.ok ? 'ok' : 'bad'
    );
  });
  refreshCacheStats();
}

/* ---------- per-site opt-outs ---------- */

function renderSites() {
  const list = $('disabledSites');
  if (!settings.disabledSites.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'None. Use the toolbar button to turn Highlight Helper off on a site.';
    list.replaceChildren(li);
    return;
  }

  list.replaceChildren(
    ...settings.disabledSites.map((host) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = host;
      const remove = document.createElement('button');
      remove.className = 'ghost';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        await persist({ disabledSites: settings.disabledSites.filter((h) => h !== host) });
        renderSites();
      });
      li.append(span, remove);
      return li;
    })
  );
}

/* ---------- boot ---------- */

(async function init() {
  settings = await getSettings();
  wirePreferences();
  wireProvider();
  wireDetectors();
  wireSearchEngines();
  wireHighlights();
  wireCustomTools();
  wireHistory();
  renderSites();
  wireCache();
  await wireService();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync' || !changes.settings) return;
    settings = await getSettings();
    $('enabled').checked = settings.enabled;
    renderSites();
  });
})();
