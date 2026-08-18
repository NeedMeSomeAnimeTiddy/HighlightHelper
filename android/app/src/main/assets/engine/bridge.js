/**
 * The Android bridge.
 *
 * The extension's detectors run here, unmodified, inside a headless WebView.
 * Kotlin owns the network, the storage and every pixel; this file owns nothing
 * but the answer to "what did you find in this string, and what can be done
 * with it".
 *
 * ---
 *
 * The one rule that shapes everything below: **functions do not cross.**
 *
 * A row's `value.task` and a view's `run` are ordinary JS closures, and there
 * is no way to hand one to Kotlin. But there is also no need to: the JS runs
 * in-process, so the closure can simply stay here and be addressed by name. A
 * session holds the live rows; Kotlin holds their keys. When the user taps a
 * row, Kotlin sends back the key and this file calls the function that was
 * waiting for it.
 *
 * That is why the port did not need a serialisation format for behaviour — only
 * for description. Everything crossing the bridge is JSON, and everything that
 * cannot be JSON stays on this side of it.
 */

import { detect, getDetector, LIST } from './src/content/detectors/index.js';
import { DEFAULTS } from './src/common/settings.js';
import { buildPrompt, cleanOutput } from './src/common/prompts.js';
import { lookup, searchLinks, wikiLang } from './src/background/wikipedia.js';
import { define, synonyms, dictionaryLinks, wiktLang } from './src/background/dictionary.js';
import { parseMarkup } from './src/content/kit.js';
import { readHistory, remember, clearHistory } from './src/common/history.js';
import { CONTEXT_TOOLS } from './src/common/tools.js';
import { AI } from './src/common/constants.js';
import { LANGUAGES } from './src/common/languages.js';
import { CURRENCY_CODES, currencyName } from './src/common/currencies.js';

/* ------------------------------------------------------------------ *
 * Calling out to Kotlin
 * ------------------------------------------------------------------ */

let nextCall = 0;
const pending = new Map();

/**
 * `api.send()`, answered by OkHttp instead of a service worker.
 *
 * The detectors are written against the extension's message protocol — the
 * currency row asks for `MSG.RATES` and does not care who answers. Keeping that
 * shape means the detector files did not have to change to run here.
 */
function hostRequest(message) {
  return new Promise((resolve, reject) => {
    const id = ++nextCall;
    pending.set(id, { resolve, reject });
    AndroidHost.request(id, JSON.stringify(message));
  });
}

/**
 * `fetch`, rerouted through OkHttp.
 *
 * The encyclopedia and dictionary lookups are the extension's own modules —
 * `src/background/wikipedia.js` and `dictionary.js` — copied in and running
 * unchanged, which means their URL building, their ranking and their rather
 * fiddly Wiktionary shaping are not reimplemented here. What they cannot have
 * is the page's `fetch`: this WebView is not allowed to reach the network, and
 * a cross-origin request from an asset origin would be at the mercy of whatever
 * CORS headers each API happens to send.
 *
 * So the global is replaced. The three properties those modules actually use —
 * `status`, `ok`, `json()` — are all this needs to provide, and the request
 * goes out through Kotlin like every other one.
 */
window.fetch = async (url) => {
  const res = await hostRequest({ type: 'http', url: String(url) });
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    json: async () => JSON.parse(res.body || 'null'),
    text: async () => res.body || ''
  };
};

/**
 * `chrome.storage.local`, backed by a file Kotlin owns.
 *
 * `src/common/history.js` is the reason this exists. What is worth keeping
 * about it is not the storage but the rules — truncate a long selection
 * because the point is recognition rather than archive, replace an entry when
 * the same tool is run on the same text rather than stacking a near-duplicate,
 * cap the list, newest first. Reimplementing those in Kotlin would be writing
 * the interesting half again; giving it somewhere to put things runs it as it
 * stands.
 *
 * Only the three methods it actually calls. This is not an attempt at the
 * extension API — anything reaching for more of `chrome` on this side is code
 * that should not have been copied in.
 */
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => hostRequest({ type: 'store', op: 'get', key: String(key) }),
      set: async (patch) => hostRequest({ type: 'store', op: 'set', patch }),
      remove: async (key) => hostRequest({ type: 'store', op: 'set', patch: { [key]: null } })
    }
  }
};

