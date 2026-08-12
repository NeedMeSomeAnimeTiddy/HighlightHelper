# Manual test checklist

The automated tests check the maths and the text handling. They cannot check anything that
needs a real browser: the internet, the AI model, saved data surviving a page reload, or any
button actually working. That is what this is for.

Do the rounds in order. Round 1 takes five minutes and will catch a broken build before you
spend an hour on the rest.

**Use Edge.** Opera and Opera GX block extensions on search pages at the browser level, which
looks like a bug but isn't one.

---

## Before you start: the two error logs

When something goes wrong, the explanation is in one of two places, and they are different
places. This trips people up constantly, so it is worth knowing up front.

**Log 1 — the page's log.** Covers anything you can see: the popup panel, the tools, the
highlighting.

1. Click on the web page you are testing
2. Press <kbd>F12</kbd>
3. Click the **Console** tab

**Log 2 — the extension's own log.** Covers anything invisible: internet requests, the AI, the
right-click menu.

1. Go to `edge://extensions`
2. Find **Highlight Helper**
3. Click the blue **service worker** link on its card
4. A separate window opens — click its **Console** tab

> **If a right-click menu item does nothing, the reason is always in Log 2.** It will never
> appear in Log 1.

When reporting a failure, say which round it was and paste whatever red text appears in
either log.

---

## Setup

1. Open Edge and go to `edge://extensions`
2. Turn on **Developer mode** — the switch is in the bottom-left corner
3. Click **Load unpacked**
4. Select the `HighlightHelper` folder (the one with `manifest.json` inside it)
5. Look at the extension's card

   ✅ **Should see:** the card, no red **Errors** button
   ❌ **If there is an Errors button:** click it and send me what it says. Nothing below will
   work until that is fixed.

6. Open a long article in a new tab — a Wikipedia article is ideal
7. **Press <kbd>F5</kbd> to refresh that tab**

   > Step 7 is not optional. Extensions do not load into tabs that were already open before
   > you installed them. If you skip it, nothing will happen when you select text and it will
   > look like the extension is broken.

### Any time I send you new code

1. Go to `edge://extensions`
2. Click the **↻ reload** icon on the Highlight Helper card
3. Go back to your test tab and press <kbd>F5</kbd>

Both steps, every time. Skipping either produces confusing half-broken behaviour.

---

## Round 1 — does it load at all?

*Five minutes. This page uses almost every new piece of code, so if something is fundamentally
broken it shows up here.*

1. Click the Highlight Helper icon in the toolbar (top-right of Edge; you may need to click
   the puzzle-piece icon to find it)
2. Click **Settings…**
3. A settings page opens in a new tab
4. Press <kbd>F12</kbd> on that page and look at the Console tab

   ✅ **Should see:** no red text
   ❌ **If there is red text:** stop and send it to me. Everything below depends on this.

5. Close the console and scroll down the settings page. Count the section headings.

   ✅ **Should see:** ten sections, in this order —
   Preferences, Where AI runs, DeepSeek API key, Tools, My tools, Recent answers, Highlights,
   Search with…, Cache, Sites

6. Look at the **Tools** section

   ✅ **Should see:** 22 items, each with a checkbox and a short description

7. In **Preferences**, change **My language** to something else
8. Press <kbd>F5</kbd> to reload the settings page

   ✅ **Should see:** your new language still selected
   ❌ **If it reset:** settings are not saving.

9. Change it back to English

---

## Round 2 — where the AI comes from

*The extension can use an AI model built into Chrome/Edge that runs on your own computer, or
DeepSeek over the internet. This round checks both.*

### 2a. Can this computer run the local model?

It needs roughly 22 GB of free disk space and a reasonably recent graphics card. **If your
machine can't, the correct result is a clear message saying so** — that is a pass, not a fail.

