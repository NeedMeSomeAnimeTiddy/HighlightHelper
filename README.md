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
| `#3f8ae0`, `rgb(63,138,224)`, `hsl(212,72%,56%)` | Swatch, the other two notations, and contrast on white/black | No — local |
| `1700000000`, `2024-03-15T10:30:00Z` | Your local time in the row. Open it for UTC, ISO, relative ("3 years ago") and both epoch forms | No — local |
| `$50`, `30 EUR`, `£1.2bn` | The converted amount, right there in the row. Open it for the rate, its age, and other currencies | No — free rate API, cached |
| `12 * 8 + 3`, `15% of 240`, `200 + 15%` | The answer. Parsed by hand, never `eval` | No — local |
| `0x1F4`, `0b1011`, `0o755`, `65536` | Decimal, hex, binary, octal, and a byte-size reading | No — local |
| `37.7749, -122.4194`, `37°46'29"N 122°25'09"W` | Decimal and DMS, with OpenStreetMap and Google Maps buttons | No — local |
| `/^(\d{3})-(\d{4})$/gi` | A token-by-token breakdown, indented by group depth, plus what each flag does | No — local |
| A link, an address, a wifi string | A scannable QR code | No — local |
| A code snippet | *Explain this code* with **Find a source**, and *Add comments* returning the same code with comments added | Yes, when you pick the row |
| `65 mph`, `180 lbs`, `72°F`, `5'11"` | The converted measurement in the row. Open it for extras like ft+in or Kelvin | No — local |
| A JWT, base64, `%20` escapes, `&amp;mdash;` entities, JSON | Decoded or pretty-printed. JWT claims are listed, with `exp`/`iat` as real dates and an expiry warning | No — local |
| `SLA`, `CI/CD`, `technical debt` | *Explain this* → one plain-English sentence, then **Find a source** for a real encyclopedia entry | Explain yes; the source lookup is free |
| Text in another language | *Translate* → your language, with a picker to switch | Yes, when you pick the row |
| A paragraph or more | *Summarise* and *Key points*, both with **Find a source** | Yes, when you pick the row |
| A sentence or longer | *Rewrite* → Fix spelling & grammar / Shorter / Formal / Casual / Continue writing, each with **Copy** and **Replace** | Yes, when you pick a tone |
| Anything, with a tool you wrote | *My tools* → your own prompt, run on the selection | Yes, when you pick the row |
| Any prose | *Highlight this* → four colours and a note; it comes back on your next visit | No — local |
| A single word | *Define* → part of speech, senses and examples from Wiktionary, plus **Say it** and **Synonyms** | No — keyless API |
| Any prose | *Link to this text* → a `#:~:text=` URL that scrolls to and highlights exactly this | No — local |
| Any prose | *Search with…* → Google, DuckDuckGo, Wikipedia, YouTube and whatever else you add | No — local |
| Any prose | *Read aloud* → the browser's own voice | No — local |
| Any text | *Text tools* → counts and reading time; UPPER / lower / Title / Sentence / camel / Pascal / snake / kebab / slug; sort, reverse, dedupe and join lines; every email, link or number in the selection; SHA-256 | No — local |

Seventeen of the twenty-two tools never touch the network. Each can be switched
off individually in settings.

