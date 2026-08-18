# Android

A plan for putting Highlight Helper on a phone. Written in the same spirit as the
[Roadmap](ROADMAP.md): nothing here is committed to, it is ordered cheapest-first, and the
things that were considered and rejected are recorded so they don't get re-proposed.

---

## Building it

The app lives in `android/`. Open **that folder** in Android Studio, not the repo root.

```bash
cd android && ./gradlew :app:assembleDebug
```

Output lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

Versions are pinned to what the toolchain actually provides rather than to round
numbers — AGP 9.3.1, Gradle 9.7, Kotlin 2.4.10, `compileSdk 37`. Two consequences worth
knowing before changing them:

- **AGP 9 has Kotlin support built in** and rejects the standalone
  `org.jetbrains.kotlin.android` plugin outright. Only the Compose and serialization
  compiler plugins are applied.
- **`compileSdk` tracks the installed platform.** There is no `sdkmanager` in this
  install, so an older platform cannot be fetched from the command line.

`syncEngine` copies the extension's own JS into `app/src/main/assets/engine/src` before
every build. That directory is generated and gitignored — never edit it, and never commit
it. `src/` at the repo root is the only copy of the detectors.

Open `android/` in Android Studio, not the repo root — there is no `settings.gradle.kts` at
the top level, so Studio finds no Gradle project there and the Run button stays greyed out.

To run it you need an emulator image or a physical device. Android Studio's Device Manager
will fetch a system image, or a connected phone works with `./gradlew :app:installDebug`.

### Tests

```bash
npm test                              # detectors, then the bridge, in Node
cd android && ./gradlew test          # the response cache, on the JVM
```

The bridge smoke test runs the real detectors against a stubbed `AndroidHost`, which is what
lets the risky half of this port be checked without a device: rows crossing as JSON, prompts
being built in JS, settings reaching detectors, submenu keys surviving. The Gradle test
covers the cache, whose failures are all silent ones — a stale answer looks exactly like a
fresh one.

Neither replaces running it. What no test here touches: the WebView actually loading, the
selection toolbar entry appearing, replacement landing in another app's text field.

---

## "Port to Android" means three different products

The phrase hides a decision, so it goes first.

| Reading | What it is | Reach | Keeps |
| --- | --- | --- | --- |
| **A. The extension, on a mobile browser** | Ship the existing code to Firefox for Android | Only Firefox users | Everything — icon, highlights, replace, link-to-highlight |
| **B. An Android app** | Hooks the OS text-selection toolbar, works in every app on the phone | Every app, every user | The tools; not the page |
| **C. A browser app** | Our own WebView browser with the panel built in | Only people who switch browsers | Everything, for nobody |

**C is rejected** for the same reason the roadmap rejects PDF support: it is a different
product. Nobody changes their browser to get a currency converter.

**A and B are both worth doing, and they are not competitors** — A is a port, B is a new
front end on the same engine. A is roughly a fortnight and validates every touch-interaction
question that B would otherwise discover late. Do A first.

---

## The fact that makes this cheap

The seam a port needs is already in the code, and it is exactly where it should be.

Every detector is two halves:

```js
matches(text, settings)   // pure: string in, plain object out. No DOM, ever.
items({ match, api })     // builds DOM nodes
```

That split is not aspirational. The test suite imports all 22 detector modules into **Node**,
with no DOM and no browser, and runs 322 assertions against the `matches()` half:

```bash
node test/detectors.test.js
```

```
322 passed, 0 failed
```

And the registry itself runs headless:

```
detect("It cost $50 and weighs 12 kg")
  -> ["currency", "unit", "translate", "qr", "search", "texttools"]
```

Every `document.*` call in the codebase is inside a function body, never at module scope —
which is why the import works at all. So the expensive, fiddly, hard-won part of this
extension — the currency symbol tables, the unit conversions, the number parser that handles
`€1.234,56`, the calculator, the QR encoder, the regex extractors, roughly 3,000 lines of it —
is already platform-independent, already tested, and needs no rewrite for either track.

