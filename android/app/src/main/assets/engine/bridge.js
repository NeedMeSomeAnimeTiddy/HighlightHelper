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

import { detect, getDetector } from './src/content/detectors/index.js';
import { DEFAULTS } from './src/common/settings.js';

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

/** The api object a task or a view sees. Deliberately a subset of the panel's. */
function apiFor(s) {
  return {
    settings: s.settings,
    context: { title: '', host: '', url: s.url || '' },
    canReplace: s.canReplace,
    send: hostRequest,
    ai: (action, text, options = {}, onChunk = null) =>
      hostRequest({ type: 'ai', action, text, options, stream: Boolean(onChunk) }),
    chat: (messages) => hostRequest({ type: 'chat', messages }),
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
      views: new Map(), actionSeq: 0
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

  /** Running an async view's body, once its spinner is on screen. */
  runView({ session: id, view }) {
    const s = session(id);
    const spec = s.views.get(view);
    if (!spec) throw new Error('That view is no longer open');
    return Promise.resolve(spec.run(apiFor(s)))
      .then((blocks) => (blocks || []).map((b) => describeBlock(s, b)).filter(Boolean));
  },

  /** A button inside a rendered view. */
  runAction({ session: id, action }) {
    const s = session(id);
    const fn = s.actions.get(action);
    if (!fn) throw new Error('That button is no longer live');
    return Promise.resolve(fn(apiFor(s))).then(() => true);
  },

  /** Lets Kotlin ask what a detector is called without hard-coding the list. */
  detectorTitle({ id }) {
    return getDetector(id)?.title || id;
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
