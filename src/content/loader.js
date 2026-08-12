/**
 * Classic content script whose only job is to pull in the real, ES-module
 * implementation. Manifest content scripts can't be declared as modules, so a
 * dynamic import() of an extension URL is the way in — and it lets the rest of
 * the extension stay in small importable files with no bundler in the loop.
 *
 * The catch: on some sites this import is refused by the *page's* CSP, because
 * script loads initiated from a content script can be attributed to the page.
 * A site whose `script-src` is a nonce allowlist — Google's, for one — has no
 * entry for chrome-extension:, so nothing loads and the extension looks simply
 * absent. The failure is reported loudly here because it is silent otherwise.
 */
(async () => {
  // Ad frames and tracking pixels have no selectable text worth acting on.
  if (window !== window.top && (window.innerWidth < 80 || window.innerHeight < 80)) return;

  if (window.__highlightHelperLoaded) return;
  window.__highlightHelperLoaded = true;

  try {
    await import(chrome.runtime.getURL('src/content/main.js'));
  } catch (err) {
    window.__highlightHelperLoaded = false;
    const blocked = /Content Security Policy|Failed to fetch dynamically imported/i
      .test(String(err?.message || err));
    console.error(
      blocked
        ? '[Highlight Helper] this page\'s Content-Security-Policy blocked the extension ' +
          'from loading its own code, so the selection button and the right-click menu ' +
          'will not work here. Original error:'
        : '[Highlight Helper] could not start:',
      err
    );
  }
})();