/** Kotlin's answer to hostRequest, called back in by evaluateJavascript. */
window.__hhSettle = (id, ok, payload) => {
  const slot = pending.get(id);
  if (!slot) return;
  pending.delete(id);
  const value = payload ? JSON.parse(payload) : null;
  if (ok) slot.resolve(value);
  else slot.reject(new Error(value?.error || 'Request failed'));
};

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

/**
 * One selection's worth of live state.
 *
 * Keyed rather than global because the sheet can be reopened on new text while
 * a slow row from the previous selection is still resolving, and that answer
 * must not land in the new sheet.
 */
let nextSession = 0;
const sessions = new Map();

function session(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('That selection is no longer open');
  return s;
}

/**
 * The worker's message protocol, answered here.
 *
 * The encyclopedia and dictionary calls are served by the extension's own
 * background modules rather than passed to Kotlin: everything they do beyond
 * the HTTP request — choosing a wiki language, ranking articles against the
 * surrounding text, flattening Wiktionary's shape into senses — is pure logic
 * that already exists and would otherwise be written a second time in Kotlin
 * and drift. Their `fetch` is the shim above, so the request still goes out
 * through OkHttp.
 *
 * Anything else is Kotlin's: the clipboard, the browser, and DeepSeek.
 */
async function handleSend(s, msg) {
  const settings = s.settings;

  switch (msg?.type) {
    case 'hh:source': {
      const term = String(msg.term || '').trim();
      if (!term) return { ok: false, error: 'Nothing to look up' };
      const lang = wikiLang(msg.language || settings.language);
      const articles = await lookup(term, lang, String(msg.context || ''));
      return { ok: true, articles, cached: false, links: searchLinks(term, lang) };
    }

    case 'hh:define': {
      const word = String(msg.word || '').trim();
      if (!word) return { ok: false, error: 'Nothing to look up' };
      const lang = wiktLang(msg.language || settings.language);
      const result = await define(word, lang);
      return { ok: true, ...result, cached: false, links: dictionaryLinks(word, lang) };
    }

    case 'hh:synonyms': {
      const word = String(msg.word || '').trim();
      if (!word) return { ok: false, error: 'Nothing to look up' };
      const lang = wiktLang(msg.language || settings.language);
      return { ok: true, words: await synonyms(word, lang), cached: false };
    }

    default:
      return hostRequest(msg);
  }
}

/** The api object a task or a view sees. Deliberately a subset of the panel's. */
function apiFor(s) {
  return {
    settings: s.settings,
    context: { title: '', host: '', url: s.url || '' },
    canReplace: s.canReplace,
    send: (msg) => handleSend(s, msg),

    /**
     * The prompt is built here, not in Kotlin.
     *
     * `buildPrompt` holds every instruction this extension gives a model, and
     * the wording of those is the product. Sending the finished system/user
     * pair over the bridge keeps Kotlin a transport that knows nothing about
     * what is being asked — so a prompt improvement lands on both platforms by
     * editing one file, and `cleanOutput` tidies the answer on the way back
     * for the same reason.
     */
    async ai(action, text, options = {}, onChunk = null) {
      const merged = { language: s.settings.language, ...options };
      const prompt = buildPrompt(action, text, merged);
      const res = await hostRequest({
        type: 'ai',
        system: prompt.system,
        user: prompt.user,
        maxTokens: prompt.maxTokens,
        temperature: prompt.temperature,
        model: merged.model || s.settings.model,
        stream: Boolean(onChunk)
      });
      const answer = cleanOutput(res.text || '');

      /*
       * Recorded here rather than in Kotlin, for the same reason the prompt is
       * built here: the worker does it at exactly this point in the extension,
       * so both platforms keep the same history under the same rules. It
       * honours its setting on this side too, so no caller has to remember to
       * check — and it is deliberately not awaited, because failing to write a
       * history entry must never cost the answer the user is waiting for.
       */
      // TOPICS is excluded on purpose: it is the model being asked what a
      // passage is about so that Wikipedia can be searched for it, not
      // something anyone requested. Recording it would fill the history with
      // entries for a step the user never saw.
      if (s.settings.keepHistory !== false && action !== AI.TOPICS) {
        remember({ action, source: text, text: answer }).catch(() => {});
      }

      return { ok: true, text: answer, cached: Boolean(res.cached) };
    },

    async chat(messages, onChunk = null) {
      const res = await hostRequest({
        type: 'chat',
        messages,
        model: s.settings.model,
        stream: Boolean(onChunk)
      });
      return { ok: true, text: cleanOutput(res.text || '') };
    },

    copy: (text) => hostRequest({ type: 'copy', text }),
    replace: (text) => hostRequest({ type: 'replace', text }),
    openUrl: (url) => hostRequest({ type: 'open', url })
  };
}