1. On the settings page, find **Where AI runs**
2. Look at the grey text next to *On-device model*

   ✅ **Should see** one of these, within about five seconds:
   - *Ready — answers stay on this machine.*
   - *Supported, but the model needs downloading first.*
   - *This machine can't run it — usually not enough disk space or GPU memory.*
   - *Not available in this browser. Needs Chrome 138 or newer.*

   ❌ **If it says "Checking…" forever:** that is a real bug — tell me.

3. **If a "Download the model" button appeared**, click it

   ✅ **Should see:** the text changes to *Downloading… 5%*, then 10%, and so on
   ❌ **If the percentage never moves after a few minutes:** tell me.

   > This download is several gigabytes. Leave it running and carry on with Round 3; come
   > back to it later.

4. When it finishes, reload the settings page

   ✅ **Should see:** *Ready — answers stay on this machine.*

### 2b. Switching where answers come from

1. In **Where AI runs**, use the **Answer with** dropdown
2. Pick each of the three options in turn

   ✅ **Should see:** the grey explanation text underneath changes each time

3. Leave it on the first option (*On-device when possible, DeepSeek otherwise*)
4. Reload the page

   ✅ **Should see:** your choice was remembered

### 2c. The DeepSeek key

*Skip this if you are only testing the local model — but then the "falls back to DeepSeek"
checks later will correctly fail.*

1. First, with **no** key saved, go to your article tab
2. Select a whole paragraph, click the small icon that appears, and click **Summarise**

   ✅ **Should see:** a friendly message — *"This needs an AI provider…"* — with an **Open
   settings** button
   ❌ **If you see a raw error code** like `NO_KEY`: tell me.

3. Now go to the settings page, find **DeepSeek API key**
4. Paste your key into the box
5. Click **Save key**
6. Click **Test key**

   ✅ **Should see:** *Works — responded as deepseek-chat*
   ❌ **Anything else:** send me exactly what it says.

7. Click the Highlight Helper toolbar icon

   ✅ **Should see:** a line at the bottom of the little popup saying either *On-device model
   ready — nothing leaves this machine* or *DeepSeek key saved. All tools available.*

---

## Round 3 — highlighting

*The biggest new feature, and the one most likely to fail quietly.*

### 3a. Making a highlight

1. Go to your article tab
2. Select a full sentence with your mouse
3. A small icon appears at the end of the selection — click it
4. In the menu, click **Highlight this**
5. Four coloured circles appear — click the yellow one

   ✅ **Should see:** the sentence on the page turns yellow. The words stay readable — it is
   a translucent tint, like a real highlighter, not a solid block.
   ❌ **If the text becomes unreadable or the page layout jumps:** tell me.

6. Click in the note box and type `test note`
7. Click anywhere else in the panel
8. Press <kbd>Esc</kbd> to close the panel

### 3b. Does it come back? *(this is the whole feature)*

1. Press <kbd>F5</kbd> to reload the page
2. Scroll to where your highlight was

   ✅ **Should see:** it is still yellow
   ❌ **If it is gone:** this is the most important failure to report. Check Log 1 (the page
   console) and send me anything red.

3. Select the exact same sentence again and click the icon

   ✅ **Should see:** the menu row now says **Highlighted** rather than *Highlight this*

4. Click it, then click **Remove highlight**

   ✅ **Should see:** the yellow disappears immediately

5. Highlight it again (you will need it for the next steps)

### 3c. Check the page wasn't modified

*The whole design depends on the extension not altering the web page. This proves it.*

1. Right-click directly on your highlighted sentence
2. Choose **Inspect**
3. A panel opens with the page's underlying code, with your sentence's line selected

   ✅ **Should see:** the sentence is plain text inside whatever tag the website used. There
   is **no** `<mark>` or extra `<span>` wrapped around it.
   ❌ **If you see `<mark>` or a new `<span>` around your text:** tell me — that means it is
   modifying pages, which it must not do.

   > Seeing one `<style id="hh-highlight-styles">` near the top of the page is expected and
   > correct. That is the only thing it adds.

