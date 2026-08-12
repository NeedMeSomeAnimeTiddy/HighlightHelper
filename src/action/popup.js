import { getSettings, saveSettings, getApiKey } from '../common/settings.js';
import { MSG } from '../common/constants.js';

const $ = (id) => document.getElementById(id);

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
    text.textContent = 'Blocked by browser policy';
    detail.textContent =
      'Your browser forbids extensions from running on this site, so no extension can ' +
      'work here. Open <browser>://policy and look at ExtensionSettings → ' +
      'runtime_blocked_hosts to see the list.';
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

  const key = await getApiKey();
  const state = $('keyState');
  if (key) {
    state.textContent = 'DeepSeek key saved. All tools available.';
  } else {
    state.textContent = 'No DeepSeek key — the local tools still work.';
    state.className = 'key bad';
  }

  $('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  refreshStatus();
})();
