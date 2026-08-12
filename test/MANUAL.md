# Manual test checklist

Everything `node test/detectors.test.js` and `test/locate-browser.html` cannot reach: the
network, the model, storage that survives a reload, and every piece of UI.

Ordered cheapest-signal-first. Round 1 loads nearly every module at once, so if something is
structurally broken it fails there rather than forty minutes in.

Work in **Edge** — it is the browser this extension is verified on. Opera and Opera GX block
search-results pages at the browser level; see the README.

When something fails, note **which round** and paste the console output. Two consoles matter
and they are not the same one:

| | |
| --- | --- |
| **Page console** (F12 on the page) | content scripts — the panel, detectors, highlights, on-device AI |
| **Service worker console** (`edge://extensions` → Highlight Helper → **service worker**) | network calls, the context menu, streaming, the cache |

A failure in the worker never appears in the page console. If a right-click entry does
nothing, the worker console is where the reason is.

---

## Setup

- [ ] `edge://extensions` → **Developer mode** on → **Load unpacked** → this folder
- [ ] The card shows no errors. If it shows **Errors**, open them — a manifest problem stops
      everything else being meaningful
- [ ] Open a normal article page (a Wikipedia article is ideal — long, stable, lots of text)
- [ ] **Refresh the tab.** Content scripts are not injected into tabs that were already open

**After any code change: press ↻ on the extension card, then refresh the page.** The two
halves update on different schedules and skipping this produces symptoms that look like bugs.
See the README's install section.

---

## Round 1 — the options page loads

The cheapest possible signal. This page imports the detector registry, the on-device module,
the highlights store, the search engines and the history — almost everything new.

- [ ] Toolbar button → **Settings…** opens the options page
- [ ] Page console is clean. **A module error here means nothing below will work** — fix first
- [ ] All ten cards are present, in this order:
      Preferences · Where AI runs · DeepSeek API key · Tools · My tools · Recent answers ·
      Highlights · Search with… · Cache · Sites
- [ ] **Tools** lists 22 entries, each with a description
- [ ] Change **My language**, reload the page, confirm it stuck

---

## Round 2 — where AI comes from

### The on-device model

The hardware bar is real: roughly 22 GB free disk and >4 GB VRAM (or 16 GB RAM and 4 cores).
**If this machine does not qualify, the correct result is a clear refusal**, not a failure.

- [ ] **Where AI runs** → the status line under *On-device model* says one of:
      *Ready* · *Supported, but the model needs downloading first* · *This machine can't run
      it* · *Not available in this browser*
- [ ] It says something within a few seconds — it must never sit on *Checking…* forever
      (availability probes are raced against a timeout precisely because they can hang)
- [ ] If **Download the model** appears: click it. Progress percentages should advance.
      This is multi-gigabyte — leave it running
- [ ] After downloading, the line reads *Ready*

### Provider choice

- [ ] Switching **Answer with** updates the hint text underneath immediately
- [ ] The choice survives a page reload

### A key, or not

- [ ] With no key and no local model: an AI tool says *"This needs an AI provider…"* and
      offers a **Settings** button — not a raw error
- [ ] Paste a DeepSeek key → **Save key** → **Test key** → *"Works — responded as …"*
- [ ] Toolbar popup's status line reflects reality: with a local model it should end up at
      *"On-device model ready — nothing leaves this machine."*

---

## Round 3 — highlights round-trip

The feature with the most that can go wrong, and it goes wrong silently.

- [ ] Select a sentence → panel → **Highlight this**
- [ ] Pick a colour. The text on the page is tinted, and the tint is translucent — the words
      underneath keep their own colour
- [ ] Type a note, click elsewhere in the panel
- [ ] **Reload the page.** The highlight comes back, same colour ← *the whole feature*
- [ ] Select the same text again → the row now reads **Highlighted**
- [ ] **Remove highlight** → the tint disappears

### Nothing was inserted into the page

- [ ] F12 → Elements → find the highlighted sentence
- [ ] There is **no `<mark>` or `<span>`** around it — the markup is exactly what the site
      shipped. (One `<style id="hh-highlight-styles">` in `<head>` is expected and is the
      only addition.)

### The library

- [ ] Options → **Highlights** shows it, grouped under a link to the page
- [ ] The link opens the right page
- [ ] **Export as Markdown** downloads a `.md` file; open it — blockquotes, notes, and a real
      link per page
- [ ] **Delete** on one entry removes it
- [ ] **Delete all** asks first, then clears

### Failing honestly

- [ ] Highlight a sentence, then in devtools edit that text so it no longer matches
- [ ] Reload. The highlight is **gone from the page but still in the library** — it must not
      reattach itself to a different paragraph
- [ ] Try a highlight on a single-page app (GitHub, a news site with infinite scroll).
      Navigate within the app and back; the `MutationObserver` should repaint it

---

## Round 4 — streaming and follow-ups

- [ ] Select several paragraphs → **Summarise**
- [ ] Text appears **progressively**, with a blinking caret at the end — not a spinner
      followed by the whole answer at once