### 3d. The saved list

1. Go to the settings page and find **Highlights**

   ✅ **Should see:** your sentence, under a clickable heading with the article's title, with
   your note underneath and a coloured dot on the left

2. Click the article title heading

   ✅ **Should see:** it opens the right page

3. Click **Export as Markdown**

   ✅ **Should see:** a file downloads, named something like `highlights-2026-08-12.md`

4. Open that file in Notepad

   ✅ **Should see:** the article title as a link, your sentence with a `>` in front of it,
   and your note

5. Back on the settings page, click **Delete** next to one entry

   ✅ **Should see:** it disappears from the list

6. Click **Delete all**

   ✅ **Should see:** a confirmation box asking first
   ❌ **If it deletes without asking:** tell me.

7. Click Cancel — keep your highlights for now

### 3e. When the text has genuinely gone

*It must admit it lost track, not guess.*

1. Go to the article, right-click your highlighted sentence, choose **Inspect**
2. In the code panel, double-click the sentence text and type something completely different
3. Press <kbd>Enter</kbd>, then press <kbd>F5</kbd> to reload

   ✅ **Should see:** nothing is highlighted on the page any more, **but** the highlight is
   still listed on the settings page
   ❌ **If a different sentence is now highlighted:** this is a serious failure — it has
   attached itself to the wrong text. Tell me.

---

## Round 4 — answers appearing as they are written

1. Go to your article, select four or five paragraphs
2. Click the icon, then **Summarise**

   ✅ **Should see:** words appearing gradually, left to right, with a small blinking bar at
   the end — like someone typing
   ❌ **If you see a spinner and then the whole answer at once:** streaming isn't working.

3. Wait for it to finish

   ✅ **Should see:** the finished text, tidy — no stray ``` marks, no repeated sentences
   ✅ **Should see:** a small grey label above it saying *Summary*, possibly followed by
   *· on-device* or *· cached*

4. Press <kbd>Esc</kbd>, select the **same** paragraphs again, and click **Summarise** again

   ✅ **Should see:** the answer appears instantly, labelled *Summary · cached*

5. Select a **different** long passage and click **Summarise**
6. While the words are still appearing, click the **←** back arrow at the top of the panel

   ✅ **Should see:** it stops cleanly, no error message
   ❌ **Check Log 2** (the extension's log) for red text afterwards

7. Select a long passage, click **Key points**

   ✅ **Should see:** a short list, each line starting with a `•` bullet

### Asking a follow-up question

1. Select several paragraphs, click **Summarise**, let it finish
2. Scroll down inside the panel — there is a box saying *Ask a follow-up…*
3. Type `why does that matter?` and press <kbd>Enter</kbd>

   ✅ **Should see:** your question appears in grey with a line down its left side, then an
   answer appears underneath it, again appearing gradually

4. Ask a second question: `give me one example`

   ✅ **Should see:** an answer that makes sense in the context of the first one — it should
   not have forgotten what you were talking about

5. Click inside the question box and press the <kbd>←</kbd> and <kbd>→</kbd> arrow keys

   ✅ **Should see:** the text cursor moves within your typing
   ❌ **If the panel jumps between menu rows instead:** tell me.

6. Turn off your wi-fi, ask another question

   ✅ **Should see:** a readable error message, not a crash

7. Turn wi-fi back on and ask again

   ✅ **Should see:** it works normally — the failed attempt didn't break the conversation

---

## Round 5 — making your own tool

1. Go to the settings page, find **My tools**
2. In the name box type: `Explain like I'm five`
3. In the big box underneath, type:
   `Rewrite the text so a bright ten-year-old would understand it. Answer in {lang}.`
4. Click **Add tool**

   ✅ **Should see:** it appears in the list above, with a **Remove** button

