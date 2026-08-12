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
async function probe(tab) {
  if (!tab?.id) return { state: 'unknown' };
  if (!hostOf(tab)) return { state: 'unsupported' };
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING });
    return res?.ok ? { state: 'running', info: res } : { state: 'absent' };
  } catch {
    return { state: 'absent' };
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

  if (result.state === 'unsupported') {
    dot.classList.add('warn');
    text.textContent = "Can't run on this page";
    detail.textContent =
      'Chrome blocks extensions on its own pages, the Web Store and PDFs.';
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
    const tabId = Number(e.currentTarget.dataset.tabId);
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Activating…';
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['src/content/loader.js']
      });
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      $('statusDetail').textContent = `Injection failed: ${err.message}`;
    }
    e.currentTarget.disabled = false;
    e.currentTarget.textContent = 'Activate on this page';
    refreshStatus();
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