What is *not* portable is small and identifiable: `main.js` (selection capture, positioning,
shadow DOM), `kit.js`/`icons.js`/`panel.css` (desktop DOM UI), `anchor.js`/`locate.js`/
`highlights.js` (page re-anchoring — meaningless without a page), and `local-ai.js` (Chrome's
built-in model, which does not exist off Chrome).

And the browser API surface is a rounding error. Eighteen distinct `chrome.*` calls, all of
them behind four modules:

| API | Uses | Behind |
| --- | --- | --- |
| `chrome.storage.local` | 34 | `settings.js`, `cache.js`, `history.js`, `highlights-store.js` |
| `chrome.runtime.sendMessage` / `connect` | 8 | `main.js`, one `send()` helper |
| `chrome.contextMenus.*` | 9 | `service-worker.js` only |
| `chrome.tabs` / `chrome.scripting` | 8 | `service-worker.js` only |

---

## Track A — Firefox for Android

The only mobile browser that runs extensions. Since December 2023 any add-on marked
Android-compatible on AMO installs on Firefox for Android, and Mozilla supports **both MV2 and
MV3** with no plan to deprecate MV2 — so the existing `manifest.json` is close to shippable as
written.

### What has to change

**1. Touch instead of mouse.** This is the real work. `main.js` listens on `mousedown` /
`mouseup` and gates evaluation on a `pointerDown` flag ([main.js:912](src/content/main.js:912)).
On Android those fire late, synthetically, or not at all, and the selection handles the OS
draws are themselves a touch target competing with ours. Switch to `pointerdown`/`pointerup`
(which covers both), and re-tune `scheduleEvaluate`'s 220 ms debounce — a drag-to-select with
handles fires `selectionchange` continuously and the icon must not flicker under the user's
thumb.

**2. The icon must not sit under the selection handles.** The current placement is
`anchor.bottom + GAP` aligned to the selection's right edge ([main.js:247](src/content/main.js:247)),
which on Android is precisely where the OS puts its own drag handle. Needs a mobile branch:
place it clear of the handles, and make it thumb-sized — the desktop icon is far below the
48 dp minimum.

**3. The panel is 316 px wide on a 360 px viewport.** It fits, barely, with no margin for the
edge clamp. Mobile wants the panel pinned to the bottom of the viewport at full width — which
is also the shape Track B needs, so the CSS work is shared. A media query in `panel.css`, not
a second stylesheet.

**4. There is no on-device model.** `local-ai.js` probes for `LanguageModel` / `Summarizer` and
returns null when absent, so it degrades correctly with no code change — but on Android the
four AI tools are dead until a DeepSeek key is pasted, and the settings page should say so
rather than letting the user discover it. `isSupported()` already gives the hook.

**5. Verify, don't assume, these three.** They are the ones that can quietly sink the track:

- **`chrome.contextMenus` on Firefox for Android.** Android's long-press menu is not the
  desktop context menu. If selection entries don't appear, the right-click path — the fallback
  for every page where the icon fails — is gone, and the keyboard shortcut is gone too. The
  panel is then reachable only via the icon, which raises the stakes on (1) and (2)
  considerably.
- **`chrome.storage.sync` when not signed in.** Already handled — `getSettings()` catches and
  falls back to defaults ([settings.js:91](src/common/settings.js:91)) — but confirm it fails
  fast rather than hanging, because it is on the boot path.
- **Text fragments.** The README records them as Chromium/Safari only; Firefox has shipped
  some support since, so *Copy link to highlight* may work better than documented. Worth a
  recheck rather than a guess.

**Highlights should just work.** They need the CSS Custom Highlight API, which Firefox has
from 140 — same Gecko on Android. This is the feature most at risk in Track B and it survives
Track A intact, which is a good reason to do Track A.

### Shipping

AMO listing, `browser_specific_settings.gecko.id` in the manifest, and the Android-compatible
flag. Debug over USB with `about:debugging` from desktop Firefox. Mozilla reviews add-ons; the
`<all_urls>` content script and the DeepSeek host permission will draw a look, and the answer
is the same one the README already gives.

