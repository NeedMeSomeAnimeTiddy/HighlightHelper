/**
 * Bridge smoke test.  Run with:  node android/tools/bridge-smoke.mjs
 *
 * The Kotlin half of this app cannot be built without an Android SDK, but the
 * half that does the actual work is ordinary JavaScript — so it can be exercised
 * here, in Node, with a stub standing in for `AndroidHost`.
 *
 * What this proves is precisely the risky part of the design: that the
 * extension's own detectors, copied in unmodified, produce rows and detail views
 * that survive the trip across the bridge as plain JSON. If this passes, the
 * only thing left between here and a working app is Kotlin drawing what it is
 * handed.
 *
 * It also mirrors Gradle's `syncEngine` copy step, so a stale assets folder
 * cannot make this pass while a real build fails.
 */

import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const assets = path.join(repo, 'android/app/src/main/assets/engine');

/* ---------- mirror the Gradle copy ---------- */

const INCLUDES = [
  ['src/common', 'src/common'],
  ['src/background/wikipedia.js', 'src/background/wikipedia.js'],
  ['src/background/dictionary.js', 'src/background/dictionary.js'],
  ['src/content/detectors', 'src/content/detectors'],
  ['src/content/kit.js', 'src/content/kit.js'],
  ['src/content/icons.js', 'src/content/icons.js'],
  ['src/content/qr.js', 'src/content/qr.js'],
  ['src/content/anchor.js', 'src/content/anchor.js'],
  ['src/content/locate.js', 'src/content/locate.js'],
  ['src/content/speech.js', 'src/content/speech.js'],
  ['src/content/local-ai.js', 'src/content/local-ai.js'],
  ['src/content/highlights.js', 'src/content/highlights.js']
];

await rm(path.join(assets, 'src'), { recursive: true, force: true });
for (const [from, to] of INCLUDES) {
  const dest = path.join(assets, to);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(path.join(repo, from), dest, { recursive: true });
}

/* ---------- stand in for Android ---------- */

let ready;
const engineReady = new Promise((resolve, reject) => { ready = { resolve, reject }; });

const settlements = new Map();
let nextCall = 0;

globalThis.window = globalThis;

/*
 * `speak` gates on the browser having speech synthesis, so without these it
 * never produces a row and its assertions below cannot run. A WebView has both;
 * Node has neither. The detector suite stubs them for the same reason.
 */
globalThis.speechSynthesis ??= { getVoices: () => [], cancel() {}, speak() {}, speaking: false };
globalThis.SpeechSynthesisUtterance ??= function SpeechSynthesisUtterance() {};

globalThis.AndroidHost = {
  ready: () => ready.resolve(),
  failed: (message) => ready.reject(new Error(message)),

  settle(callId, ok, payload) {
    const slot = settlements.get(callId);
    if (!slot) return;
    settlements.delete(callId);
    const parsed = JSON.parse(payload);
    if (ok) slot.resolve(parsed.value);
    else slot.reject(new Error(parsed.error));
  },

  /**
   * `api.send()`. The real one is OkHttp; this is a fixed rate table, so the
   * test asserts on arithmetic rather than on today's exchange rate.
   */
  request(id, messageJson) {
    const message = JSON.parse(messageJson);
    hostCalls.push(message);
    let reply;

    if (message.type === 'hh:rates') {
      reply = {
        ok: true,
        base: message.base,
        rates: { USD: 1, EUR: 0.922, GBP: 0.79, JPY: 157.2 },
        updated: Date.parse('2026-08-12T00:00:00Z'),
        stale: false
      };
    } else if (message.type === 'store') {
      // Stands in for KeyValueStore, with the same contract chrome.storage
      // has: get answers with an object keyed by what was asked for.
      if (message.op === 'get') {
        reply = message.key in fakeStore ? { [message.key]: fakeStore[message.key] } : {};
      } else {
        for (const [k, v] of Object.entries(message.patch || {})) {
          if (v === null) delete fakeStore[k];
          else fakeStore[k] = v;
        }
        reply = {};
      }
    } else if (message.type === 'http') {
      // Stands in for OkHttp. The shape is what the real HttpService returns:
      // a status the lookup modules read directly, and a body they parse.
      reply = { status: 200, body: JSON.stringify(WIKI_SUMMARY) };
    } else if (message.type === 'ai' || message.type === 'chat') {
      // Wrapped in quotes and padding so cleanOutput has something to strip,
      // and carrying markdown so the reader has something to read. Models do
      // both of these however firmly the prompt asks them not to.
      reply = { ok: true, text: '  "A stubbed answer, with **bold** and `code` in it."  ', cached: false };
    } else {
      reply = { ok: true };
    }

    queueMicrotask(() => window.__hhSettle(id, true, JSON.stringify(reply)));
  }
};

