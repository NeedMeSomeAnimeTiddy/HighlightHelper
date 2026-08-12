# Highlight Helper

A Chrome extension (Manifest V3) that turns any text selection into something useful.

Select text on a page and a small icon appears next to it. Click the icon and a compact
panel opens with whatever applies to what you selected:

| Selection | What you get | Costs an API call? |
| --- | --- | --- |
| `$50`, `30 EUR`, `£1.2bn` | Converted into your currency, with the rate and its age | No — free rate API, cached |
| `65 mph`, `180 lbs`, `72°F`, `5'11"` | Converted to the other unit system | No — all local |
| `SLA`, `CI/CD`, `technical debt` | One-line plain-English explanation | Yes, on click |
| Text in another language | Translation into your language | Yes, on click |
| A sentence or longer | Fix grammar / Shorter / Formal / Casual, with **Copy** and **Replace** | Yes, on click |

You can also right-click any selection and pick **Translate to…** for a one-off translation
into a language other than your default.

Nothing is ever sent to an API until you click a button.

---

## Install

There is no build step and no dependencies. Load the folder straight into Chrome.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (the one containing `manifest.json`)

Requires Chrome 111 or newer.

## Add your DeepSeek API key

Currency and unit conversion work immediately. The explain, translate, and rewrite tools
need a DeepSeek key.

