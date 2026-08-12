import { getSettings, saveSettings, getApiKey } from '../common/settings.js';

const $ = (id) => document.getElementById(id);

/** Hostname of the active tab, or null for chrome:// pages and the like. */
async function activeHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
}

(async function init() {
  let settings = await getSettings();
  const host = await activeHost();

  $('enabled').checked = settings.enabled;
  $('enabled').addEventListener('change', async (e) => {
    settings = await saveSettings({ enabled: e.target.checked });
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
    });
  }

  const key = await getApiKey();
  const state = $('keyState');
  if (key) {
    state.textContent = 'DeepSeek key saved. All tools available.';
  } else {
    state.textContent = 'No DeepSeek key — currency and unit conversion only.';
    state.className = 'key bad';
  }

  $('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
})();