/** Enough of a Wikipedia summary response for wikipedia.js to accept it. */
const WIKI_SUMMARY = {
  type: 'standard',
  title: 'Service-level agreement',
  description: 'commitment between a service provider and a client',
  extract: 'A service-level agreement is a commitment between a service provider and a customer.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Service-level_agreement' } }
};

const hostCalls = [];
const fakeStore = {};

// pathToFileURL, because a Windows absolute path is not a URL the ESM loader
// will take — "c:" reads as a protocol.
await import(pathToFileURL(path.join(assets, 'bridge.js')).href);
await engineReady;

const call = (method, args = {}) => new Promise((resolve, reject) => {
  const id = ++nextCall;
  settlements.set(id, { resolve, reject });
  window.HH.call(id, method, JSON.stringify(args));
});

/* ---------- assertions ---------- */

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) passed++;
  else failures.push(`${label}\n      expected ${b}\n      got      ${a}`);
}

const noFunctions = (value) => JSON.parse(JSON.stringify(value)) !== undefined;

/* Currency — a lazy row value and an async detail view. */
{
  const { session, rows } = await call('detect', {
    text: 'It cost $50',
    settings: { targetCurrency: 'EUR' }
  });

  const row = rows.find((r) => r.key === 'currency');
  check('currency row crosses the bridge', row.label, 'Convert to EUR');
  check('its value is announced as a task', row.value.kind, 'task');
  check('it is drillable', row.hasDetail && row.supported, true);
  check('nothing in the row is a function', noFunctions(rows), true);

  check('the task resolves through the host', await call('rowValue',
    { session, key: 'currency' }), '€46.10');

  const view = await call('openRow', { session, key: 'currency' });
  check('the detail view is async', view.kind, 'async');

  const blocks = await call('runView', { session, view: view.view });
  check('the detail leads with a headline', blocks[0].type, 'headline');
  check('the conversion reads left to right',
    `${blocks[0].from} ${blocks[0].op} ${blocks[0].text}`, '$50.00 → €46.10');
  check('the whole detail view is plain data', noFunctions(blocks), true);
}

/* Calculator — a static blocks view, resolved without any host round trip. */
{
  const { session, rows } = await call('detect', { text: '12 * 8 + 4' });
  const row = rows.find((r) => r.key === 'calc');
  check('calc answers inline', row.value.text, '100');

  const view = await call('openRow', { session, key: 'calc' });
  check('calc needs no spinner', view.kind, 'blocks');
  check('calc shows its working', view.blocks[0].from, '12 * 8 + 4');
  check('a copy button crosses as a copy item',
    view.blocks.at(-1).items[0].kind, 'copy');
}