The other five need a model, and there are two ways to get one. Chrome can run
**Gemini Nano on your machine** — no key, no cost, and the selection never leaves
the computer — and there is **DeepSeek** for when it can't. Out of the box the
extension uses the on-device model where it can and falls back, so the "Yes"
column above means *"asks a model"*, not *"sends your text to a company"*. See
[Where AI runs](#where-ai-runs).

*Continue writing* is the one rewrite tone that appends rather than replaces, so
its result shows the whole passage with the original dimmed and the new text in
normal weight — and **Copy** and **Replace** take both, because replacing your
paragraph with only its ending would be wrong.

Free tools resolve up front, so the menu often answers before you click anything. Anything
that costs money waits for you to pick its row — that click is the consent.

Long answers **stream**, so you read along as they arrive rather than watching a spinner, and
every AI result takes a **follow-up question** underneath it: *"why?"*, *"shorter"*, *"what
does line 4 do?"*.

Every tool is also on the right-click menu, under **Highlight Helper** — see below.

---

## Install

There is no build step and no dependencies. Load the folder straight into Chrome.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (the one containing `manifest.json`)

Requires Chrome 111 or newer. Edge is verified working. Opera and Opera GX need one extra
tick — **Allow access to search page results** — before the extension works on search pages;
see [Opera and Opera GX](#opera-and-opera-gx-search-results-pages).

**After pulling changes, press the ↻ reload button** on the Highlight Helper card at
`chrome://extensions`. Chrome does not pick up edits to an unpacked extension on its own, and
a changed `manifest.json` always needs one.

Right-click menu entries are the one thing that can look stale even after a reload, because
Chrome stores them in your profile rather than reading them from the extension. The worker
fingerprints the menu and rebuilds it whenever the fingerprint changes, so it heals itself —
but the *new worker code* still has to be loaded first, which is what the reload does.

**Why skipping the reload produces odd symptoms.** The two halves update on different
schedules: content scripts are re-injected on every page load and pick up new files straight
away, while the service worker keeps its old bundle until you reload the extension. So a new
tool can appear in the menu while the worker has never heard of it. That combination now
reports `STALE_WORKER` and the panel says to reload, rather than failing with something
cryptic like "Unknown AI action".

## Where AI runs

Currency and unit conversion work immediately. The explain, translate, summarise and
rewrite tools need a model, and the options page has a **Where AI runs** card with three
settings:

| | |
| --- | --- |
| **On-device when possible, DeepSeek otherwise** | The default. Anything Chrome's built-in model can handle stays on this machine; everything else goes to DeepSeek |
| **On-device only** | Nothing is ever sent to DeepSeek. Tools the local model can't serve say so instead of falling back |
| **DeepSeek only** | Every AI tool goes to DeepSeek |

### The on-device model

Chrome 138 and newer ship Gemini Nano behind four standard APIs — `Summarizer`,
`Translator`, `LanguageDetector` and `LanguageModel`. It costs nothing, works offline, and
is the only configuration where "explain this" on a line of a private document isn't a
request to a company in another country.

It is not free of conditions. The model is a **multi-gigabyte one-time download**, and it
wants roughly 22 GB of free disk and a GPU with more than 4 GB of VRAM (or 16 GB of RAM and
four cores). Plenty of machines don't qualify, which is why the fallback exists and why the
options page tells you which provider is actually in play rather than leaving you to guess.

**The download is a button, never a side effect.** A tool that quietly began fetching
several gigabytes because you highlighted a word would be indefensible, so the panel only
ever *uses* a model that is already there. `availability()` reporting `downloadable` is
treated exactly like unavailable, and the options page offers the download explicitly.

`Writer`, `Rewriter` and `Proofreader` look like a natural fit for the rewrite tones and are
deliberately unused — they are still origin-trial and simply absent from a normal browser.
Those tones go through `LanguageModel` with the same prompt DeepSeek gets.

### Add your DeepSeek API key

Needed unless you are running on-device only.

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

## Nothing happens on a page

Click the Highlight Helper toolbar button. The top of the popup says whether the content
script is actually running in that tab:

| | |
| --- | --- |
| **Active on this page** | It's working. Select some text to get the button. |
| **Not running on this page** | See below — there's an **Activate on this page** button that fixes it immediately. |
| **Switched off for this site** | You turned it off in this popup. The right-click menu still works. |
| **Blocked by browser policy** | The browser forbids extensions on this site. Nothing any extension can do — see below. |
| **Can't run on this page** | Browsers block extensions on their own pages, the extension store and PDFs. |

"Not running" has two ordinary causes, and neither prints anything in the page console, which
is what makes it confusing:

1. **The tab was already open when the extension was reloaded.** Chrome does not inject
   content scripts into existing tabs — only into pages loaded afterwards. Refresh the tab.
2. **Site access is set to "On click."** At `chrome://extensions` → Highlight Helper →
   **Details** → **Site access**, choose **On all sites**. On "On click", Chrome withholds
   content scripts until you invoke the extension on that site.

**Activate on this page** in the popup injects the content script into the current tab
directly, which works in both cases — clicking the toolbar button grants the access needed.
It lasts until you navigate away.

### Blocked by browser policy

Chromium refuses extension scripting on any host in `ExtensionSettings` →
`runtime_blocked_hosts`, reporting *"This page cannot be scripted due to an ExtensionsSettings
policy."* No extension can override it — not by injecting, not by permissions, not by any
manifest setting.

That list can come from an enterprise or school policy, but Chromium-based browsers that
aren't Chrome also ship **their own built-in lists**, so this appears on ordinary personal
machines with no policies configured at all.

### Opera and Opera GX: search-results pages

Opera withholds **search engine results pages** from every extension by default — Google,
Bing and the other built-in engines — as a privacy measure. It is not specific to this
extension, and it is why the selection button appears on ordinary pages but not on a Google
search. There is a per-extension switch:

1. Open `opera://extensions`
2. Find **Highlight Helper**
3. Tick **Allow access to search page results**

The toolbar popup detects Opera and says this directly when it hits the block. Note Opera
does not expose Chromium's `chrome://policy` page, so there is nothing to inspect there.

If a site is blocked for some other reason, a browser that doesn't block it is the only fix.
Edge is verified working.

One console note: service worker errors do **not** appear in the page console. They're at
`chrome://extensions` → Highlight Helper → **service worker**. If the right-click menu does
nothing, that's where a delivery failure would be reported.

## Settings

Everything below lives in `chrome.storage.sync` except the API key.

- **Where AI runs** — on-device, DeepSeek, or on-device first with DeepSeek behind it
- **Convert currencies into** — the target for currency conversion
- **Preferred unit system** — metric or imperial. If a measurement is already in your system,
  it converts the other way, so the answer is always the number you don't already have
- **Gallons, pints and fluid ounces** — US or UK. A UK pint is ~20% larger, so this matters
- **My language** — translations and explanations come back in this language, and text that
  looks like it's in a *different* language pushes the Translate tab to the front
- **Highlights** — the whole library, grouped by page, with delete and Markdown export
- **My tools** — your own prompts, each becoming a menu row and a right-click entry
- **Recent answers** — the history list, with a switch to stop keeping one
- **Tools** — turn individual detectors off
- **Search with…** — which sites the search row offers, plus your own; an entry is a name
  and a URL with `{q}` where the selection goes
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

There is also a keyboard shortcut — <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>
(<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> on a Mac) — which opens the panel on whatever
is selected without touching the mouse. Rebind it at `chrome://extensions/shortcuts`.

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

## The right-click menu

The icon doesn't always appear — a page can swallow mouse events, you might select with the
keyboard, or you may have switched the extension off for that site. So everything is also
under **Highlight Helper** on the right-click menu:

```
Highlight Helper  ▸
  Open Highlight Helper          ← the detected menu, same as clicking the icon
  ───────────────
  Explain this
  Translate to…  ▸               English, Spanish, French, … (16)
  ───────────────
  Summarise
  Key points
  Rewrite  ▸                     Fix grammar / Shorter / Formal / Casual / Continue
  ───────────────
  Convert & decode  ▸            Calculate / currency / units / date & time /
                                 coordinates / colour / number base / regex / decode
  ───────────────
  Explain this code
  Add comments to this code
  Text tools  ▸                  Count / UPPERCASE / … / URL slug
  QR code
```

Picking one opens the panel straight at that result, drilling through submenus on the way, so
Back still walks you out through *Rewrite* to the full menu.

Every tool is here, including the pattern-matched ones. Chrome builds context menus once
rather than per-selection, so *Calculate* is present even when you highlighted a sentence —
but a menu missing the entry you want at the moment you want it is worse than one carrying a
few that don't apply. **Open Highlight Helper** remains the shortcut that just runs detection.

Three things worth knowing:

- **A right-click overrides the per-site switch.** If Highlight Helper is off for the site,
  the menu still works and the panel says so.
- **It also overrides a disabled tool.** Asking for a tool you've switched off in settings
  runs it anyway — you asked for it by name.
- **If a tool doesn't apply**, you get the menu that *does* apply, with a line at the top
  saying why. Asking to summarise the word "SLA" gets "Summarising needs a paragraph or more."

If the content script isn't running on the page at all, the worker injects it and retries
once — that's what the `scripting` permission is for. Some targets can never be reached
whatever we do: Chrome's PDF viewer, `chrome://` pages, and the Web Store.

## Your own tools

Twenty-one built-in tools will always be missing the one you need. So **My tools** on the
options page takes a name and a prompt, and each becomes a menu row and a right-click entry:

> **Explain like I'm five** — *Rewrite the text so a bright ten-year-old would understand it.
> Answer in {lang}.*

`{title}`, `{url}` and `{lang}` are filled in from the page. `{text}` deliberately is **not**.
The selection travels as the user turn, the same as for every built-in tool, so a template
cannot have page content spliced into the middle of its own instructions — anything a website
could put in front of the model stays in the turn where a model expects to find content, not
in the sentence telling it what to do.

One tool is a row. Several collapse into a *My tools* drill-in, so six of them don't push the
detector that actually recognised something below the fold.

## Follow-up questions

Every AI answer used to be a dead end: you read it and the conversation stopped. Now there is
an **Ask a follow-up** box under each one, with the original selection and the answer already
in the conversation, so *"why?"* means what it looks like it means.

Follow-ups are **not cached**. Every other call is keyed on an exact selection and action, so
repeating one is genuinely the same request; a follow-up depends on everything said before
it, and a cache keyed loosely enough to hit would sometimes answer the wrong question.

A failed turn is removed from the conversation rather than left in it — otherwise the next
question carries a question nobody answered, and the model tries to answer both.

## Recent answers

The last sixty things you asked for, on the options page, so you can find one again after
closing the tab. Re-running a tool on the same selection replaces its earlier entry rather
than stacking, since that is the commonest thing there is.

This is a record of what you highlighted while browsing, which is about as personal as
anything here touches — so it is capped, it never syncs, it is one button to clear, and it
can be switched off entirely.

## Highlights

Select text, pick **Highlight this**, choose a colour. It is saved in this browser and
painted again the next time you open that page. Add a note if you want one. The full library
is on the options page, with **Export as Markdown**.

**Nothing is inserted into the page.** Every other tool in this category wraps highlighted
text in `<mark>` elements, and that is where they all break — nodes appearing from nowhere
fight the site's own scripts, invalidate its component tree, break `:nth-child` rules and
occasionally rearrange the thing you were trying to read. This uses the **CSS Custom
Highlight API**, which colours a Range without touching the DOM. The page's structure after
a highlight is identical to before it.

The cost of that is real: a painted range is not an element, so **you cannot click or hover a
highlight**. There is no "click it to see the note". Re-select the text to get the row back,
or use the library. Given the alternative is mutating every page you read, that is the right
way round.

One stylesheet is added to the page, which is unavoidable — `::highlight()` rules have to
live in the document whose ranges they colour, so they cannot go in the panel's shadow root.

**Finding a highlight again.** The text is stored with the words that surrounded it, and
`content/locate.js` searches for that combination. It survives the page gaining a paragraph
above it, which is the ordinary case. When the text is genuinely gone — or when it now
appears several times and the context no longer picks one out — the highlight stays in the
library marked as not found. It is never quietly reattached to whichever paragraph scored
best. That is the same refusal *Find a source* makes about citations and *Link to this text*
makes about fragments: a confident wrong answer is worse than an honest missing one.

Single-page apps replace their content without a navigation, which detaches every range. A
debounced `MutationObserver` re-finds them.

## Find a source

**Find a source** appears after *Explain this*, *Explain this code*, *Summarise* and
*Key points*. It does **not** ask the model for a citation.

DeepSeek has no web access. Asking it for sources produces well-formatted, confident,
entirely invented URLs — worse than offering nothing, because a fabricated citation reads as
authoritative. So the button ignores the model and looks the term up in Wikipedia's public
API: a real article, a real extract, a real link. It is labelled *"an independent reference,
not a citation for the explanation above"* because that is exactly what it is — something to
weigh the explanation against, not evidence for it.

### What gets looked up

A highlighted term *is* the search term. A code snippet and a paragraph are not — searching
Wikipedia for a whole paragraph returns noise — so for those the model is asked one narrow
question first: **name up to three things in this text an encyclopedia would have an article
on.** Then those names are looked up for real.

This is the one job the model can safely do here. It chooses *what to search for*; Wikipedia
decides whether such an article exists. A topic it invented simply finds nothing — it cannot
turn into a fabricated citation. Its reply is parsed defensively too: bullets and numbering
stripped, duplicates collapsed, and anything sentence-length discarded rather than fired at a
search box.

For a summary, topics come from the **original text**, not the summary, so nothing the model
introduced while condensing can become a search term of its own.

Only the first topic is looked up; the rest are buttons, so the usual case costs one search
rather than three.

**Ambiguity is the normal case**, so the panel never silently commits to one reading. "SLA"
and "Mercury" each have several plausible articles, and the alternatives stay on screen as
*Did you mean:* buttons.

Picking the right one uses two signals:

1. **The explanation itself as context.** It describes the sense meant, so candidates are
   scored on word overlap with it. This is what turns "SLA" from *Symbionese Liberation
   Army* into *Service-level agreement*, and lets the same word "Mercury" resolve to the
   planet or the element depending on what was being discussed.
2. **Wikipedia's own relevance ranking, as a prior.** Overlap alone is gameable: *Globule
   (CDN)* is described as a "Discontinued content delivery network" and out-scores the actual
   *Content delivery network* article by repeating the phrase. The prior is worth roughly two
   or three title matches — enough that a marginal edge can't overturn search, not enough to
   hold down a clearly better match.

Search runs wide (10 results) but only the top three get a summary request, because ranking
cannot rescue a pool that lacks the right article and each summary costs a round trip.

Results are cached for 7 days, keyed on term + language + context. A *transport* failure is
never cached — otherwise one rate-limited moment would leave a term answering "no source" for
a week. Requests carry an `Api-User-Agent` header, which is how Wikimedia asks browser-based
callers to identify themselves; without it they rate-limit with a 429.

If there's no article, you get real search links instead — never a generated URL.

## Cost control

DeepSeek calls are cheap but not free, so:

- Nothing is sent on selection. Every AI tool waits for a click
- **The on-device model is tried first**, and it costs nothing at all
- Currency and unit conversion never call DeepSeek at all
- **Find a source** is free after *Explain this* — the term is already known. After *Explain
  this code* or *Summarise* it costs one extra call to work out the topics, and the Wikipedia
  lookups themselves are always free
- Every answer is cached in `chrome.storage.local` keyed by
  `action + model + options + hash(text)`, for 7 days by default. Re-selecting the same text
  and pressing the same button is a storage read, not a request. Cached results are labelled
  as such in the panel, along with **on-device** when that is what answered — where a result
  came from is not a detail, and it is invisible unless the panel says so. On-device answers
  are cached too: they cost nothing but several seconds of inference, and `model` is part of
  the key, so a local answer and a DeepSeek answer for the same selection can never be served
  to each other
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
    tools.js                  the right-click menu tree and its ids
    numbers.js                grouping-aware number parse/format
    text.js                   "is this actually prose?" helpers
    hash.js                   FNV-1a + cache key builder
    prompts.js                the prompts, shared by both providers
    history.js                the last few answers
    cache.js                  TTL + LRU cache over chrome.storage.local
    searchengines.js          the "Search with…" defaults and URL templating
    highlights-store.js       saved highlights, per origin, + Markdown export
  background/
    service-worker.js         message router, context menu, keyboard command
    deepseek.js               chat-completions client (owns the key)
    wikipedia.js              term lookup + context ranking for "Find a source"
    dictionary.js             Wiktionary definitions + Datamuse synonyms
    rates.js                  exchange rate fetch + TTL cache
  content/
    loader.js                 classic content script; imports main.js as a module
    main.js                   selection capture, shadow host, view stack, replace
    local-ai.js               Chrome's built-in model; api.ai() tries it first
    anchor.js                 find this text in the page, unambiguously
    speech.js                 read aloud, via speechSynthesis
    locate.js                 find saved text again, as a real DOM Range
    highlights.js             paint them via the CSS Custom Highlight API
    kit.js                    el(), menu(), and the shared UI pieces
    icons.js                  monochrome 16px SVG glyphs
    qr.js                     QR encoder — byte mode, level M, versions 1-20
    panel.css                 adopted into the shadow root
    detectors/
      index.js                registry + detect()
      color.js  datetime.js  currency.js  coords.js  calc.js
      numberbase.js  regex.js  unit.js  code.js  decode.js
      translate.js  jargon.js  summarize.js  rewrite.js  qr.js
      dictionary.js  highlight.js  link.js  search.js  speak.js
      custom.js  texttools.js
      langdetect.js           small script/stopword language guesser
      codelang.js             "is this code, and which language?"
  options/                    options page
  action/                     toolbar popup
test/
  detectors.test.js           node test/detectors.test.js
  qr-roundtrip.js             independent QR reader, used by the tests
  locate-browser.html         the DOM half of highlights; needs a browser
tools/
  static-server.js            serves the repo so that page can import modules
```

**Why the loader indirection.** Manifest content scripts can't be declared as ES modules, so
`loader.js` is a one-line classic script that does `import(chrome.runtime.getURL(...))`. That
keeps the source as small importable modules with no bundler anywhere in the loop.

> **Known risk.** On some sites that import is refused by the *page's* CSP, because a script
> load started from a content script can be attributed to the page. A site whose `script-src`
> is a nonce allowlist — `google.com` among them — has no entry for `chrome-extension:`, so
> nothing loads and the extension looks simply absent: no selection button, and the
> right-click entries do nothing because there is no listener to receive them. `loader.js`
> now reports this explicitly in the page console. The fix, if it bites, is to bundle the
> content modules into one classic script, which means adding a build step.

**Why the stylesheet has a fallback path.** A content script's own `fetch` runs against the
page's network context, so a site with a restrictive `connect-src` can stop the extension
reading its own `panel.css` — and the panel would render completely unstyled. The direct
fetch is the fast path; when it fails, the worker reads the file instead, which no page
policy can affect.

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

**Why entrance transitions don't use `requestAnimationFrame`.** Same principle. The resting
class list is the *visible* one; `playEnter()` adds the hidden state, forces a reflow to
commit it, and removes it again synchronously, which transitions to the resting state. An
earlier version added the visible class in a rAF callback, which meant the entire panel
rendered at `opacity: 0` until a frame arrived. Revealing the UI must be what happens when
nothing runs, not something that has to run.

**Why linking to a highlight and re-finding a highlight are one file.** Generating a
`#:~:text=` fragment and re-attaching a saved highlight to a page that has changed are the
same problem: find this text, and be sure there is only one of it. `content/anchor.js` is
that, written once.

The hard part is never finding the text. It is refusing to guess. A link to the third
occurrence of "however" that lands on the first *looks like it worked*, so `buildTextFragment`
returns null rather than emitting a directive it can't prove is unique, and the panel offers
the plain page URL instead. Uniqueness is tested against a normalised copy of the page's own
text using the same three rules the browser matches by — case-insensitive, whitespace
collapsed, whole words — and it errs towards finding *more* matches than the browser would,
which is the safe direction: the cost is a longer link, never a wrong one.

Two things that were wrong in the first version and are worth not rediscovering. Rebuilding
the surrounding context by splitting into words and rejoining with spaces turns "on the mat"
followed by ". Later" into "on the mat later", which appears nowhere on the page — so the
uniqueness probe failed and perfectly linkable selections were refused. The context is a
character window now, a real contiguous slice, so what gets tested is exactly what gets
emitted. And `encodeURIComponent` leaves `-` alone, which is the character that marks a
prefix or suffix — an ordinary hyphenated word would silently restructure the whole
directive, so `encodePart` escapes it by hand.

**Why the dictionary ranks ahead of "Explain this".** Selecting one ordinary word used to
spend a model call answering a question a dictionary answers better and for free. So
`dictionary` sits at priority 38 and `jargon` at 40, and jargon keeps the acronyms and
multi-word phrases it is actually good at. Pronunciation is `speechSynthesis` rather than a
second API, because the browser can already say the word.

**Why "Search with…" ships ten engines and not a hundred.** It is the largest category in
every tool of this kind — PopClip carries well over a hundred — and shipping that many makes
the menu worse for everyone who wanted three. The list is editable instead, and an entry is
just a URL with `{q}` in it.

**Why the catch-alls all share one gate.** `search`, `link`, `speak` and `texttools` match on
shape rather than on a pattern, so each of them would happily offer to search for `#3f8ae0`,
link to `$50` and read a JWT aloud. A selection like that already has a detector that owns
it, and a second row is pure noise — so all four go through `looksLikeLanguage()`, and a
block of tests pins down what they must *not* claim. The right-click menu still reaches any
of them by name, because asking for a tool explicitly is different from being offered it.

**Why HTML entities are decoded by table rather than by `innerHTML`.** The usual one-liner
is to assign the text to a detached element's `innerHTML` and read `textContent` back. That
is an HTML parser pointed at untrusted text, and the fact that it happens to be inert for
entities alone is not a property worth depending on inside a content script that runs on
every page. So there is a small named table and a code-point branch, and anything unrecognised
is left written out.

**Why detectors have a "is this prose?" gate.** `translate`, `rewrite`, `summarize`,
`texttools` and `qr` match on shape rather than on a pattern, so without `common/text.js`
and `detectors/codelang.js` they cheerfully offer to translate a hex colour, rewrite a JWT
and QR-encode a whole paragraph. A selection like `#3f8ae0` already has a detector that owns
it; a second, useless row is pure noise. "Fix spelling & grammar" pointed at a function body
is worse than noise, which is why `rewrite` refuses anything `isCode()` recognises.

**Why the context menu is fingerprinted.** Chrome keeps context menus in the browser profile,
not in the extension — they persist until something removes them. Building them only on
`onInstalled`/`onStartup` means a changed menu can stay stale indefinitely, which looks
exactly like the new code never shipped. So the worker hashes the menu tree, stores the hash,
and compares on every start: one storage read in the common case, a rebuild when they differ.

**How the right-click menu stays in step.** Each context-menu id in `common/tools.js` is also
a menu-row `key`, so a click is just "open the panel and drill to this row" — including two
levels down, since `kit.menu()` stashes its item list on the element it builds. The two lists
live apart deliberately: `tools.js` imports no detectors, so the service worker never pulls in
content-script code. A test walks both and fails if an id stops matching a real row, which is
the only thing standing between a renamed key and a menu entry that silently does nothing.

**How the QR encoder is checked.** It is written from scratch, so `test/qr-roundtrip.js` is a
separate reader that decodes a generated matrix back to its original text and verifies the
Reed–Solomon syndromes. The block tables are cross-checked against an independent
total-codeword table by the identity

    group1·data1 + group2·data2 + ec·blocks === totalCodewords[version]

which is what catches a transposed digit — the failure mode where codes still look right but
only some scanners read them. The generator polynomial and Reed–Solomon output are also
pinned to the published worked example. What none of that proves is that the *layout* matches
the specification: a self-consistently wrong zig-zag would still round-trip. Scanning one
with a phone is the check that closes that gap.

**Where the network lives.** Only the service worker. Content scripts send messages; they
never hold the API key and never call `fetch` against DeepSeek.

**Why streaming needs a port and not a message.** `chrome.runtime.sendMessage` resolves once,
so it cannot deliver tokens as they arrive — a long summary sits behind a spinner for its
whole duration even though the first sentence was ready almost immediately. So the AI path
uses `chrome.runtime.connect`, one port per request. Disconnecting is also the cancel signal:
leaving a view while an answer is still arriving should stop paying for it, and a disconnect
is the only notification a worker gets that nobody is listening any more.

The SSE reader carries the tail of each network read forward rather than parsing it. Splitting
on newlines and hoping works until a token straddles a packet boundary, at which point it
drops a word in the middle of a paragraph — the kind of failure nobody reports, because it
reads like the model wrote it.

Streamed text is deliberately **not** tidied on the way past. `cleanOutput` strips wrapping
quotes and fences, and it cannot tell an opening fence from a complete one until the answer
ends; better a fence visible for a moment than text that flickers as the stripping changes its
mind. The cleaned version replaces it when the stream finishes.

**Why a custom tool's prompt never contains the selection.** `fillTemplate` substitutes
`{title}`, `{url}` and `{lang}` — and not `{text}`. The selection travels as the user turn,
the same as for every built-in tool. A template that interpolated page content into its own
instructions would put whatever a website chose to say in the sentence telling the model what
to do; keeping it in the turn where a model expects to find content is the difference between
data and instructions.

**Why the on-device model is the exception to that.** The rule exists because the worker owns
the API key. There is no secret in a local model, so the argument doesn't apply — and the
Prompt API is unavailable in worker contexts, so the worker couldn't run it regardless. The
alternative is an offscreen document, which buys one central session at the cost of a
permission and a lifecycle to manage; not worth it for a provider with nothing to hide. So
`local-ai.js` runs in the page, and `cache.js` moved to `common/` because the content script
now caches its own answers — content scripts can only import what
`web_accessible_resources` lists, which covers `common/` and `content/` and deliberately not
`background/`.

**Why both providers share one set of prompts.** `common/prompts.js` is imported by the
DeepSeek client and by `local-ai.js` alike. A tool should not change its mind about what it
is depending on who answered, and the only way to guarantee that is for there to be one set
of words. The task APIs are the exception — `Summarizer` and `Translator` take options rather
than a prompt — which is why the key-points output is normalised back to the `• ` bullet the
panel and the DeepSeek prompt both use.

**Why `runLocal` returns null rather than throwing.** "I can't serve this one" is not a
failure: no model, wrong language pair, a selection past the context window. Those are
ordinary limits, and treating them as errors would mean `auto` couldn't fall through. It
throws only when a session was created and then died. The one place that distinction is
inverted is **on-device only**, where falling back would break the promise the setting makes,
so there a refusal is reported.

**Why availability probes are memoised and time-limited.** `Translator.availability()` for a
real language pair was measured taking over eight seconds on a machine with no language pack
installed. Unraced, that hangs a row; unmemoised, every AI click on a browser that has the
APIs but not the model pays the timeout before falling back — which is most of the installed
base, and would make the extension feel slower than before any of this existed. So probes are
raced against 1.5s and cached for a minute. The TTL is what stops a freshly downloaded model
needing every open tab reloaded before it is noticed.

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

306 assertions over number parsing, every detector's `matches()`, menu row construction,
ordering, the QR encoder and its round trip, the right-click menu's ids, and that every AI
action a menu row can send has a prompt waiting for it — including a block that pins down
what the catch-all detectors must *not* claim. No framework, no
dependencies. `package.json` exists only so Node treats the source as ES modules — Chrome
never reads it.

The tests cover `matches()` and `items()`, which is where the fiddly logic lives; `open()` is
lazy, so rows can be inspected without a DOM. The rendering and selection machinery is not
covered — load the extension and try it.

Some things cannot be checked without a browser: real text nodes, real Ranges, and whether
the CSS Custom Highlight API does what it claims. Those live in a page of their own.

```bash
node tools/static-server.js
```

Then open `http://localhost:8712/test/locate-browser.html` — the title bar says how many
passed. It imports the real modules rather than a copy, so it cannot drift from them, and it
needs an origin because ES modules do not load over `file://`. It covers the cases Node
can't reach: text spanning inline elements, a phrase that appears twice being refused, a
highlight surviving a paragraph appearing above it, and the fact that painting inserts no
elements. This is the same role `qr-roundtrip.js` plays for the QR encoder — the check that
closes the gap between "self-consistent" and "actually works".

Node has none of the built-in AI globals, which makes it exactly the unsupported-browser case
— so the provider tests assert the contract that matters there: `runLocal` *declines* rather
than throwing, which is what lets `auto` fall through to DeepSeek. What Node cannot check is
the on-device path actually working; that needs a browser with the model installed.

## Ideas not built

[ROADMAP.md](ROADMAP.md) has the longer version — what the tools in this space do that this
one doesn't, in phases, with the reasons for what was rejected. The table below is the
short-list that predates it.

Sketched and deliberately left out, roughly in order of how useful they'd be:

| Idea | Note |
| --- | --- |
| **Extract to table** — turn pasted rows into a Markdown table | AI; good for pasted spreadsheet output |
| **Hash** — SHA-256 of the selection via SubtleCrypto | Easy, but narrow |
| **Time zone converter** — "3pm EST" in your zone | Parsing zone abbreviations is genuinely ambiguous (CST is three zones) |
| **HTML entity decode** — `&amp;#8212;` | Fits `decode.js` as another branch |
| **Convert code to another language** | Sits naturally next to *Explain this code* |
| **Roman numerals**, **IBAN/phone formatting** | Cute, rarely wanted |

## Known limitations

- **Language detection is a heuristic** (script ranges plus stopword counting). It only
  decides how prominently the Translate tab is ranked, never what gets translated, so a wrong
  guess costs a tab position and nothing else. It stays a heuristic because `matches()` is
  synchronous by contract and the real `LanguageDetector` is not — that API is used where it
  actually matters, picking the *source* language for an on-device translation, where a wrong
  guess would translate from the wrong language rather than cost a row position.
- **The on-device model has a small context window.** Selections over ~4,000 characters go to
  DeepSeek instead (~12,000 for summarising, which the Summarizer handles separately).
  Overflowing it produces a confident truncated answer rather than an error, which is the
  worst failure mode available, so the limit is enforced before the call rather than hoped
  about. On **on-device only** this means a long selection is refused rather than silently
  half-read.
- **On-device answers are not identical to DeepSeek's.** Gemini Nano is a much smaller model.
  The prompts are the same and the output is cleaned the same way, but a summary will be
  blunter and an explanation shorter. The panel labels which one answered so a surprising
  result is at least attributable.
- **A bare `$` is read as USD.** Distinguishing USD from CAD/AUD/etc. needs page context the
  extension doesn't have. Prefixed forms (`CA$`, `A$`, `US$`) are handled.
- **Ambiguous unit abbreviations** (`in`, `m`, `t`, `st`, `pt`, `l`) only match at the end of a
  clause or before a size word like *tall* or *wide*, so "5 in the morning" isn't 12.7 cm.
- **Base64 detection is conservative.** A candidate is only accepted if it decodes to mostly
  printable text, and an unpadded all-letters string is skipped entirely — plenty of ordinary
  words are technically valid base64. Padded and mixed-case payloads are fine.
- **Named CSS colours are not matched.** "orange", "tomato" and "plum" are ordinary words far
  more often than they are colours.
- **Dates are only parsed as epoch values or ISO 8601.** `Date.parse` on arbitrary prose is
  lenient and inconsistent between engines, so "next friday" or a bare "12/03" would produce a
  confident, wrong answer rather than no answer.
- **QR codes are byte mode, level M, versions 1–20** — a 666-byte ceiling. Numeric and
  alphanumeric modes would pack more in but only matter past that limit. The code is always
  rendered dark-on-light, ignoring dark mode, because an inverted QR defeats many scanners.
- **A bare regex needs a real construct to be recognised** — `\d`, a character class, a
  counted quantifier, a lookaround, an anchor, or alternation inside a group. `(hi)` on its own
  is far more likely to be prose in brackets, so it is left alone. Wrap it in `/…/` to be
  unambiguous.
- **The code language guess is a keyword heuristic.** It is used only to hint the prompt and
  to label the row, never to change behaviour; a wrong guess costs a word in a prompt the model
  is free to ignore.
- **Map buttons open a third-party site** with the coordinates in the URL. They are explicit
  buttons rather than anything automatic, and OpenStreetMap is listed first because it needs no
  account.
- **Replace can't reach every editor.** It uses the native value setter for inputs/textareas
  (so React-style controlled components see the change) and `execCommand('insertText')` for
  contenteditable. Editors with their own document model — Google Docs, some CodeMirror
  setups — won't accept it. Copy always works.
- **PDFs and the Chrome Web Store** don't run content scripts, so nothing appears there — and
  the right-click fallback can't reach them either, since injection is blocked on those
  targets too.
- **Context menu entries are static.** Chrome has no "before show" event, so the same entries
  appear whatever you highlighted; the panel explains when one doesn't apply rather than the
  menu hiding it.
- **Same-tab frames only.** The script runs in frames larger than 80×80px; selections inside a
  cross-origin iframe are handled by that frame's own copy.
- **A link to a highlight can be refused.** Text that appears in several places and can't be
  pinned down by its surroundings gets no fragment — the panel says so and offers the plain
  page link. That is deliberate: a fragment landing on the wrong paragraph looks like it
  worked. Text fragments are also Chromium and Safari only; in Firefox the link still opens
  the right page, it just doesn't scroll.
- **The dictionary is Wiktionary, so coverage is uneven.** Common words are well served;
  proper nouns and very new usage often aren't, and non-English entries vary by language.
  Synonyms are English only, because Datamuse is an English corpus and offering it elsewhere
  would return nothing and look broken.
- **Read aloud uses whatever voices the OS has.** Chrome's `getVoices()` is empty on its first
  call, so the very first reading may use the default voice rather than one matched to the
  text's language. It is not worth an event listener to fix a one-time accent.
- **Extraction finds shapes, not meaning.** "Numbers" will happily pull the 3 out of "COVID-19
  in 3 charts". It never invents anything, but it doesn't know what it found.
- **A highlight cannot be clicked.** It is a painted Range, not an element, so there is
  nothing on the page to hover or click. That is the price of not mutating the DOM, and it is
  paid deliberately. Re-select the text, or use the library.
- **Highlights are per browser, per machine.** `chrome.storage.local`, no sync and no server.
  Sync has a 100 KB quota and would race between machines; a server would need an account.
  Export to Markdown is the way to get them out.
- **A highlight can be lost.** If the page rewrites the passage, or the text now appears
  several times and the stored context no longer picks one out, it stays in the library marked
  as not found rather than being reattached to a guess. Sites that rebuild their DOM
  constantly may lose highlights between visits.
- **The CSS Custom Highlight API is required.** Chrome and Edge 105+, Safari 17.2+. Firefox
  has it from 140. Without it the Highlight row simply doesn't appear.
- **A streamed answer that fails halfway is an error, not a partial answer.** There is no way
  to tell from the text that it stopped early, so half a summary presented as a whole one
  would be worse than a failure you can retry.
- **Follow-ups are not cached and cost a call each.** They also grow the conversation, so a
  long thread on the on-device model will eventually exceed its context window and fall back
  to DeepSeek mid-conversation.
- **A custom tool is only as good as its prompt.** There is no validation beyond "it has a
  name and a prompt" — a vague instruction gets a vague answer, and the extension has no way
  to tell the difference.
- **History records what you highlighted.** Sixty entries, local, off in one click, cleared in
  one more. It is the most personal thing stored here and it is treated that way, but it is
  worth knowing it exists.