5. Go to your article tab and **press <kbd>F5</kbd>**
6. Select a complicated paragraph, click the icon

   ✅ **Should see:** a menu row called **Explain like I'm five**

7. Click it

   ✅ **Should see:** an answer appearing gradually, plus a follow-up box underneath

8. Press <kbd>Esc</kbd>. Now select a paragraph and **right-click** it
9. Hover over **Highlight Helper** in the right-click menu

   ✅ **Should see:** **Explain like I'm five** at the top of the submenu
   ❌ **If it isn't there:** the right-click menu didn't update itself. Tell me — check Log 2.

10. Go back to settings, add a second tool: `To Spanish` /
    `Translate the text into Spanish.`
11. Reload your article tab, select a paragraph

    ✅ **Should see:** a single row called **My tools** with a `2` next to it, which opens
    into both tools when clicked

12. Go to settings and click **Remove** on one of them
13. Reload the article, right-click a selection

    ✅ **Should see:** the removed tool is gone from the right-click menu too

---

## Round 6 — the smaller tools

### 6a. Dictionary

1. On your article, **double-click a single ordinary word** — try `serendipity`, or any
   normal word
2. Click the icon

   ✅ **Should see:** a row called **Define**

3. Click it

   ✅ **Should see:** *Wiktionary · en*, then the word type (*Noun*, *Verb*) in italics, then
   numbered meanings
   ❌ **If it says a lookup error:** check Log 2 and send me what it says

4. Click **Say it**

   ✅ **Should hear:** the word spoken aloud

5. Click **Synonyms**

   ✅ **Should see:** a comma-separated list of similar words

6. Now select a made-up word like `asdfgh` and click **Define**

   ✅ **Should see:** *No dictionary entry for "asdfgh"* plus buttons linking to Wiktionary

### 6b. Link to a specific sentence

*This is the one thing that could not be tested automatically at all.*

1. Select a distinctive sentence from the middle of a long article
2. Click the icon → **Link to this text**
3. Click **Copy**
4. Open a brand new tab, paste into the address bar, press <kbd>Enter</kbd>

   ✅ **Should see:** the page opens **already scrolled down** to your sentence, with it
   highlighted in the browser's own colour
   ❌ **If it opens at the top of the page:** the link isn't working — tell me, and paste the
   link you copied

5. Now select a very common word — just the word `the` on its own
6. Click the icon → **Link to this text**

   ✅ **Should see:** a message saying it appears in too many places to link to precisely,
   offering the plain page link instead
   ❌ **If it gives you a link anyway:** that link would go to the wrong place. Tell me.

7. Select a sentence containing a hyphenated word (`well-known`, `state-of-the-art`) and
   repeat steps 2–4

   ✅ **Should see:** it still scrolls to the right place

### 6c. Search, speech, text tools

1. Select a couple of words → icon → **Search with…**

   ✅ **Should see:** a list — Google, DuckDuckGo, Wikipedia, YouTube

2. Click **Google**, then click **Open Google**

   ✅ **Should see:** a new tab with your selected words searched

3. Settings page → **Search with…** → tick **GitHub**
4. Reload the article, select words, open **Search with…**

   ✅ **Should see:** GitHub now in the list

5. On the settings page, in **Add your own**, type name `Bing` and URL
   `https://www.bing.com/search?q={q}` → **Add**

   ✅ **Should see:** *Added Bing.*

6. Try adding one with no `{q}` — just `https://www.bing.com`

   ✅ **Should see:** *The URL needs {q} where the selected text should go.*

7. Select a paragraph → icon → **Read aloud**

   ✅ **Should hear:** it read out, starting immediately
   ✅ **Should see:** a **Stop** button that works

8. Find or paste some text on several lines. Select it all → icon → **Text tools**

   ✅ **Should see:** rows including *Sort lines*, *Remove duplicate lines*, *Lines to comma
   list*. Click a few — each shows the result with a **Copy** button.