/* Colour — the swatch block, which is the one that carries a rendered value. */
{
  const { session, rows } = await call('detect', { text: '#3f8ae0' });
  check('colour is detected', rows[0].key, 'color');

  const view = await call('openRow', { session, key: 'color' });
  check('the swatch carries a CSS colour', view.blocks[0].type, 'swatch');
  check('and it is one Kotlin can parse',
    /^rgba?\(/.test(view.blocks[0].css), true);
}

/* A submenu, which is where row keys have to survive intact. */
{
  const { session, rows } = await call('detect', { text: 'Hello brave new world' });
  const row = rows.find((r) => r.key === 'texttools');
  const view = await call('openRow', { session, key: 'texttools' });
  check('text tools opens a menu', view.kind, 'menu');
  check('its children keep their keys',
    view.rows.some((r) => r.key === 'texttools:upper'), true);

  const child = await call('openRow', { session, key: 'texttools:upper' });
  check('and a child row opens from the same session', child.kind, 'blocks');
}

/*
 * A streamed AI answer.
 *
 * The one view kind a native renderer cannot fake, and the only one whose
 * result arrives in pieces — so what crosses here is the *promise* of a view
 * rather than a view, and Kotlin has to know to show a spinner it can name.
 */
{
  const longText = 'The committee met on Tuesday to review the quarterly figures. '.repeat(6);
  const { session, rows } = await call('detect', { text: longText });

  const row = rows.find((r) => r.key === 'summarize');
  check('a summary is offered', row.label, 'Summarise');

  const view = await call('openRow', { session, key: 'summarize' });
  check('and it streams', view.kind, 'stream');
  check('with something to show while waiting', view.loading, 'Summarising…');
  check('and a handle to run it', typeof view.view, 'string');
}

/*
 * Every detector must be renderable.
 *
 * This was a check that unconverted detectors degraded gracefully; now that
 * they are all converted it asserts the stronger thing, which is that nothing
 * reaches the sheet marked unsupported. Left as an assertion rather than
 * deleted because a new detector written the old way would trip it.
 */
{
  const { rows } = await call('detect', {
    text: 'The quick brown fox jumped over the lazy dog and ran away.'
  });
  const unsupported = rows.filter((r) => !r.supported).map((r) => r.key);
  check('every row the sheet receives can be rendered', unsupported, []);
}

/*
 * The AI path: the prompt is built in JS and Kotlin is a transport.
 *
 * What crosses must be a finished system/user pair, because the alternative —
 * sending an action name and letting Kotlin look up the wording — is a second
 * copy of every prompt in this project.
 */
{
  const longText = 'The committee met on Tuesday to review the quarterly figures. '.repeat(6);
  const { session } = await call('detect', { text: longText });

  hostCalls.length = 0;
  const view = await call('openRow', { session, key: 'summarize' });
  const blocks = await call('runView', { session, view: view.view });

  const ai = hostCalls.find((c) => c.type === 'ai');
  check('the AI request carries a built prompt, not an action name',
    [typeof ai.system, typeof ai.user, 'action' in ai], ['string', 'string', false]);
  check('the system prompt is the real one', ai.system.includes('summar'), true);
  check('a streamed view asks the host to stream', ai.stream, true);
  check('the answer comes back through cleanOutput',
    blocks.find((b) => b.type === 'text').text,
    'A stubbed answer, with **bold** and `code` in it.');
}

/*
 * The dictionary, served by the extension's own module through the fetch shim.
 * Nothing about Wiktionary is reimplemented in Kotlin; this proves the request
 * leaves as an ordinary host call and the answer is shaped by dictionary.js.
 */
{
  const { session } = await call('detect', { text: 'serendipity' });
  hostCalls.length = 0;

  const view = await call('openRow', { session, key: 'dictionary' });
  await call('runView', { session, view: view.view }).catch(() => null);

  const http = hostCalls.find((c) => c.type === 'http');
  check('a lookup goes out as a plain http request', Boolean(http), true);
  check('and it is https', http.url.startsWith('https://'), true);
  check('the engine never asks the host for hh:define',
    hostCalls.some((c) => c.type === 'hh:define'), false);
}

/*
 * Settings reach the detectors.
 *
 * This is the regression that made the app give wrong answers rather than
 * fewer: the sheet sent an empty object, so every conversion ran on DEFAULTS
 * and a British user selecting "$50" was told it was already in their currency.
 * Overrides only — the engine merges them over DEFAULTS itself.
 */
{
  const { rows } = await call('detect', {
    text: 'It cost $50',
    settings: { targetCurrency: 'GBP' }
  });
  check('a currency override reaches the row',
    rows.find((r) => r.key === 'currency').label, 'Convert to GBP');
}
/*
 * `unitSystem` picks the family a conversion aims at when there is a genuine
 * choice — it does not stop miles converting to km, because converting out of
 * the source unit is the point. A temperature in kelvin is the case where the
 * preference actually decides the answer.
 */
{
  const metric = await call('detect', { text: '300 K', settings: { unitSystem: 'metric' } });
  const imperial = await call('detect', { text: '300 K', settings: { unitSystem: 'imperial' } });
  check('unitSystem chooses the target family',
    [metric.rows.find((r) => r.key === 'unit').value.text,
     imperial.rows.find((r) => r.key === 'unit').value.text],
    ['26.9 °C', '80.3 °F']);
}
{
  const us = await call('detect', { text: '5 gal', settings: { imperialFlavor: 'us' } });
  const uk = await call('detect', { text: '5 gal', settings: { imperialFlavor: 'uk' } });
  check('and a gallon is not the same on both sides of the Atlantic',
    [us.rows.find((r) => r.key === 'unit').value.text,
     uk.rows.find((r) => r.key === 'unit').value.text],
    ['18.93 L', '22.73 L']);
}
{
  const { rows } = await call('detect', {
    text: 'It cost $50',
    settings: { detectors: { currency: false } }
  });
  check('a detector switched off contributes nothing',
    rows.some((r) => r.key === 'currency'), false);
}

/*
 * The settings screen asks the engine what the defaults are rather than
 * keeping a Kotlin copy, so this is the payload it depends on.
 */
{
  const info = await call('defaults');
  check('defaults carry the real settings object',
    info.settings.targetCurrency, 'USD');
  check('every registered detector is offered as a toggle',
    info.registry.length, 22);
  check('and the pickers get their lists',
    [info.languages.length > 5, info.currencies.length > 20], [true, true]);
}

/*
 * The blocks that replaced the escape hatch.
 *
 * Eleven views used to tell the phone they needed the browser panel. They were
 * three shapes repeated — deferred work, a conversation, and a picker — and
 * what matters about each is not that it renders but that it keeps its bargain:
 * a disclosure must not do its work until asked, and a conversation must
 * survive more than one turn.
 */
{
  const longText = 'The committee met on Tuesday to review the quarterly figures. '.repeat(6);
  const { session } = await call('detect', { text: longText });
  const view = await call('openRow', { session, key: 'summarize' });
  const blocks = await call('runView', { session, view: view.view });

  const kinds = blocks.map((b) => b.type);
  check('a summary no longer needs the browser panel',
    kinds.includes('unsupported'), false);

  const disclosure = blocks.find((b) => b.type === 'disclosure');
  const conversation = blocks.find((b) => b.type === 'conversation');

  check('"Find a source" crosses as deferred work', Boolean(disclosure?.action), true);
  check('and a follow-up thread crosses as a conversation',
    Boolean(conversation?.chat), true);

  // The point of a disclosure: the lookup has NOT happened yet.
  hostCalls.length = 0;
  check('a disclosure does nothing until it is opened', hostCalls.length, 0);

  const opened = await call('runBlocks', { session, action: disclosure.action });
  check('opening it returns blocks to draw', Array.isArray(opened), true);
  check('and it did the work only then', hostCalls.length > 0, true);

  // A conversation has to hold its history, or the second question arrives
  // with no idea what the first one was about.
  const first = await call('ask', { session, chat: conversation.chat, question: 'why?' });
  const second = await call('ask', { session, chat: conversation.chat, question: 'and then?' });
  check('a follow-up answers', first, 'A stubbed answer, with **bold** and `code` in it.');
  check('and answers again on the same thread', second, 'A stubbed answer, with **bold** and `code` in it.');

  const asked = hostCalls.filter((c) => c.type === 'chat');
  check('the thread grows rather than restarting',
    asked.at(-1).messages.length > asked[0].messages.length, true);
}

/*
 * A model's markdown, read before it crosses.
 *
 * `rich: true` is a flag the panel knows how to act on and Kotlin did not, so
 * an explanation arrived on the phone with its asterisks still in it. The
 * parsed tokens cross instead, which keeps the one markdown reader this
 * project has serving both platforms.
 */
{
  const { session } = await call('detect', { text: 'SLA' });
  const view = await call('openRow', { session, key: 'explain' });
  const blocks = await call('runView', { session, view: view.view });

  const text = blocks.find((b) => b.type === 'text');
  check('a rich text block carries parsed tokens', Array.isArray(text.tokens), true);
  check('the markers are gone from the words',
    text.tokens.some((t) => t.text.includes('**')), false);
  check('and what was bold is marked bold',
    text.tokens.some((t) => t.tag === 'strong'), true);
  check('and inline code is marked as code',
    text.tokens.some((t) => t.tag === 'code'), true);
  check('the words themselves are unchanged',
    text.tokens.map((t) => t.text).join(''),
    'A stubbed answer, with bold and code in it.');
}

/* The QR grid, as data rather than as a drawing. */
{
  const { session } = await call('detect', { text: 'https://example.com' });
  const view = await call('openRow', { session, key: 'qr' });
  const blocks = view.kind === 'blocks'
    ? view.blocks
    : await call('runView', { session, view: view.view });

  const qr = blocks.find((b) => b.type === 'qrcode');
  check('a QR code crosses as its module grid', Boolean(qr), true);
  check('the grid is square', qr.modules.length, qr.modules[0].length);
  check('and it is ones and zeroes, not markup',
    qr.modules.flat().every((m) => m === 0 || m === 1), true);
}

/* Read aloud: the text and the language, not a player. */
{
  const { session } = await call('detect', { text: 'Read this sentence aloud.' });
  const view = await call('openRow', { session, key: 'speak' });
  const blocks = view.kind === 'blocks'
    ? view.blocks
    : await call('runView', { session, view: view.view });
  check('read aloud crosses as text to say',
    Boolean(blocks.find((b) => b.type === 'speech')?.text), true);
}

/*
 * History, kept by the extension's own module.
 *
 * `history.js` runs unmodified against a storage shim, so what is being
 * checked is that its rules survive the arrangement — particularly the one
 * worth having: running the same tool on the same text again replaces the
 * entry rather than stacking a near-duplicate, because a history that is
 * ninety percent one repeated lookup is no history at all.
 */
{
  // Every AI call earlier in this file was recorded too — which is the feature
  // working, not a leak — so start from a known state rather than assuming one.
  await call('clearHistory');
  check('history starts empty once cleared', (await call('history')).length, 0);

  const { session } = await call('detect', { text: 'SLA' });
  const view = await call('openRow', { session, key: 'explain' });
  await call('runView', { session, view: view.view });

  const after = await call('history');
  check('an answer is remembered', after.length, 1);
  check('with the selection it was asked about', after[0].source, 'SLA');
  check('and the answer itself', after[0].text, 'A stubbed answer, with **bold** and `code` in it.');
  check('stamped with a time', typeof after[0].at, 'number');

  // The same tool on the same text again — one entry, not two.
  const again = await call('openRow', { session, key: 'explain' });
  await call('runView', { session, view: again.view });
  check('asking the same thing twice does not stack',
    (await call('history')).length, 1);

  // A different selection is a different entry.
  const other = await call('detect', { text: 'CI/CD' });
  const otherView = await call('openRow', { session: other.session, key: 'explain' });
  await call('runView', { session: other.session, view: otherView.view });
  const two = await call('history');
  check('a different selection is its own entry', two.length, 2);
  check('and the newest is first', two[0].source, 'CI/CD');

  check('clearing reports what it removed', await call('clearHistory'), 2);
  check('and it is gone', (await call('history')).length, 0);

  // The history screen names an action; the wording comes from the same list
  // the right-click menu is built from rather than from a second set of names.
  const titles = await call('actionTitles');
  check('an action has a real name, not a title-cased id',
    [titles.fix, titles.keypoints, titles['comment-code']],
    ['Fix spelling & grammar', 'Key points', 'Add comments to this code']);
}

/*
 * "What is this about" is the model being asked so Wikipedia can be searched,
 * not something anyone requested — so it must not appear in the history.
 */
{
  await call('clearHistory');
  const { session } = await call('detect', {
    text: 'The committee met on Tuesday to review the quarterly figures. '.repeat(6)
  });
  const view = await call('openRow', { session, key: 'summarize' });
  const blocks = await call('runView', { session, view: view.view });
  await call('runBlocks', { session, action: blocks.find((b) => b.type === 'disclosure').action });

  const actions = (await call('history')).map((h) => h.action);
  check('the summary is remembered', actions.includes('summarize'), true);
  check('the topic lookup behind it is not', actions.includes('topics'), false);
  await call('clearHistory');
}

/*
 * The setting is honoured on the engine's side, so no caller has to remember.
 */
{
  const { session } = await call('detect', { text: 'SLA', settings: { keepHistory: false } });
  const view = await call('openRow', { session, key: 'explain' });
  await call('runView', { session, view: view.view });
  check('history switched off records nothing', (await call('history')).length, 0);
}

/*
 * A tool the user wrote.
 *
 * The detector has always worked on the phone; until the editor there was no
 * way to put one in settings, so nothing exercised the path. What matters is
 * that a tool written on this platform becomes a row keyed the way the rest of
 * the app expects, and that its prompt is what actually reaches the model.
 */
{
  const tools = [{ id: 'ab12-cd', name: 'Explain simply', prompt: 'Explain simply in {lang}.' }];
  const { session, rows } = await call('detect', {
    text: 'The committee reviewed the quarterly figures and found them consistent.',
    settings: { customTools: tools }
  });

  const row = rows.find((r) => r.key.startsWith('custom'));
  check('a user-written tool becomes a row', row.label, 'Explain simply');
  check('keyed by its id', row.key, 'custom:ab12-cd');

  hostCalls.length = 0;
  const view = await call('openRow', { session, key: 'custom:ab12-cd' });
  await call('runView', { session, view: view.view });

  const ai = hostCalls.find((c) => c.type === 'ai');
  check("the user's own prompt is what is sent",
    ai.system.includes('Explain simply in'), true);
  // {lang} resolved; {title} and {url} would fill empty here, because an
  // intent carries a string and no page.
  check('and its placeholders were filled',
    ai.system.includes('{lang}'), false);
}

/* ---------- report ---------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
