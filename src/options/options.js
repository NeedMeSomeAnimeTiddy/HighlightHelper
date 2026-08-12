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

const PROVIDER_HINT = {
  [PROVIDER.AUTO]:
    'Anything the on-device model can handle stays on this machine. Long selections and ' +
    'anything it cannot do fall through to DeepSeek.',
  [PROVIDER.LOCAL]:
    'Nothing is ever sent to DeepSeek. Tools the on-device model cannot serve — usually ' +
    'because the selection is too long for its context window — will say so instead.',
  [PROVIDER.CLOUD]:
    'Every AI tool goes to DeepSeek and needs the API key below.'
};

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

function wireProvider() {
  const select = $('aiProvider');
  select.value = settings.aiProvider || PROVIDER.AUTO;
  $('providerHint').textContent = PROVIDER_HINT[select.value] || '';

  select.addEventListener('change', (e) => {
    $('providerHint').textContent = PROVIDER_HINT[e.target.value] || '';
    persist({ aiProvider: e.target.value });
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

/* ---------- API key ---------- */

async function wireApiKey() {
  const input = $('apiKey');
  const status = $('keyStatus');
  const existing = await getApiKey();

  if (existing) {
    input.value = existing;
    flash(status, 'A key is saved.', 'ok');
  }

  $('toggleKey').addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    $('toggleKey').textContent = showing ? 'Show' : 'Hide';
  });

  $('saveKey').addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      flash(status, 'Paste a key first.', 'bad');
      return;
    }
    await setApiKey(value);
    flash(status, 'Key saved to local storage.', 'ok');
  });

  $('clearKey').addEventListener('click', async () => {
    await setApiKey('');
    input.value = '';
    flash(status, 'Key removed.', 'ok');
  });

  $('testKey').addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      flash(status, 'Paste a key first.', 'bad');
      return;
    }
    flash(status, 'Testing…');
    const res = await chrome.runtime.sendMessage({ type: MSG.TEST_KEY, key: value });
    if (res?.ok) {
      flash(status, `Works — responded as ${res.model}.`, 'ok');
    } else {
      const messages = {
        [ERR.BAD_KEY]: 'DeepSeek rejected that key.',
        [ERR.NO_FUNDS]: 'Key is valid but the account has no credit.',
        [ERR.RATE_LIMIT]: 'Rate-limited — try again shortly.',
        [ERR.OFFLINE]: "Couldn't reach DeepSeek.",
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
  renderSites();
  wireCache();
  await wireApiKey();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync' || !changes.settings) return;
    settings = await getSettings();
    $('enabled').checked = settings.enabled;
    renderSites();
  });
})();
