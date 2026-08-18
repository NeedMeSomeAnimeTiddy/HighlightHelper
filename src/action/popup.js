import { getSettings, saveSettings, getApiKey } from '../common/settings.js';
import { MSG, PROVIDER } from '../common/constants.js';
import { resolveProvider } from '../common/providers.js';
import { localStatus } from '../content/local-ai.js';
import { forPage } from '../common/highlights-store.js';

const $ = (id) => document.getElementById(id);

/**
 * "Can the AI tools actually answer right now?"
 *
 * Answered in two passes. A key is a storage read, so that lands immediately;
 * whether the on-device model is installed needs Chrome to be asked, which can
 * take seconds, so it upgrades the line afterwards rather than holding the
 * popup shut. Claiming on-device availability before checking would be the one
 * unacceptable option — the whole point of that mode is that it is a promise
 * about where the text goes.
 */
async function renderProviderState() {
  const state = $('keyState');
  const settings = await getSettings();
  const provider = settings.aiProvider || PROVIDER.AUTO;
  const service = resolveProvider(settings);
  // A provider that needs no key — a local Ollama — is configured as soon as it
  // is chosen, so "no key" must not read as "not set up" for it.
  const key = service.needsKey ? await getApiKey(service.id) : 'n/a';

  if (provider === PROVIDER.CLOUD) {
    state.textContent = key
      ? `${service.name} key saved. All tools available.`
      : `No ${service.name} key — the local tools still work.`;
    state.className = key ? 'key' : 'key bad';
    return;
  }

  state.textContent = key
    ? `${service.name} key saved. Checking for the on-device model…`
    : 'Checking for the on-device model…';
  state.className = 'key';

  const { model, summarizer } = await localStatus();
  const onDevice = model === 'available' || summarizer === 'available';

  if (onDevice) {
    state.textContent = 'On-device model ready — nothing leaves this machine.';
    state.className = 'key';
  } else if (key) {
    state.textContent = `${service.name} key saved. All tools available.`;
    state.className = 'key';
  } else if (provider === PROVIDER.LOCAL) {
    state.textContent = `No on-device model yet, and ${service.name} is switched off. See settings.`;
    state.className = 'key bad';
  } else {
    state.textContent = 'No AI provider yet — the local tools still work. See settings.';
    state.className = 'key bad';
  }
}

/**
 * How many highlights are saved for the page in front of you.
 *
 * Read from storage rather than asked of the content script, so it still
 * answers on a page where the script never loaded — which is exactly when
 * someone would be wondering where their highlights went.
 */
async function renderHighlightState() {
  const row = $('highlightState');
  const tab = await activeTab();
  if (!tab?.url) return;

  const here = await forPage(tab.url);
  if (!here.length) return;

  row.textContent = here.length === 1
    ? '1 highlight saved on this page'
    : `${here.length} highlights saved on this page`;
  row.hidden = false;
}

/** Opera and Opera GX both carry OPR/ in the UA and share the same restriction. */
const IS_OPERA = /\bOPR\//.test(navigator.userAgent);

/** The active tab. Reading `url` is allowed because opening the popup grants activeTab. */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function hostOf(tab) {
  try {
    const url = new URL(tab?.url || '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
}

/**
 * Is the content script actually running in this tab?
 *
 * Worth asking directly, because "not injected" and "injected but doing
 * nothing" look identical from the page, and the usual causes are invisible:
 * a tab that was already open when the extension was reloaded never receives
 * content scripts, and Chrome's per-extension "Site access" setting can be set
 * to On click, which stops them injecting at all.
 */
/**
 * A refusal from the browser's own extension policy. Chromium blocks scripting
 * on hosts listed in ExtensionSettings → runtime_blocked_hosts, and browsers
 * built on it ship their own built-in lists. Nothing an extension can do.
 */
function isPolicyBlock(err) {
  return /cannot be scripted|ExtensionsSettings policy|blocked by the administrator/i
    .test(String(err?.message || err));
}

async function probe(tab) {
  if (!tab?.id) return { state: 'unknown' };
  if (!hostOf(tab)) return { state: 'unsupported' };
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING });
    if (res?.ok) return { state: 'running', info: res };
  } catch {
    /* no listener — work out whether we're even allowed to inject one */
  }

  // Distinguish "not injected yet" from "forbidden here" before offering a fix
  // the browser will refuse. An empty function is the cheapest possible probe.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
    return { state: 'absent' };
  } catch (err) {
    return { state: isPolicyBlock(err) ? 'blocked' : 'absent' };
  }
}