- [ ] The finished answer replaces it cleanly (no leftover ``` fences, no duplicated text)
- [ ] The label says `· cached`, `· on-device`, both, or neither — and is accurate
- [ ] Run the same selection again → now labelled `· cached`, and instant
- [ ] Press **Back** while an answer is still streaming → it stops. Worker console shows no
      error from the disconnect
- [ ] **Key points** produces `• ` bullets — the same shape from either provider

### Follow-ups

- [ ] Under the summary, type *"why does that matter?"* → **Ask**
- [ ] Your question appears indented and dimmed; the reply streams under it
- [ ] Ask a second one — it should have the context of the first
- [ ] Arrow keys and Enter work **inside the input** without the panel hijacking them
- [ ] Turn off the network mid-answer → a readable error, and the failed turn does not
      poison the next question

---

## Round 5 — custom tools

- [ ] Options → **My tools** → name `Explain like I'm five`, prompt
      `Rewrite the text so a bright ten-year-old would understand it. Answer in {lang}.`
- [ ] **Add tool** → it appears in the list
- [ ] On a page, select a paragraph → the panel shows **Explain like I'm five**
- [ ] It runs, streams, and has a follow-up box
- [ ] **Right-click the selection** → the tool is at the top of the Highlight Helper submenu
      ← *this is the fingerprint rebuild working; if it is missing, the menu did not rebuild*
- [ ] Add a second tool → both collapse into a single **My tools** drill-in row
- [ ] Remove one → it disappears from the right-click menu too (may need a moment)

---

## Round 6 — the Phase 2 tools

### Dictionary

- [ ] Double-click a single ordinary word (`serendipity`) → **Define**
- [ ] Part of speech, numbered senses, examples where there are any
- [ ] **Say it** speaks the word
- [ ] **Synonyms** returns a list (English only — expected)
- [ ] A nonsense word (`asdfgh`) → *"No dictionary entry"* plus real Wiktionary links
- [ ] Worker console: no CORS or 429 errors

### Link to this text

This is the one thing that could not be verified from automation at all.

- [ ] Select a distinctive sentence → **Link to this text** → **Copy**
- [ ] Paste into a new tab and press Enter
- [ ] **The page scrolls to that sentence and highlights it** ← *the actual test*
- [ ] Select a word that appears many times (`the`) → the panel refuses and offers the plain
      page link instead — it must not produce a link that lands on the wrong one
- [ ] Select a sentence containing a hyphenated word → the link still works
      (the `-` escaping)

### Search, speech, text tools

- [ ] **Search with…** → each engine opens the right site with the selection as the query
- [ ] Options → **Search with…** → tick an off-by-default engine; it appears in the panel
- [ ] Add a custom one: `https://www.bing.com/search?q={q}` → works
- [ ] A URL without `{q}` is rejected with an explanation
- [ ] **Read aloud** on a paragraph speaks it; **Stop** stops it
- [ ] Select several lines → **Text tools** → *Sort lines*, *Remove duplicate lines*,
      *Lines to comma list* all behave
- [ ] Select text containing emails and URLs → *Email addresses* and *Links* rows appear,
      with no trailing punctuation
- [ ] **SHA-256** produces a 64-character hex string
- [ ] Select `caf&eacute; &mdash; test` → **Decode HTML entities** → `café — test`

### Keyboard shortcut

- [ ] Select text with the keyboard (Shift+arrows), press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>
- [ ] The panel opens on that selection
- [ ] `edge://extensions/shortcuts` lists it and rebinding works

---

## Round 7 — nothing was broken

The tools that worked before all this. Quick pass.

- [ ] `$50` → converted amount in the row, without clicking
- [ ] `65 mph` → km/h
- [ ] `#3f8ae0` → swatch, and **no** *Search with…*, *Link to this text* or *Highlight* rows
      ← *the catch-all gate; extra rows here are the bug that keeps recurring*
- [ ] `1700000000` → your local time
- [ ] `12 * 8 + 3` → `99`
- [ ] A JWT → decoded claims
- [ ] `https://example.com` → a QR code, and scan it with a phone
- [ ] **Explain this** on `SLA` → one sentence, then **Find a source** → a real Wikipedia
      article with *Did you mean* alternatives
- [ ] Right-click → every submenu opens the panel at the right place, and **Back** walks out
      through the levels

---

## Round 8 — history and privacy

- [ ] Options → **Recent answers** lists what you ran during these rounds, newest first
- [ ] Re-run one tool on the same selection → it moves to the top rather than appearing twice
- [ ] **Clear history** empties it and reports a count
- [ ] Untick **Keep a history** → run a tool → nothing new is recorded
- [ ] Set **Answer with** to *On-device only*, then select a very long passage and summarise
      → it **refuses with an explanation** rather than quietly sending it to DeepSeek
      ← *the setting is a promise about where text goes; this is the test of it*

---

## Known non-failures

Do not chase these — they are documented behaviour:

- A highlight cannot be clicked or hovered. It is a painted Range, not an element
- Text fragments do not scroll in Firefox; the link still opens the page
- `getVoices()` is empty on its first call, so the very first *Read aloud* may use the
  default voice rather than one matched to the language
- On-device answers are blunter than DeepSeek's — it is a much smaller model
- Highlights are per-browser and per-machine; there is no sync by design
- Named CSS colours, bare `$` as USD, and prose dates are all deliberately not matched