/* ------------------------------------------------------------------ *
 * Description
 * ------------------------------------------------------------------ */

/**
 * A row, flattened for Kotlin.
 *
 * `supported` is the transitional flag and it earns its keep: detectors are
 * being moved from `items()` (which builds DOM) to `rows()` (which describes
 * it) one at a time, and a detector still on the old form cannot render here at
 * all. Saying so in the row is far better than the alternatives — hiding the
 * row would make the app look like it detected less than it did, and calling
 * `open()` would hand back a DOM node that Kotlin has no use for.
 */
function describeRow(s, row) {
  const out = {
    key: row.key,
    icon: row.icon || 'dot',
    label: String(row.label),
    detailTitle: String(row.detailTitle || row.label),
    hasDetail: Boolean(row.detail || row.open),
    supported: Boolean(row.detail) || !row.open
  };

  if (typeof row.value?.task === 'function') {
    s.tasks.set(row.key, row.value.task);
    out.value = { kind: 'task' };
  } else if (row.value != null) {
    out.value = { kind: 'text', text: String(row.value) };
  }

  return out;
}

/**
 * A block, with any behaviour it carries lifted out into the session.
 *
 * `actions` and `buttons` are the only blocks holding functions, and both are
 * handled the same way: the function goes in the registry, an id goes over the
 * bridge, and Kotlin sends the id back when the button is pressed.
 */
function describeBlock(s, b) {
  if (!b || typeof b.type !== 'string') return null;

  const register = (fn) => {
    const id = `act${++s.actionSeq}`;
    s.actions.set(id, fn);
    return id;
  };

  switch (b.type) {
    case 'actions':
      return {
        type: 'actions',
        text: b.text,
        extra: (b.extra || []).map((x) => ({
          label: x.label, icon: x.icon || null, action: register(x.run)
        }))
      };

    case 'buttons':
      return {
        type: 'buttons',
        // A copy item carries its text rather than a callback, so Kotlin can
        // draw a real copy button and put the string on the clipboard itself —
        // no round trip, and the confirmation stays on the button where the
        // extension puts it.
        items: (b.items || []).map((x) => (x.copy != null
          ? { kind: 'copy', text: String(x.copy) }
          : {
              kind: 'button',
              label: x.label,
              icon: x.icon || null,
              variant: x.variant || '',
              action: register(x.run)
            }))
      };

    case 'menu':
      return { type: 'menu', rows: (b.rows || []).map((r) => describeRow(s, r)) };

    /*
     * Deferred work. The function stays here and an id crosses; Kotlin draws a
     * button and calls `runBlocks` when it is pressed, which is the same
     * bargain the panel makes — nothing costing a request runs until asked.
     */
    case 'disclosure':
      return {
        type: 'disclosure',
        label: b.label,
        icon: b.icon || null,
        busy: b.busy || 'Working…',
        action: register(b.run)
      };

    case 'choice':
      return {
        type: 'choice',
        label: b.label || 'Choose',
        value: b.value,
        options: b.options || [],
        busy: b.busy || 'Working…',
        action: register(b.run)
      };

    /*
     * A conversation crosses as the two turns it starts from, never as itself.
     * Each side keeps its own history — the panel in a closure, Kotlin in this
     * registry — because what has to be shared is where the thread begins, not
     * how either of them is holding it.
     */
    case 'conversation': {
      const id = `chat${++s.actionSeq}`;
      s.chats.set(id, [
        ...(b.system ? [{ role: 'system', content: b.system }] : []),
        { role: 'user', content: b.source },
        { role: 'assistant', content: b.answer }
      ]);
      return { type: 'conversation', chat: id };
    }

    // The grid, not a drawing of it — see kit.js.
    case 'qrcode':
      return { type: 'qrcode', modules: b.modules.map((row) => row.map((on) => (on ? 1 : 0))) };

    case 'speech':
      return { type: 'speech', text: b.text, lang: b.lang || null };

    /*
     * A rich text block is read here rather than on the far side.
     *
     * Models emit `**like this**` however firmly the prompt asks them not to,
     * and the panel renders it instead of showing the asterisks. Android was
     * printing them, because `rich` was a flag it had no reader for. Sending
     * the parsed tokens rather than the flag means the one markdown reader
     * this project has — tested in Node, and full of hard-won rules about
     * snake_case and multiplication signs — serves both platforms.
     */
    case 'text':
      return b.rich ? { ...b, tokens: parseMarkup(b.text) } : b;

    /*
     * The escape hatch, and the one thing that genuinely does not port. A
     * `custom` block builds DOM directly — the QR canvas, the "Find a source"
     * panel — so there is nothing here to describe. Kotlin draws a short note
     * in its place rather than silently dropping it, because a view that is
     * quietly missing a section looks like a bug in the detector.
     */
    case 'custom':
      return { type: 'unsupported', note: b.note || 'Not available in the app yet.' };

    default:
      // Every other block is already plain data — headline, facts, note, text,
      // quote, label, sub, swatch — so it crosses as it stands.
      return b;
  }
}