> Note on testing: Edge is the desktop test browser here, and Edge for Android has no
> extension support. Track A testing is Firefox-only, on a real device — the desktop
> responsive-mode emulator does not reproduce the selection-handle problem, which is the whole
> difficulty.

---

## Track B — The Android app

### The entry point is the OS text-selection toolbar

`ACTION_PROCESS_TEXT` lets any app add an entry to Android's floating selection toolbar. Select
text in Chrome, Gmail, a PDF reader, Slack, a game's chat box — anywhere — and "Highlight
Helper" is in the menu. This is a *better* trigger surface than the extension has: it is not
limited to web pages.

```xml
<activity android:name=".ProcessTextActivity"
          android:label="@string/process_text_label"
          android:theme="@style/Theme.Transparent"
          android:exported="true">
  <intent-filter>
    <action android:name="android.intent.action.PROCESS_TEXT" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:mimeType="text/plain" />
  </intent-filter>
</activity>
```

Three consequences worth stating plainly:

- **The label is the entire menu.** The toolbar shows one short verb-like entry, and the rest
  goes under an overflow the user may never open. So there is exactly one entry, and all 22
  tools live inside the sheet. The extension's twenty-entry right-click menu does not port —
  it becomes the sheet's root menu, which is what it already is.
- **Replace works, and works better than on desktop.** When the intent carries
  `EXTRA_PROCESS_TEXT_READONLY` as false, the activity returns replacement text and the host
  app writes it back. On desktop, `replaceSelection()` only works in inputs, textareas and
  contenteditable ([main.js:375](src/content/main.js:375)); on Android it works in any app's
  editor. Rewrite, translate, and the text transforms all get sharper.
- **There is no floating icon.** The user taps a menu entry rather than a bubble that appeared
  on its own. See *Deliberately left out*.

Second entry point: a **share-sheet target** (`ACTION_SEND`, `text/plain`) for the apps whose
selection toolbar is non-standard, and for sharing a whole article. Third: the **launcher
icon**, which opens the library, history and settings — the options page, rebuilt.

### The central decision: how the JS is reused

This is the one that determines whether the project stays maintainable, so it gets the most
space.

**Rejected: rewrite the detectors in Kotlin.** Roughly 3,000 lines of dense parsing, and the
322-test suite stops being the source of truth the moment there are two implementations. Two
currency parsers disagreeing about `£1.2bn` is a bug you find in a review a year later.

**Chosen: run the existing JS unmodified, in a headless WebView, and render natively.**

WebView rather than `androidx.javascriptengine` (JavaScriptSandbox), for one decisive reason:
the sandbox evaluates a *script string* and cannot resolve `import`. Using it means bundling,
which means a build step — and this codebase's most valuable structural property is that it
has none (`package.json` says so explicitly). A WebView loading an `index.html` from assets via
`WebViewAssetLoader`, with `<script type="module">`, imports the detector tree exactly as
Chrome does. Zero build, and `chrome://inspect` debugs it.

```
┌─ Kotlin ─────────────────────────────┐        ┌─ WebView (headless) ──────────┐
│  ProcessTextActivity                 │        │  bridge.js                    │
│  Compose bottom sheet                │◄──────►│    detectors/index.js         │
│  OkHttp (DeepSeek, rates, wiki)      │  JSON  │    common/* (unmodified)      │
│  DataStore + EncryptedSharedPrefs    │        │    matches() + rows()         │
│  TextToSpeech, ML Kit GenAI          │        │                               │
└──────────────────────────────────────┘        └───────────────────────────────┘
```