1. Get a key from [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
2. Open the extension's options page — either:
   - click the Highlight Helper toolbar icon, then **Settings…**, or
   - go to `chrome://extensions`, find Highlight Helper, click **Details** → **Extension options**
3. Paste the key into the **DeepSeek API key** field under the *DeepSeek API key* heading
4. Click **Save key**, then **Test key** to confirm it works

**Where the key lives:** `chrome.storage.local`, on this machine only. It is deliberately
*not* in `chrome.storage.sync`, so it never travels to your Google account, and it is never
written to any file in this repo. Only the background service worker ever reads it —
content scripts ask the worker to make calls and never see the key themselves.

## Settings

Everything below lives in `chrome.storage.sync` except the API key.

- **Convert currencies into** — the target for currency conversion
- **Preferred unit system** — metric or imperial. If a measurement is already in your system,
  it converts the other way, so the answer is always the number you don't already have
- **Gallons, pints and fluid ounces** — US or UK. A UK pint is ~20% larger, so this matters
- **My language** — translations and explanations come back in this language, and text that
  looks like it's in a *different* language pushes the Translate tab to the front
- **Tools** — turn individual detectors off
- **Rewriter threshold** — how long a selection has to be before the Rewrite tab appears
- **Cache** — how long AI answers are kept, plus a clear button
- **Sites** — a master switch, and per-site opt-outs (set those from the toolbar popup)

## Interaction

- Select text → small icon appears at the end of the selection
- Click the icon → panel opens, with a tab per applicable tool
- <kbd>Esc</kbd> or a click anywhere outside dismisses the panel
- <kbd>←</kbd> / <kbd>→</kbd> move between tabs when a tab has focus
- **Replace** writes the result back over your selection. It only works when the selection
  came from a text field, textarea, or contenteditable — ordinary page text isn't editable,
  and the button is disabled with a tooltip explaining why

## Cost control

DeepSeek calls are cheap but not free, so:

- Nothing is sent on selection. Every AI tool waits for a click
- Currency and unit conversion never call DeepSeek at all
- Every answer is cached in `chrome.storage.local` keyed by
  `action + model + options + hash(text)`, for 7 days by default. Re-selecting the same text
  and pressing the same button is a storage read, not a request. Cached results are labelled
  as such in the panel
- The cache holds 400 entries and evicts oldest-first

Exchange rates come from [open.er-api.com](https://open.er-api.com) — the keyless endpoint of
the exchangerate-api.com family. No signup. Rates are cached per base currency until the
service's own next update (clamped to 1–24 hours). If the network is down, the last known
rates are used and the panel says they're cached.

---

## Architecture

```
manifest.json
icons/                        16 / 48 / 128 px
src/
  common/                     shared by every context
    constants.js              message + action + error names
    settings.js               defaults, sync/local split, API key accessors
    currencies.js             ISO codes, symbol table, display symbols
    languages.js              language list + context-menu subset
    numbers.js                grouping-aware number parse/format
    hash.js                   FNV-1a + cache key builder
  background/
    service-worker.js         message router, context menu
    deepseek.js               chat-completions client + prompts (owns the key)
    rates.js                  exchange rate fetch + TTL cache
    cache.js                  TTL + LRU cache over chrome.storage.local
  content/
    loader.js                 classic content script; imports main.js as a module
    main.js                   selection capture, shadow-DOM host, panel, replace
    kit.js                    el() and the shared UI pieces
    panel.css                 adopted into the shadow root
    detectors/
      index.js                registry + detect()
      currency.js  unit.js  translate.js  jargon.js  rewrite.js
      langdetect.js           small script/stopword language guesser
  options/                    options page
  action/                     toolbar popup
test/
  detectors.test.js           node test/detectors.test.js
```

**Why the loader indirection.** Manifest content scripts can't be declared as ES modules, so
`loader.js` is a one-line classic script that does `import(chrome.runtime.getURL(...))`. That
keeps the source as small importable modules with no bundler anywhere in the loop.

**Why shadow DOM.** The panel is attached to a shadow root on `<html>` with `all: initial`,
so host page CSS can't reach in and the panel's CSS can't leak out. `panel.css` is a real
stylesheet fetched once and adopted via `adoptedStyleSheets`.

**Where the network lives.** Only the service worker. Content scripts send messages; they
never hold the API key and never call `fetch` against DeepSeek.

### Adding a detector

A detector is a plain object with two functions:

```js
// src/content/detectors/mything.js
import { el, btn, replaceContent } from '../kit.js';

export default {
  id: 'mything',        // stable key; also the settings toggle
  title: 'My Thing',    // tab label
  priority: 35,         // lower = checked and shown first

  // Cheap and side-effect free — this runs on every selection.
  // Return falsy for no match, or an object describing the match.
  // The object may carry its own `priority` to override the default.
  matches(text, settings) {
    return text.includes('🦆') ? { count: 1 } : null;
  },

  // Returns an element synchronously. Anything slow is your own job to run
  // with a spinner — see kit.withLoading and the currency detector.
  render({ text, match, settings, api }) {
    return el('div', { text: `Found ${match.count} duck(s)` });
  }
};
```

Then:

1. Import it in `src/content/detectors/index.js` and add it to `LIST`
2. Add `mything: true` to `DEFAULTS.detectors` in `src/common/settings.js`
3. Optionally add a one-line blurb to `DETECTOR_BLURB` in `src/options/options.js`

The `api` object passed to `render` gives you:

| | |
| --- | --- |
| `api.ai(action, text, options)` | DeepSeek call via the worker; resolves to `{ text, cached }` |
| `api.send(message)` | raw message to the service worker |
| `api.copy(text)` | clipboard write with a fallback; resolves to a boolean |
| `api.replace(text)` | write back over the selection; returns a boolean |
| `api.canReplace` | whether the selection is editable at all |
| `api.errorFor(err, retry)` | friendly error element, with a Settings link for key problems |
| `api.context` | `{ title, host, url }` of the page |
| `api.settings` | current settings |

New AI actions need a prompt in `buildPrompt()` in `src/background/deepseek.js` and a name in
`AI` in `src/common/constants.js`.

## Tests

```bash
node test/detectors.test.js
```

59 assertions over number parsing, currency matching, unit conversion, acronym detection,
language guessing, and tab ordering. No framework, no dependencies. `package.json` exists
only so Node treats the source as ES modules — Chrome never reads it.

## Known limitations

- **Language detection is a heuristic** (script ranges plus stopword counting). It only
  decides how prominently the Translate tab is ranked, never what gets translated, so a wrong
  guess costs a tab position and nothing else.
- **A bare `$` is read as USD.** Distinguishing USD from CAD/AUD/etc. needs page context the
  extension doesn't have. Prefixed forms (`CA$`, `A$`, `US$`) are handled.
- **Ambiguous unit abbreviations** (`in`, `m`, `t`, `st`, `pt`, `l`) only match at the end of a
  clause or before a size word like *tall* or *wide*, so "5 in the morning" isn't 12.7 cm.
- **Replace can't reach every editor.** It uses the native value setter for inputs/textareas
  (so React-style controlled components see the change) and `execCommand('insertText')` for
  contenteditable. Editors with their own document model — Google Docs, some CodeMirror
  setups — won't accept it. Copy always works.
- **PDFs and the Chrome Web Store** don't run content scripts, so nothing appears there.
- **Same-tab frames only.** The script runs in frames larger than 80×80px; selections inside a
  cross-origin iframe are handled by that frame's own copy.