9. Select text that contains an email address and a web link

   ✅ **Should see:** *Email addresses* and *Links* rows. Open them — the addresses should
   have no stray commas or full stops stuck on the end.

10. Select any text → **Text tools** → **SHA-256**

    ✅ **Should see:** a long string of letters and numbers

11. Select this exact text from somewhere: `caf&eacute; &mdash; test`

    ✅ **Should see:** a **Decode HTML entities** row, giving `café — test`

### 6d. Keyboard shortcut

1. Click at the start of a sentence on the page
2. Hold <kbd>Shift</kbd> and press <kbd>→</kbd> repeatedly to select some words
3. Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd>

   ✅ **Should see:** the panel opens on that selection, without touching the mouse
   ❌ **If nothing happens:** go to `edge://extensions/shortcuts` and check whether something
   else has claimed that key combination

---

## Round 7 — did anything break?

*Quick pass over the tools that worked before all these changes.*

Select each of these and check the result:

1. `$50`

   ✅ Converted amount shown **in the menu row itself**, without clicking anything

2. `65 mph`

   ✅ Converted to km/h in the row

3. `#3f8ae0`

   ✅ A colour swatch
   ❌ **There must NOT be** *Search with…*, *Link to this text*, *Highlight this* or *Read
   aloud* rows. If any of those appear, tell me — this specific mistake has happened three
   times and it's worth catching.

4. `1700000000`

   ✅ Today's-style date and time in your timezone

5. `12 * 8 + 3`

   ✅ `99`

6. `https://example.com`

   ✅ A QR code — point your phone camera at it and check it opens the right site

7. `SLA`

   ✅ **Explain this** gives one sentence. Then click **Find a source**

   ✅ A real Wikipedia article, with *Did you mean:* buttons offering alternatives

8. Right-click any selection → **Highlight Helper** → try several submenu items

   ✅ Each opens the panel showing that specific tool
   ✅ The **←** back arrow walks back out through the menus

---

## Round 8 — history, and the privacy promise

1. Settings page → **Recent answers**

   ✅ **Should see:** a list of what you ran during these tests, most recent first

2. Go and re-run one tool on text you already used
3. Reload the settings page

   ✅ **Should see:** that entry moved to the top — **not** listed twice

4. Click **Clear history**

   ✅ **Should see:** *Cleared 12.* (or whatever the number is), and the list empties

5. Untick **Keep a history**
6. Go and run a tool, come back and reload settings

   ✅ **Should see:** still empty — nothing was recorded

7. Re-tick it

### The important one

*"On-device only" is a promise that your text never goes to DeepSeek. This tests that the
promise holds.*

1. Settings → **Where AI runs** → set **Answer with** to *On-device only — never send my text
   anywhere*
2. Go to your article and select a **very** long passage — several thousand words, more than
   the small local model can handle
3. Click **Summarise**

   ✅ **Should see:** a message saying it can't handle this one and suggesting settings
   ❌ **If it produces an answer:** it went to DeepSeek despite the setting. This is the most
   serious possible failure — tell me immediately.

4. Set **Answer with** back to the first option

---

## Things that look wrong but aren't

Don't spend time on these — they are deliberate:

- **You can't click on a highlight.** There is no hover, no clicking it to see its note. This
  is the price of not modifying the page. Re-select the text, or use the settings list.
- **Highlights don't appear on your other computer.** There is no account and no syncing, on
  purpose. Export to Markdown is how you move them.
- **The first "Read aloud" may use a slightly odd voice.** The browser loads its voice list
  lazily; the second one will be right.
- **On-device answers are shorter and blunter than DeepSeek's.** It is a far smaller model.
- **Nothing happens on PDFs, the Edge add-ons store, or `edge://` pages.** Browsers forbid
  extensions there.
- **The word "orange" isn't detected as a colour**, `$` is assumed to be US dollars, and
  "next Friday" isn't read as a date. All deliberate — guessing wrong is worse than not
  guessing.