**Network stays in Kotlin.** Not for CORS reasons alone (though a WebView has no
`host_permissions` escape hatch and DeepSeek is unlikely to send permissive CORS headers) but
because the API key should live in Android Keystore-backed `EncryptedSharedPreferences` and
never enter the JS heap. `deepseek.js`, `rates.js`, `wikipedia.js` and `dictionary.js` are the
four modules that get reimplemented — and they are thin: prompt assembly and response shaping
already live in `common/prompts.js` and are reusable as-is, so what moves to Kotlin is the
`fetch` call and the error mapping, not the thinking.

**Storage is a shim.** `chrome.storage.local` behind DataStore, `chrome.storage.sync` behind
the same (there is no sync target on Android, and the roadmap already rejected a server). The
four modules that touch storage are the only ones that change.

### The part that is actually hard: `items()`

`matches()` is pure and ports free. `items()` returns DOM, and `open()` returns a live element
with closures inside it. That does not cross a bridge.

Two ways out.

**Option 1 — extract a `rows()` layer. Recommended.** Refactor each detector so the item
description is *data* and the DOM building moves into `kit.js`:

```js
// today
items: ({ match, api }) => [{ key, icon, label, value, open: (api) => el('div', …) }]

// after
rows:  ({ match }) => [{ key, icon, label, value: {kind:'rates', …}, detail: 'currency' }]
```

Both platforms then consume the same rows. The desktop `kit.menu()` becomes a pure function of
row data — which is a genuine improvement to the extension independently of Android — and the
test suite extends to cover row descriptions, not just matches.

Cost: touching all 22 detector files once. Each is small; the largest is `unit.js` at 448
lines and most of that is tables. Call it a fortnight, and it is the last time the two
platforms can diverge.

**Option 2 — an Android-only bridge that rebuilds presentation from `matches()` output.**
Cheaper this month, and guarantees drift: every new detector then needs writing twice, and
nothing fails when someone forgets.

Take Option 1.

**The detail views need a small block vocabulary.** Because the JS stays in-process, closures
don't need serialising — the bridge can hold them by id and expose `openRow(id)` returning a
description. About eight block types cover every detail view in the codebase today:

`headline` · `facts` · `note` · `text` · `markdown` · `buttons` · `swatches` · `stream`

The last one carries the AI path: `api.ai()`'s streaming contract
([main.js:310](src/content/main.js:310)) becomes a Kotlin Flow of tokens rendering into a
Compose text block, with the same cancel-on-dismiss semantics the port already relies on.

### AI providers on Android

The desktop ladder is on-device Gemini Nano → DeepSeek. The Android ladder is the same shape
with a different first rung, and `api.ai()` is still the single choke point
([main.js:472](src/content/main.js:472)) — the choice lives in one place.

| Rung | On Android | Covers | Caveat |
| --- | --- | --- | --- |
| On-device | **ML Kit GenAI** (Gemini Nano via AICore) | Summarize, rewrite, proofread, prompt | Pixel 8+, Galaxy S24+, some MediaTek/Snapdragon flagships. Not most phones |
| On-device, wider | MediaPipe LLM Inference + a Gemma model | Everything | 1–3 GB download. A big ask for a utility app |
| Cloud | **DeepSeek**, unchanged | Everything | Needs the user's key, as today |

The honest consequence: the desktop promise — *pin it to local and your text never leaves the
machine* — holds on Android only on supported devices and only for the actions ML Kit covers.
`PROVIDER.LOCAL` must say which, rather than silently covering less. `runLocal()` already
returns null for "can't serve this one" versus throwing for real failures
([local-ai.js:36](src/content/local-ai.js:36)); that contract is exactly right here and should
be kept verbatim.

### Everything else, tool by tool

| Feature | Android | Note |
| --- | --- | --- |
This was written as a forecast. The **State** column is what happened.

