# Roadmap

Where Highlight Helper could go next, and why. Written after surveying the tools that
already occupy this space — see [What was surveyed](#what-was-surveyed) at the bottom.

This absorbs the **Ideas not built** table in the README: *Hash* and *HTML entity decode*
land in Phase 2, *Extract to table* and *Convert code to another language* sit in Phase 5,
and time zones, Roman numerals and IBAN formatting stay out for the reasons already given
there.

Nothing here is committed to. It is ordered so that the cheap, high-value work comes first
and each phase leaves the extension in a shippable state.

---

## Where this sits against the field

Highlight Helper already wins on the thing nobody else attempts: **local, pattern-driven
detection**. Sider, Monica and MaxAI have one hammer — send the selection to a model. PopClip
has 250 actions and no idea which of them apply. Nothing else looks at `#3f8ae0` and knows
what it is, and nothing else answers before you click.

Four gaps, in order of size:

| Gap | Who does it | Why it matters |
| --- | --- | --- |
| **It doesn't highlight anything** | Liner, Weava, Hypothesis, Glasp | The extension is named for a thing it doesn't do |
| **Dead without an API key** | Chrome's built-in Gemini Nano | Twelve of sixteen tools work; the four people install it for don't |
| **No "send this somewhere else"** | PopClip's largest category by a wide margin; the whole of Swift Selection Search | Zero cost, zero risk, completely absent |
| **Every AI result is a dead end** | Sider, Monica, MaxAI | You read the answer and the conversation stops |

---

## The two structural facts that shape everything below

**Copy-link-to-highlight and persistent highlights are the same engine.** Generating a
`#:~:text=` fragment and re-anchoring a saved highlight on a later visit are both "find this
text in the page, unambiguously, using the words around it." Written once as
`src/content/anchor.js`, both features fall out of it — and the second one, which is the
expensive feature, becomes much cheaper for having waited.

**`api.ai()` is a single choke point.** It lives at `makeApi()` in `src/content/main.js` and
every detector goes through it. Adding a second AI provider is a change at one call site plus
a new module, not a refactor.

---

## Phase 1 — Built-in AI as a second provider ✅ built

*Shipped. What follows is the plan as written; the notes marked **as built** record where
reality differed. See [Where AI runs](README.md#where-ai-runs).*


The largest strategic change available: it moves the install story from *"first, get a
DeepSeek key"* to *"it works"*.

Chrome ships on-device models behind standard APIs. `Summarizer`, `Translator` and
`LanguageDetector` are stable from Chrome 138. `LanguageModel` — the Prompt API — is stable
**for extensions specifically**, which is exactly what this is. No key, no cost, no network,
and nothing leaves the machine.

**Why it runs in the content script, not the worker.** The only reason network calls live in
the service worker is that the worker owns the API key. Built-in AI has no secret to protect,
so that constraint doesn't apply — and it couldn't run there regardless, because the Prompt
API is unavailable in worker contexts. The alternative is an offscreen document, which buys a
single control point at the cost of a new permission and a lifecycle to manage. Not worth it
for a provider with nothing to hide.

```
src/common/prompts.js        NEW  buildPrompt() moved out of deepseek.js, so both
                                  providers answer from one set of prompts
src/content/local-ai.js      NEW  availability probe, session cache, per-action routing:
                                  SUMMARIZE / KEYPOINTS -> Summarizer
                                  TRANSLATE            -> Translator
                                  everything else      -> LanguageModel
src/content/main.js               api.ai() tries local, falls back to send(MSG.AI)
src/background/deepseek.js        imports buildPrompt from common/
src/common/settings.js            aiProvider: 'auto' | 'local' | 'cloud'
src/common/constants.js           ERR.MODEL_DOWNLOADING, ERR.NO_PROVIDER
src/options/options.js            provider section: what this machine supports,
                                  and the model download with its progress
```

Three things to get right:

- **The hardware gate is real.** Roughly 22 GB of free disk and more than 4 GB of VRAM (or
  16 GB of RAM and four cores). Plenty of machines won't qualify, so `'auto'` has to degrade
  to DeepSeek silently, and the options page has to *say* which provider is actually in play
  rather than leaving the user to guess.
- **The model download is a one-time, multi-gigabyte event.** It belongs on the options page
  with a progress bar, behind an explicit button. A panel row that appears to hang for ten
  minutes is the worst possible first experience.
- **Cache local answers the same way.** Content scripts can reach `chrome.storage`, so
  `background/cache.js` can be imported directly rather than round-tripping through the
  worker. On-device inference is free but not fast; the cache still earns its place.

**Free side effect.** `LanguageDetector` replaces the stopword heuristic in
`detectors/langdetect.js` outright, and it costs nothing even for users on the cloud provider.
The heuristic stays as the fallback when the API is unavailable.

---

## Phase 2 — The free wins ✅ built

*Shipped. Four new detectors (`dictionary`, `link`, `search`, `speak`), the text tools
roughly tripled, HTML entities in the decoder, and a keyboard shortcut.*

**What differed from the plan.** The context-rebuilding in `anchor.js` had to become a
character window rather than a word count — rejoining words with spaces loses the punctuation
between them, so uniqueness probes failed against text that was really there. And all four
new catch-all detectors needed the same `looksLikeLanguage()` gate the text tools already
had; without it they each offered to search for, link to and read aloud a hex colour that
another detector had already answered. The existing test block for exactly that caught it.

**Not verifiable here.** Chrome only activates a text fragment on a user-initiated
navigation, so an automated click-through can't confirm one works end to end — a known-good
fragment taken straight from the DOM behaves identically to a generated one under
automation. The syntax is verified (the browser parses and strips the directive) and the
generator is unit-tested; the last step is a human clicking a generated link.

Everything here is local or keyless, and none of it needs Phase 1.

### Search with… / Open in…

The biggest category in PopClip and the entire premise of Swift Selection Search, and the one
thing this extension has no version of. Pure `window.open`, no permissions, no cost.

A default list — Google, DuckDuckGo, Wikipedia, YouTube, Maps, MDN, GitHub, Stack Overflow,
Google Scholar, Wayback Machine, DOI — that is **editable in options**, because the long tail
is personal and shipping fifty entries nobody asked for is how a menu becomes useless.

Opening a search sends the selection to a third party. That is the same trade the coordinate
detector's map buttons already make, and it gets the same treatment: an explicit button,
never anything automatic.

### Dictionary & thesaurus

Today, selecting a single English word offers *Explain this*, which costs an API call. A
dictionary is the obvious free answer and is the whole of Google Dictionary's four-million-user
proposition.

Wiktionary's REST definition endpoint is free, multilingual, keyless, and runs on the same
Wikimedia infrastructure `background/wikipedia.js` already talks to — including the
`Api-User-Agent` header requirement that module already handles. Synonyms from Datamuse, also
free and keyless, as a second row rather than a second lookup.

**Pronunciation comes from `speechSynthesis`, not from a second API.** It needs no network at
all, and it means the read-aloud work below covers two features.

### Copy link to highlight

The `#:~:text=` text fragment. PopClip ships it; Chrome buries it in a right-click menu.

Built on `anchor.js`: try the exact selection first, test whether it appears exactly once in
the page's text, and add prefix/suffix context words until it does. For long selections use
the `start,end` form rather than a fragment the length of a paragraph. The polyfill Google
publishes does this properly, but pulling it in means a build step — so a simplified generator
it is, with the honest limitation that it gives up rather than emitting an ambiguous link.

### Read aloud

`speechSynthesis`, zero network, and an accessibility feature the whole category ignores.
PopClip has had it as *Say* since the beginning.

### Keyboard shortcut

`chrome.commands` with a default of <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>: open
the panel at the current selection without touching the mouse. Both PopClip and Swift
Selection Search treat a non-mouse trigger as basic, and this extension's own README already
notes that keyboard selection is one of the cases where the icon never appears.

### Text tools, extended

Straight from PopClip's *Text Lists* and *For Developers* categories, all local, all fitting
detectors that already exist:

- **Lines** — sort, reverse, shuffle, deduplicate, join, split on commas
- **Extract** — every email, URL or number in the selection (regex, no model needed; the
  cheap honest half of *Extract to table*)
- **Hash** — SHA-256 via SubtleCrypto
- **ROT13**, **HTML entities** — the latter belongs in `decode.js` as another branch

### Files

```
src/content/anchor.js                NEW  find-this-text-uniquely; shared with Phase 3
src/content/detectors/search.js      NEW  "Search with…", list from settings
src/content/detectors/dictionary.js  NEW  Wiktionary + Datamuse
src/content/detectors/speak.js       NEW  or a row on texttools
src/content/detectors/texttools.js        + line operations, extract, hash, ROT13
src/content/detectors/decode.js           + HTML entities
src/common/searchengines.js          NEW  the default list
manifest.json                             + *.wiktionary.org, api.datamuse.com
                                          + "commands"
```

Each new detector is the six-step checklist in the README's *Adding a detector*: file →
`LIST` → `DEFAULTS.detectors` → `CONTEXT_TOOLS` and `TOOL_HINTS` → `DETECTOR_BLURB` → tests.
The menu-id test catches anything skipped, which is the point of it.

---

## Phase 3 — Highlights ✅ built

*Shipped. Painted with the CSS Custom Highlight API, re-found with `content/locate.js`,
stored per origin, with a library and Markdown export on the options page.*

**What differed from the plan.** `anchor.js` turned out to cover only half the problem —
it answers "is this string unique" over text, which is all a link needs, but repainting
needs a real `Range` in a live DOM. `content/locate.js` is that second half, and the two
stay apart so `anchor.js` remains testable in Node.

The same punctuation bug from Phase 2 reappeared in a new place and had to be found twice:
the joiner between a highlight and its stored context was `\s+`, which cannot cross the full
stop in "…on the mat." / "Later the dog…" — the single most ordinary case there is. It is a
bounded whitespace-or-punctuation run now. A browser test caught it; the Node suite could
not have.

**`test/locate-browser.html` is new**, plus `tools/static-server.js` to serve it. Sixteen
assertions over things Node cannot reach — text spanning inline elements, ambiguity being
refused, a highlight surviving a paragraph appearing above it, and painting inserting no
elements. Same role `qr-roundtrip.js` plays for the encoder.

**What the first real browser pass found.** Highlights saved correctly and never painted.
The cause was the newline separator between text nodes: it exists to stop "Cat" + "astrophe"
matching "Catastrophe", and it also stops "codes" + "[1]" matching the "codes[1]" a page
renders — so a single footnote marker inside a selected sentence broke the lookup, on most of
the pages anyone would want to highlight. Matching now removes whitespace from both sides
instead, which fixes that and the opposite case together. Verified against the real Wikipedia
article that reproduced it.

The fixture that passed twenty assertions was too clean to catch this. It now contains a
sentence with a `<sup>` in the middle of it.

The feature the extension is named after. Save a selection, restore it on the next visit,
attach a note and a colour, browse the lot, export to Markdown.

**Rendering uses the CSS Custom Highlight API**, not `<mark>` tags wrapped around the page's
text. `CSS.highlights` plus `::highlight()` paints ranges without mutating the DOM at all —
no reflow, no broken layouts, no fights with a site's own scripts over nodes that appeared
from nowhere. It is the same non-invasive posture the shadow-root panel already takes, and it
is why this feature is worth doing here rather than badly.

**Anchoring degrades honestly.** `anchor.js` from Phase 2 does the re-finding. When the page
has changed and the text is genuinely gone, the highlight stays in the library marked
*couldn't find this on the page any more* — it is never quietly reattached to whichever
paragraph scored best. That is the same instinct as refusing to let the model produce a
citation: a wrong answer delivered confidently is worse than no answer.

```
src/content/highlights.js    NEW  save, restore, paint, note editing
src/background/store.js      NEW  per-origin storage with quota eviction
src/action/popup.js               "Highlights on this page"
src/options/options.js            the full library, plus Markdown export
```

Storage is `chrome.storage.local` and stays there. Sync would mean a quota of 100 KB and a
race between machines; a server would mean an account, which kills the property that makes
this extension worth trusting.

---

## Phase 4 — Conversation ✅ built

*Shipped. Streaming over a port, follow-up questions under every AI result, user-written
tools, and a history of recent answers.*

**What differed from the plan.** Very little structurally — the ordering held. Two things
worth recording:

- Custom tools forced the context-menu fingerprint to become *computed* rather than a
  module constant, since adding a tool has to change the menu and nothing else would notice.
  `onSettingsChanged` now rebuilds it, and the existing fingerprint makes that a no-op when
  nothing changed.
- The custom-tool detector was written with a looser prose gate than the other catch-alls
  (0.4 rather than 0.45), which let `#3f8ae0` through by a single character. The
  catch-all test block caught it, for the third phase running.

**Prompt injection got a real answer.** `fillTemplate` fills `{title}`, `{url}` and `{lang}`
but deliberately not `{text}`: the selection stays in the user turn rather than being spliced
into the instructions, so a page cannot write the sentence telling the model what to do.

**Still unverified:** everything in this phase. Streaming has never run against a real SSE
response, no follow-up has been sent, and no custom tool has been executed.

Three changes that only make sense in order.

1. **Streaming.** DeepSeek supports SSE and the Prompt API has `promptStreaming()`, so both
   providers can do it. `chrome.runtime.sendMessage` cannot stream, so this means moving the
   AI path to `chrome.runtime.connect` and a port. Nothing else in the panel changes, but the
   perceived speed of every AI tool does.
2. **Follow-up questions.** A text box under any AI result. DeepSeek's endpoint already takes
   a messages array and a `LanguageModel` session already keeps context, so the work is
   holding a conversation in the view rather than throwing it away — plus a `MSG.CHAT` that
   carries messages instead of a single action. This is the single feature every AI sidebar
   competitor has and this extension doesn't.
3. **Custom prompts.** User-defined tools with `{text}`, `{title}`, `{url}` and `{lang}`
   placeholders, each appearing as a menu row and a context-menu entry. This is PopClip's
   actual model: don't ship 250 actions, ship the ability to write the 251st. It turns
   sixteen tools into however many the user wants, and it is the cheapest possible answer to
   every "could it also…" request.

**History** — what you looked up and what came back, re-openable from the popup — belongs
here too, since streaming and conversations both give it more to hold. Google Dictionary's
history and Liner's library are both quietly load-bearing features.

---

## Phase 5 — Bets

Not planned, but the reasonable next questions.

| Idea | Note |
| --- | --- |
| **Summarise this page** | Needs article extraction (Readability-style). The most-used feature in every AI sidebar, and the first thing that isn't selection-driven |
| **Summarise this video** | YouTube transcript. The single most-cited reason people install Sider or Monica |
| **Side panel** | `chrome.sidePanel`, for results the popup is genuinely too small for — a long summary in a 360px panel is a scroll, not a read |
| **Copy as Markdown with source link** | Plus `obsidian://` and `logseq://` buttons. See below for why this rather than integrations |
| **Extract to table** | Already in the README's ideas list; sits naturally beside the regex extract in Phase 2 |
| **Convert code to another language** | Also already listed; sits beside *Explain this code* |

---

## Deliberately left out

In the spirit of the README's *Known limitations* — the things that were considered and
rejected, with the reason, so they don't get re-proposed.

- **Individual note-app integrations.** PopClip carries about twenty-five of them: Obsidian,
  Notion, Roam, Bear, Craft, Logseq, DEVONthink, and so on. One *Copy as Markdown with source
  link*, plus URL-scheme buttons for the two or three apps that support them, is ninety
  percent of the value with no APIs and no per-app maintenance burden.
- **Fact-check / cross-check** (Wiseone's differentiator). It cannot be done honestly without
  a real search index. The README's *Find a source* section already sets out why a model
  cannot be asked to do this, and a fact-check built on the same foundation would be a
  confident-sounding verdict with nothing behind it.
- **Cloud sync of highlights** (Weava, Hypothesis, Liner). Needs a server and an account, and
  destroys the property that makes this extension worth installing: that it holds nothing of
  yours anywhere you can't see.
- **Public or shared annotations** (Hypothesis, Liner's social layer). Same reason, plus a
  moderation problem.
- **PDF support** — Weava's main selling point, and this extension's most-requested-looking
  limitation. Chrome's PDF viewer will not run content scripts, so it means bundling PDF.js
  and shipping a viewer. That is a different product.
- **Shopping and social searches** (Amazon, eBay, IMDb, Letterboxd, LinkedIn — PopClip has
  them all). Making the search list editable answers this properly. Shipping the long tail
  makes the menu worse for everyone who wanted three of them.

---

## Open questions — answered

Both were settled in a real Chrome console before Phase 1 was written, and a third turned up
that mattered more than either.

1. **The `availability()` enum.** `'downloadable'` observed on a clean machine; the docs page
   listing `'after-download'` is stale. The code treats anything other than a definite
   `'available'` as not-now, so the exact set of other values doesn't change behaviour.
2. **User activation.** Never became a problem, because the design moved the only `create()`
   that can trigger a download onto an explicit options-page button — which is a click, and
   so carries activation by construction.
3. **`Translator.availability()` requires arguments and can hang.** It needs
   `{ sourceLanguage, targetLanguage }`, and with a valid pair on a machine with no language
   pack it ran past eight seconds without settling. Every probe is now raced against a
   timeout and memoised. This was not on the list and would have shipped as "the panel
   sometimes freezes for ten seconds."

Also worth recording: **`Writer`, `Rewriter` and `Proofreader` do not exist** in a current
Chrome — confirmed absent, not merely undocumented. The rewrite tones go through
`LanguageModel` with the shared prompt.

---

## What was surveyed

- **[PopClip](https://www.popclip.app/extensions/)** — the Mac original, ~250 extensions.
  The definitive catalogue of what people want to do with selected text, and the source of
  most of Phase 2.
- **[Swift Selection Search](https://addons.mozilla.org/en-US/firefox/addon/swift-selection-search/)**
  — Firefox. Selection popup, but search-engines-only. Its options page is a good model for
  configuring *when* a popup appears.
- **Sider, Monica, MaxAI, Wiseone** — the AI sidebar category. Page-level summarisation,
  follow-up conversation, and streaming are what they have that this doesn't.
- **Liner, Weava, Hypothesis, Glasp** — the highlighter category. Phase 3 is their territory.
- **[Google Dictionary](https://chromewebstore.google.com/detail/google-dictionary-by-goog/mgijmajocgfcbeboacabfgobmjgjcoja)**
  — double-click a word, get a definition, pronunciation and history.
- **[Link to Text Fragment](https://github.com/GoogleChromeLabs/link-to-text-fragment)** —
  Google's own extension, now partly native in Chrome.
- **[Chrome built-in AI](https://developer.chrome.com/docs/ai/built-in-apis)** —
  [Summarizer](https://developer.chrome.com/docs/ai/summarizer-api) and
  [Prompt](https://developer.chrome.com/docs/ai/prompt-api) API documentation.