function describeView(s, spec) {
  if (!spec) return { kind: 'blocks', blocks: [] };

  switch (spec.kind) {
    case 'menu':
      return { kind: 'menu', rows: (spec.rows || []).map((r) => describeRow(s, r)) };

    case 'async': {
      const id = `view${++s.actionSeq}`;
      s.views.set(id, spec);
      return { kind: 'async', loading: spec.loading || 'Working…', view: id };
    }

    case 'stream': {
      const id = `view${++s.actionSeq}`;
      s.views.set(id, spec);
      return { kind: 'stream', loading: spec.loading || 'Working…', view: id };
    }

    case 'blocks':
    default:
      return {
        kind: 'blocks',
        blocks: (spec.blocks || []).map((b) => describeBlock(s, b)).filter(Boolean)
      };
  }
}

/** Finds a row by key, including inside a submenu that has been opened. */
function findRow(s, key) {
  const hit = s.rows.find((r) => r.key === key);
  if (hit) return hit;
  for (const rows of s.submenus) {
    const child = rows.find((r) => r.key === key);
    if (child) return child;
  }
  throw new Error(`No such row: ${key}`);
}

/* ------------------------------------------------------------------ *
 * The methods Kotlin calls
 * ------------------------------------------------------------------ */

const METHODS = {
  /** Runs detection and returns the menu. The only synchronous part. */
  detect({ text, settings, canReplace = false, url = '' }) {
    const merged = {
      ...DEFAULTS,
      ...(settings || {}),
      detectors: { ...DEFAULTS.detectors, ...((settings || {}).detectors || {}) }
    };

    const id = ++nextSession;
    const s = {
      id, text, settings: merged, canReplace, url,
      rows: [], submenus: [], tasks: new Map(), actions: new Map(),
      views: new Map(), chats: new Map(), actionSeq: 0
    };
    sessions.set(id, s);

    /*
     * The page facts a row is allowed to know. Mostly empty here, and honestly
     * so: a PROCESS_TEXT intent carries a string and nothing else. There is no
     * title and no URL unless the text arrived by share, and there is no
     * right-click "translate to French" on Android — the sheet's own picker
     * does that job after the fact.
     */
    const rowContext = {
      forcedLanguage: null,
      title: '',
      host: '',
      url: url || ''
    };

    // Keep only the newest few. A phone can open the sheet many times in a
    // session and every one of these holds the selection text.
    for (const old of [...sessions.keys()].slice(0, -4)) sessions.delete(old);

    for (const hit of detect(text, merged)) {
      let produced;
      try {
        produced = hit.detector.rows
          ? hit.detector.rows({ text, match: hit.match, settings: merged, context: rowContext })
          : [{ key: hit.detector.id, icon: hit.detector.id, label: hit.detector.title, open: true }];
      } catch (err) {
        console.warn(`detector "${hit.detector.id}" failed:`, err);
        continue;
      }
      for (const row of produced || []) s.rows.push(row);
    }

    return { session: id, rows: s.rows.map((r) => describeRow(s, r)) };
  },

  /** The lazy right-hand value on a row. */
  rowValue({ session: id, key }) {
    const s = session(id);
    const task = s.tasks.get(key);
    if (!task) throw new Error(`No pending value for ${key}`);
    return Promise.resolve(task(apiFor(s))).then((v) => String(v ?? '—'));
  },

  /** Drilling into a row. */
  openRow({ session: id, key }) {
    const s = session(id);
    const row = findRow(s, key);
    if (!row.detail) throw new Error('That tool is not available in the app yet.');
    const view = describeView(s, row.detail);
    if (view.kind === 'menu') {
      s.submenus.push(row.detail.rows || []);
    }
    return view;
  },

  /**
   * Running a view's body, once its spinner is on screen.
   *
   * The two kinds differ in what `run` resolves to, and conflating them was a
   * bug: an `async` run returns the blocks, but a `stream` run returns the
   * model's *result*, which only becomes blocks once `done` has shaped it.
   * Treating a stream like an async view handed the renderer a result object
   * where a block list belonged, and the finished answer never appeared.
   */
  runView({ session: id, view }) {
    const s = session(id);
    const spec = s.views.get(view);
    if (!spec) throw new Error('That view is no longer open');

    const api = apiFor(s);
    const shape = (list) => (list || []).map((b) => describeBlock(s, b)).filter(Boolean);

    if (spec.kind === 'stream') {
      /*
       * `emit` is deliberately a no-op, and must still be passed.
       *
       * In the panel it is how tokens reach the view. Here they never travel
       * this way: Kotlin is the side holding the HTTP connection, so it already
       * has the answer as it arrives and publishes it to the sheet directly.
       * What matters is that `emit` is *present* — `api.ai` reads a non-null
       * callback as "stream this one", so passing null would quietly turn every
       * summary back into four seconds of spinner.
       */
      const emit = () => {};
      return Promise.resolve(spec.run(api, emit))
        .then((res) => shape(spec.done(res, api)));
    }

    return Promise.resolve(spec.run(api)).then(shape);
  },

  /** A button inside a rendered view. */
  runAction({ session: id, action }) {
    const s = session(id);
    const fn = s.actions.get(action);
    if (!fn) throw new Error('That button is no longer live');
    return Promise.resolve(fn(apiFor(s))).then(() => true);
  },

  /**
   * A disclosure being opened, or a choice being changed.
   *
   * Both resolve to a fresh list of blocks that replaces what was there, which
   * is why they share a method: the difference between them is what the user
   * pressed, not what comes back.
   */
  runBlocks({ session: id, action, value = null }) {
    const s = session(id);
    const fn = s.actions.get(action);
    if (!fn) throw new Error('That control is no longer live');
    return Promise.resolve(fn(apiFor(s), value))
      .then((list) => (list || []).map((b) => describeBlock(s, b)).filter(Boolean));
  },

  /**
   * One more turn in a follow-up thread.
   *
   * The history lives here and grows with each turn. A failed turn is popped
   * back off, or the next question would carry an unanswered one and the model
   * would try to answer both — the panel learned that the hard way.
   */
  ask({ session: id, chat, question }) {
    const s = session(id);
    const messages = s.chats.get(chat);
    if (!messages) throw new Error('That conversation is no longer open');

    messages.push({ role: 'user', content: String(question || '') });
    return apiFor(s).chat(messages)
      .then((res) => {
        messages.push({ role: 'assistant', content: res.text });
        return res.text;
      })
      .catch((err) => {
        messages.pop();
        throw err;
      });
  },

  /** The recent answers, newest first. */
  history() {
    return readHistory();
  },

  /**
   * Human wording for the AI action ids a history entry carries.
   *
   * The good phrasing already exists — "Fix spelling & grammar", "Key points",
   * "Add comments to this code" — in `CONTEXT_TOOLS`, which the right-click
   * menu is built from. It is keyed by *tool* id rather than by AI action, and
   * those agree for most of them; the two that do not are mapped here rather
   * than reworded, because the alternative is a second set of names for the
   * same operations that can disagree with the menu.
   *
   * Without this Kotlin can only title-case the id, which turns
   * "comment-code" into "Comment code" and "keypoints" into "Keypoints".
   */
  actionTitles() {
    const titles = {};
    const walk = (items) => {
      for (const item of items) {
        if (item.type === 'separator') continue;
        if (item.id && item.title && !item.grouping) {
          // A tone lives at `rewrite:fix` and records as `fix`; the trailing
          // segment is the action for every nested row that has one.
          titles[item.id.split(':').pop()] = item.title;
          titles[item.id] = item.title;
        }
        if (Array.isArray(item.children)) walk(item.children);
      }
    };
    walk(CONTEXT_TOOLS);

    // `code` is the tool and `explain-code` is the action it sends; the
    // comment row is `code:comment` against `comment-code`. Nothing derives
    // one from the other, so the two are stated.
    titles[AI.EXPLAIN_CODE] = titles.code || 'Explain this code';
    titles[AI.COMMENT_CODE] = titles.comment || 'Add comments to this code';
    titles[AI.CUSTOM] = 'My tools';

    return titles;
  },

  clearHistory() {
    return clearHistory();
  },

  /** Lets Kotlin ask what a detector is called without hard-coding the list. */
  detectorTitle({ id }) {
    return getDetector(id)?.title || id;
  },

  /**
   * The default settings, and the list of detectors, read from the source.
   *
   * The settings screen needs to know what a preference falls back to and what
   * detectors exist. Both are already stated once — in `DEFAULTS` and in the
   * detector registry — so Kotlin asks rather than keeping a second copy that
   * would quietly disagree the first time a detector is added.
   *
   * It is also why the store on the Kotlin side holds only the user's
   * *overrides*: the engine merges them over DEFAULTS itself, exactly as
   * `getSettings()` does in the extension.
   */
  defaults() {
    return {
      settings: DEFAULTS,
      // `registry`, not `detectors`: `settings.detectors` in the same payload
      // is the on/off map, and two things a caller reaches for by the same name
      // meaning different shapes is a trap worth not setting.
      registry: LIST.map((d) => ({ id: d.id, title: d.title })),
      // The pickers' contents, for the same reason: these lists are long,
      // they already exist, and a hand-maintained Kotlin copy would be wrong
      // the first time one of them changed.
      languages: LANGUAGES,
      currencies: [...CURRENCY_CODES].sort().map((code) => [code, currencyName(code)])
    };
  }
};

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Every call is async, including the ones that could be synchronous.
 *
 * `evaluateJavascript`'s own callback can only carry a value that already
 * exists, so a uniform promise-and-settle path is one code path instead of two,
 * and detection being "fast enough to be sync" is not a property worth building
 * a second mechanism around.
 */
window.HH = {
  call(callId, method, argsJson) {
    Promise.resolve()
      .then(() => {
        const fn = METHODS[method];
        if (!fn) throw new Error(`Unknown method: ${method}`);
        return fn(JSON.parse(argsJson || '{}'));
      })
      .then((value) => {
        AndroidHost.settle(callId, true, JSON.stringify({ value }));
      })
      .catch((err) => {
        AndroidHost.settle(callId, false, JSON.stringify({ error: String(err?.message || err) }));
      });
  }
};

// Tells Kotlin the modules finished importing. Until this fires, `HH` may exist
// but the detector tree behind it does not.
AndroidHost.ready();