| Feature | Forecast | State |
| --- | --- | --- |
| currency, unit, calc, numberbase, color, datetime, coords, decode, regex, texttools, code | Free | ✅ as predicted, pure JS unchanged |
| qr | Free | ✅ — but as the module grid drawn on a Compose Canvas, not a Bitmap of an SVG |
| search / link — "Open in…" | Free | ✅ Custom Tabs |
| dictionary, jargon, translate, summarize, rewrite, custom | Free logic | ✅ — and cheaper than forecast: `wikipedia.js` and `dictionary.js` run *unmodified* behind a `fetch` shim, so only DeepSeek needed Kotlin |
| speak | Better | ✅ `TextToSpeech`, and the `getVoices()` quirk is indeed gone |
| replace | Better | ✅ works in any app's field |
| **highlight** | Degraded | ✅ correctly predicted — the one thing that cannot port |
| copy link to highlight | Gone | ✅ gone |
| restore highlights on page load | Gone | ✅ gone |
| per-site enable/disable | Reshaped | ⬜ not built; the calling package is available but unused |

Two things the forecast missed, both discovered by running it:

- **Wikimedia refuses generic user agents.** A browser sends its own, so the extension
  never met this; OkHttp introduces itself as `okhttp/5.5.0` and gets a 403 on every
  lookup. `Api-User-Agent` exists because browsers cannot set the real header and is no
  substitute for it away from one.
- **`View.post` does not run on a view that was never attached to a window.** The engine's
  WebView is headless by design, so every reply to a request it made sat in a queue that
  is only drained by `dispatchAttachedToWindow()`. Detection worked; everything it asked
  for in return timed out.

**Highlights are the real loss.** `anchor.js` and `locate.js` re-find a passage in a live
document; a `PROCESS_TEXT` intent gives a string, no URL, and no DOM. Painting is impossible
and re-anchoring is meaningless.

What survives is worth having: a **clippings library**. Save the quote with whatever provenance
the intent carries — the calling package name, plus a URL when the text arrived via the share
sheet from a browser. Colour tags, notes, search, and the Markdown export from
`highlights-store.js` all port unchanged. It is Glasp-shaped rather than Liner-shaped: you keep
what you kept, you just can't see it painted on the page next visit. Say that in the store
listing rather than letting people discover it.

### Cold-start latency

`PROCESS_TEXT` launches an activity, and a cold WebView is 200–400 ms before the first
`detect()` returns. A sheet that hangs blank for a third of a second feels broken.

Don't fix it by making detection faster — fix it the way the panel already does. Show the
sheet immediately with the selection snippet in the header (which needs no detection at all),
and fill rows as they arrive. The extension's rows already accept a Promise for `value`
([detectors/index.js:30](src/content/detectors/index.js:30)) and pulse until it resolves; the
same pattern covers the whole row list rather than one cell. Warm the WebView from
`Application` where the OS allows it, and treat that as an optimisation, not the plan.

---

## Deliberately left out

- **A floating bubble over other apps.** The closest analogue to the selection icon, and it
  needs either `SYSTEM_ALERT_WINDOW` or an accessibility service. Both are Play Store policy
  fights, both read as spyware to a reasonable user, and an accessibility service that watches
  every app's text is exactly the thing this project's privacy posture exists to avoid. The OS
  selection toolbar is the sanctioned surface. Use it.
- **A custom keyboard (IME).** The other way to get at text everywhere. Same objection,
  louder: an IME sees every keystroke including passwords.
- **Clipboard monitoring.** Android 10+ blocks background clipboard reads, and it was never
  acceptable anyway.
- **Our own browser.** Reading C above.
- **iOS.** Worth naming so it isn't assumed: iOS has a genuinely good analogue — a Share
  Extension, plus `NSExtensionActionActivationRule` — and Safari Web Extensions can carry the
  in-page half. But it is a second native codebase, a Mac, and $99/year. Not now; the `rows()`
  refactor is what would make it cheap later, which is another argument for Option 1.
- **Cloud sync between the extension and the app.** The roadmap already rejected a server, and
  nothing about a phone changes that reasoning. Markdown export is the bridge.

---

## Phasing

Each phase leaves something shippable, same rule as the roadmap.

