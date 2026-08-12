import {
  getSettings,
  saveSettings,
  getApiKey,
  setApiKey,
  DEFAULTS
} from '../common/settings.js';
import { CURRENCIES } from '../common/currencies.js';
import { LANGUAGES } from '../common/languages.js';
import { MSG, ERR } from '../common/constants.js';
import { LIST as DETECTOR_LIST } from '../content/detectors/index.js';

const $ = (id) => document.getElementById(id);

const DETECTOR_BLURB = {
  currency: 'Converts amounts like "$50" or "30 EUR" into your currency.',
  unit: 'Converts miles, kg, °F and friends. Runs locally, no API calls.',
  translate: 'Translates the selection. Uses DeepSeek.',
  jargon: 'One-line plain-English explanation of a term or acronym. Uses DeepSeek.',
  rewrite: 'Fix grammar, or rewrite shorter / formal / casual. Uses DeepSeek.'
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
  wireDetectors();
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