function renderStatus(result, tab) {
  const dot = $('statusDot');
  const text = $('statusText');
  const detail = $('statusDetail');
  const activate = $('activate');

  activate.hidden = true;
  dot.className = 'dot';

  if (result.state === 'running') {
    if (result.info.enabledHere) {
      dot.classList.add('ok');
      text.textContent = 'Active on this page';
      detail.textContent = `Version ${result.info.version}. Select text to see the button.`;
    } else {
      dot.classList.add('warn');
      text.textContent = 'Switched off for this site';
      detail.textContent = 'Turn it back on below. The right-click menu still works.';
    }
    return;
  }

  if (result.state === 'blocked') {
    dot.classList.add('bad');
    text.textContent = 'Blocked by the browser';
    detail.textContent = IS_OPERA
      // Opera withholds search-results pages from every extension by default,
      // and the switch is per-extension rather than global.
      ? 'Opera blocks extensions on search results by default. Open opera://extensions, ' +
        'find Highlight Helper, and tick "Allow access to search page results".'
      : 'Your browser forbids extensions from running on this site. Check ' +
        'ExtensionSettings → runtime_blocked_hosts at <browser>://policy.';
    return;
  }

  if (result.state === 'unsupported') {
    dot.classList.add('warn');
    text.textContent = "Can't run on this page";
    detail.textContent =
      'Browsers block extensions on their own pages, the extension store and PDFs.';
    return;
  }

  dot.classList.add('bad');
  text.textContent = 'Not running on this page';
  detail.textContent =
    'Usually because the tab was open before the extension was reloaded — refresh it. ' +
    "If refreshing doesn't help, check Site access is set to \"On all sites\" in the " +
    "extension's details.";
  activate.hidden = false;
  activate.dataset.tabId = String(tab.id);
}

async function refreshStatus() {
  const tab = await activeTab();
  renderStatus(await probe(tab), tab);
  return tab;
}

(async function init() {
  let settings = await getSettings();
  const tab = await activeTab();
  const host = hostOf(tab);

  $('enabled').checked = settings.enabled;
  $('enabled').addEventListener('change', async (e) => {
    settings = await saveSettings({ enabled: e.target.checked });
    refreshStatus();
  });

  if (host) {
    $('siteHost').textContent = host;
    $('siteRow').hidden = false;
    $('siteEnabled').checked = !settings.disabledSites.includes(host);
    $('siteEnabled').addEventListener('change', async (e) => {
      const next = e.target.checked
        ? settings.disabledSites.filter((h) => h !== host)
        : [...new Set([...settings.disabledSites, host])];
      settings = await saveSettings({ disabledSites: next });
      refreshStatus();
    });
  }

  // Clicking the toolbar button granted activeTab, so this injection is allowed
  // even when the declared content script never ran.
  $('activate').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const tabId = Number(button.dataset.tabId);
    button.disabled = true;
    button.textContent = 'Activating…';
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['src/content/loader.js']
      });
      await new Promise((r) => setTimeout(r, 250));
      button.disabled = false;
      button.textContent = 'Activate on this page';
      refreshStatus();
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Activate on this page';
      // A policy refusal is final — no retry will help, so say what it means
      // rather than showing the browser's raw wording.
      if (isPolicyBlock(err)) renderStatus({ state: 'blocked' }, { id: tabId });
      else $('statusDetail').textContent = `Couldn't inject: ${err.message}`;
    }
  });

  renderProviderState();
  renderHighlightState();

  $('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  refreshStatus();
})();