| Phase | What | State |
| --- | --- | --- |
| **A1** | Touch input, mobile panel layout, Firefox manifest, verify the three risks | not started |
| **A2** | AMO listing, on-device probe messaging, real-device pass of `test/MANUAL.md` | not started |
| **B0** | The `rows()` refactor, in the extension, shipped on desktop first | ✅ built |
| **B1** | Android skeleton: `PROCESS_TEXT` activity, headless WebView bridge, Compose sheet, the free detectors | ✅ built |
| **B2** | Kotlin network layer, DeepSeek, streaming, cache, settings | ✅ built |
| **B3** | TextToSpeech, Custom Tabs, share target | ✅ built — ML Kit GenAI not started |
| **B4** | Clippings library, history, custom tools, Markdown export | not started |
| **B5** | Play Store: listing, privacy declaration, data-safety form | not started |

### What is actually running

Every detector works on the phone except highlighting, which cannot. Conversions,
calculator, colours, dates, coordinates, number bases, decoding, regex, text tools, QR,
search and links run locally; currency, dictionary and the encyclopedia lookups go out
through OkHttp; explain, translate, summarise, rewrite, the code tools and custom tools
go to DeepSeek with the answer streaming in as it is written. Follow-up questions,
"Find a source" with its disambiguation picker, the language switcher and read-aloud all
work natively.

What is missing, in the order it will be noticed:

- **Custom tools cannot be created on the phone.** The detector runs them, and the
  settings screen has nowhere to write one — that needs a prompt editor, which is a
  screen rather than a row.
- **Highlighting is absent and always will be** in this shape. It paints a range into
  the document it came from, and an intent carries a string with no document. The
  clippings library in B4 is the honest substitute.
- **No on-device model.** Every AI call goes to DeepSeek, so the desktop promise that a
  selection can stay on the machine has no equivalent here yet. ML Kit GenAI is the
  route; see the provider table above.
- **No history or library**, so nothing is kept after the sheet closes.

**B0 before B1 is the load-bearing ordering.** It is tempting to skip it and let the Android
app read `matches()` directly — that is Option 2 by the back door, and the drift starts on day
one.

---

## Open questions — two answered, one still open

1. **Does `chrome.contextMenus` produce selection entries on Firefox for Android?**
   *Still open.* Track A was never started, so this remains the thing to check first if
   it ever is.

2. **What does `PROCESS_TEXT` actually deliver from Chrome for Android?**
   *Answered by building it.* `EXTRA_PROCESS_TEXT_READONLY` is honoured, and Replace
   genuinely lands in another app's field — it is a headline feature, not a footnote.
   Nothing in the intent identifies the page, which settles the other half: a clippings
   library would have the calling package and no URL unless the text arrived by share.

3. **Does a headless WebView survive long enough to be worth warming?**
   *Answered, and it stopped mattering.* The sheet was written skeleton-first anyway —
   header immediately, rows as they arrive — and at that point warming is invisible.
   Keeping the engine on the `Application` is a cheap win for the second selection and
   nothing depends on it.

A fourth that nobody thought to ask, and cost the most:

4. **Does the reply to a request the engine makes ever arrive?** Not through
   `View.post` on a view that is never attached to a window. The lesson generalises past
   Android: a headless component is one that has quietly opted out of every lifecycle the
   framework assumes, and the parts that depend on those fail by hanging rather than by
   throwing.

---

## Sources

- [Open extensions on Firefox for Android — Mozilla Add-ons Blog](https://blog.mozilla.org/addons/2023/11/28/open-extensions-on-firefox-for-android-debut-december-14-but-you-can-get-a-sneak-peek-today/)
- [Distribute Manifest V2 and V3 extensions — Firefox Extension Workshop](https://extensionworkshop.com/documentation/publish/distribute-manifest-versions/)
- [Custom text selection actions with ACTION_PROCESS_TEXT — Android Developers](https://medium.com/androiddevelopers/custom-text-selection-actions-with-action-process-text-191f792d2999)
- [Overview of the ML Kit GenAI APIs — Google for Developers](https://developers.google.com/ml-kit/genai)
- [Gemini Nano — Android Developers](https://developer.android.com/ai/gemini-nano)
