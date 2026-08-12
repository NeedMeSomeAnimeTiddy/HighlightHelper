# Highlight Helper

A Chrome extension (Manifest V3) that turns any text selection into something useful.

Select text on a page and a small icon appears next to it. Click the icon and you get a
menu of what you can do with that text — like a right-click menu, but built from what the
selection actually is:

```
╭──────────────────────────────────╮
│  “The trip costs $50 for 5 miles” │
├──────────────────────────────────┤
│  ⇄   Convert to EUR       €46.10 │   ← free, already answered
│  ⇉   Convert to km       8.05 km │   ← free, already answered
│  ✎   Rewrite            13 words ›│
│  ⌘   Translate to English        ›│
╰──────────────────────────────────╯
       Highlight Helper    Settings
```

| Selection | Menu offers | Costs an API call? |
| --- | --- | --- |
| `$50`, `30 EUR`, `£1.2bn` | The converted amount, right there in the row. Open it for the rate, its age, and other currencies | No — free rate API, cached |
| `65 mph`, `180 lbs`, `72°F`, `5'11"` | The converted measurement in the row. Open it for extras like ft+in or Kelvin | No — all local |
| `SLA`, `CI/CD`, `technical debt` | *Explain this* → one plain-English sentence | Yes, when you pick the row |
| Text in another language | *Translate* → your language, with a picker to switch | Yes, when you pick the row |
| A sentence or longer | *Rewrite* → Fix spelling & grammar / Shorter / Formal / Casual, each with **Copy** and **Replace** | Yes, when you pick a tone |

Free tools resolve up front, so the menu often answers before you click anything. Anything
that costs money waits for you to pick its row — that click is the consent.

You can also right-click any selection and pick **Translate to…** for a one-off translation
into a language other than your default; that opens the panel straight at the result.

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

- Select text → a small icon appears at the end of the selection
- Click the icon → the menu opens, one row per applicable tool
- Pick a row → it **drills in** within the same panel, with a back arrow in the header.
  The panel animates to each view's height rather than jumping, and its width never changes
- **Rewrite** drills into its four tones rather than using a hover flyout — a flyout near a
  screen edge has to flip sides and is awkward on touch

| Key | Does |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move through the menu rows |
| <kbd>Enter</kbd> | Open the highlighted row |
| <kbd>Esc</kbd> | Go back one level, or close at the top level |
| <kbd>Backspace</kbd> / <kbd>←</kbd> | Go back one level |

Keys are only captured when you aren't typing — if the selection came from a text field,
that field keeps its arrow keys and only <kbd>Esc</kbd> is intercepted.

**Replace** writes the result back over your selection. It only works when the selection came
from a text field, textarea, or contenteditable — ordinary page text isn't editable, and the
button is disabled with a tooltip explaining why.

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
    main.js                   selection capture, shadow host, view stack, replace
    kit.js                    el(), menu(), and the shared UI pieces
    icons.js                  monochrome 16px SVG glyphs
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

**Why shadow DOM.** The panel is attached to a shadow root on `<html>` with `all: initial`
set inline, so page rules like `div { color: red }` can't reach in and the panel's CSS can't
leak out. `panel.css` is a real stylesheet fetched once and adopted via `adoptedStyleSheets`.

One consequence is worth knowing before editing the CSS: an inline `all: initial` outranks
any `:host` rule, so `:host { color: … }` loses and every descendant inherits `initial` —
black text, invisible on the dark surface. Custom properties are the exception, since `all`
never resets them. So the `--hh-*` tokens live on `:host`, and every *inherited* text
property is set on `.hh-layer` instead, which page CSS can't reach anyway.

**Why the panel's height rests on `auto`.** Results arrive at unpredictable times, and an
explicit height that failed to update would clip them. The height is pinned only for the
150ms of a view transition and released by a timer — not `transitionend`, which never fires
under `prefers-reduced-motion`. The `ResizeObserver` is purely positional, so the panel can
flip above the selection if a result grows past the bottom of the viewport; if it never
fires, nothing is clipped.

**Where the network lives.** Only the service worker. Content scripts send messages; they
never hold the API key and never call `fetch` against DeepSeek.

### Adding a detector

A detector decides whether it applies, then contributes menu rows:

```js
// src/content/detectors/mything.js
import { el, asyncView } from '../kit.js';

export default {
  id: 'mything',        // stable key; also the settings toggle
  title: 'My Thing',    // human name, shown in options
  priority: 35,         // lower = ranked earlier in the menu

  // Cheap and side-effect free — this runs on every selection.
  // Return falsy for no match, or an object describing the match. It may
  // carry its own `priority` to override the default for this one hit.
  matches(text, settings) {
    const ducks = (text.match(/🦆/g) || []).length;
    return ducks ? { ducks } : null;
  },

  // Returns the rows this detector wants in the menu.
  items({ text, match, settings, api }) {
    return [{
      key: 'mything',                 // unique; lets the panel open it directly
      icon: 'explain',                // glyph name from ../icons.js
      label: 'Count the ducks',
      value: String(match.ducks),     // string | Promise<string> | omitted
      detailTitle: 'Ducks',
      open: (ctx) => el('div', { class: 'hh-detail' },
        el('div', { class: 'hh-text', text: `There are ${match.ducks} of them.` }))
    }];
  }
};
```

Then:

1. Import it in `src/content/detectors/index.js` and add it to `LIST`
2. Add `mything: true` to `DEFAULTS.detectors` in `src/common/settings.js`
3. Optionally add a one-line blurb to `DETECTOR_BLURB` in `src/options/options.js`

**Row rules.** `value` may be a `Promise` when the answer is free but not instant — the row
shows a pulse until it resolves, and a rejection turns into a warning glyph. Anything that
costs money must wait for `open`. Omit `open` entirely for a static, unclickable row.

**Building views.** `open` returns an element synchronously. Use `kit.asyncView(label,
producer, onError)` for the spinner → result → retry shape, and `kit.menu(items, api)` to
nest a submenu — that's all the rewriter's tone list is.

The `api` object gives you:

| | |
| --- | --- |
| `api.ai(action, text, options)` | DeepSeek call via the worker; resolves to `{ text, cached }` |
| `api.send(message)` | raw message to the service worker |
| `api.copy(text)` | clipboard write with a fallback; resolves to a boolean |
| `api.replace(text)` | write back over the selection; returns a boolean |
| `api.canReplace` | whether the selection is editable at all |
| `api.errorFor(err, retry)` | friendly error element, with a Settings link for key problems |
| `api.push(title, node)` / `api.pop()` | drive the view stack yourself |
| `api.context` | `{ title, host, url }` of the page |
| `api.settings` | current settings |

Useful pieces from `kit.js`: `resultView`, `actionRow`, `copyButton`, `quote`, `spinner`,
`note`, `errorBox`, `btn`, `el`, `glyph`.

New AI actions need a prompt in `buildPrompt()` in `src/background/deepseek.js` and a name in
`AI` in `src/common/constants.js`.

## Tests

```bash
node test/detectors.test.js
```

74 assertions over number parsing, currency matching, unit conversion, acronym detection,
language guessing, menu row construction, and ordering. No framework, no dependencies.
`package.json` exists only so Node treats the source as ES modules — Chrome never reads it.

The tests cover `matches()` and `items()`, which is where the fiddly logic lives; `open()` is
lazy, so rows can be inspected without a DOM. The rendering and selection machinery is not
covered — load the extension and try it.

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
