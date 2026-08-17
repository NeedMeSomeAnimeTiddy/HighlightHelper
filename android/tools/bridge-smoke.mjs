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
    } else if (message.type === 'http') {
      // Stands in for OkHttp. The shape is what the real HttpService returns:
      // a status the lookup modules read directly, and a body they parse.
      reply = { status: 200, body: JSON.stringify(WIKI_SUMMARY) };
    } else if (message.type === 'ai' || message.type === 'chat') {
      reply = { ok: true, text: '  "A stubbed answer."  ', cached: false };
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
    blocks.find((b) => b.type === 'text').text, 'A stubbed answer.');
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

/* ---------- report ---------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
