/**
 * Classic content script whose only job is to pull in the real, ES-module
 * implementation. Manifest content scripts can't be declared as modules, but
 * an isolated-world dynamic import() of an extension URL works fine — and it
 * lets the rest of the extension stay in small importable files with no
 * bundler in the loop.
 */
(async () => {
  // Ad frames and tracking pixels have no selectable text worth acting on.
  if (window !== window.top && (window.innerWidth < 80 || window.innerHeight < 80)) return;

  try {
    await import(chrome.runtime.getURL('src/content/main.js'));
  } catch (err) {
    console.warn('[Highlight Helper] could not start:', err);
  }
})();
