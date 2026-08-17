/**
 * Rewriter + spell/grammar fixer for longer selections.
 *
 * "Rewrite" drills into a tone submenu rather than a flyout — a flyout near a
 * screen edge has to flip sides and is awkward on touch, and the extra depth
 * costs one keystroke.
 *
 * Results arrive with the original above them, so a grammar fix can be checked
 * against what it replaced.
 */

import { provenance } from '../kit.js';
import { AI } from '../../common/constants.js';
import { wordCount, looksLikeLanguage, plural } from '../../common/text.js';
import { isCode } from './codelang.js';

const MAX_LEN = 6000;

export const TONES = [
  { action: AI.FIX, icon: 'fix', label: 'Fix spelling & grammar', busy: 'Proofreading…' },
  { action: AI.SHORTER, icon: 'shorter', label: 'Make it shorter', busy: 'Trimming…' },
  { action: AI.FORMAL, icon: 'formal', label: 'More formal', busy: 'Formalising…' },
  { action: AI.CASUAL, icon: 'casual', label: 'More casual', busy: 'Loosening up…' },
  // Continue appends instead of replacing, so its result view differs — see
  // continueBlocks. Copy and Replace act on selection + continuation together,
  // because replacing your paragraph with only its ending would be wrong.
  { action: AI.CONTINUE, icon: 'continue', label: 'Continue writing', busy: 'Writing on…', appends: true }
];

const MIN_WORDS = 5;

/** Long enough to be worth rewriting, or clearly a full sentence. */
function looksLikeProse(text, settings) {
  const t = text.trim();
  // A 76-character JWT clears the character threshold but is not prose.
  if (wordCount(t) < MIN_WORDS) return false;
  if (!looksLikeLanguage(t)) return false;
  // "Fix spelling & grammar" on a function body is actively destructive.
  if (isCode(t)) return false;
  if (t.length >= settings.minRewriteChars) return true;
  return wordCount(t) >= 6 && /[.!?]/.test(t);
}

export default {
  id: 'rewrite',
  title: 'Rewrite',
  priority: 50,

  matches(text, settings) {
    const t = text.trim();
    if (!t || t.length > MAX_LEN) return null;
    if (!looksLikeProse(t, settings)) return null;
    return { words: wordCount(t), chars: t.length };
  },

  rows({ text, match }) {
    return [{
      key: 'rewrite',
      icon: 'rewrite',
      label: 'Rewrite',
      value: plural(match.words, 'word'),
      detailTitle: 'Rewrite',
      // The single row drills into the tones. The nested keys are load-bearing
      // beyond this file — a right-click on "Rewrite → More formal" asks the
      // panel for `rewrite:formal` by name, and common/tools.js lists them all.
      detail: { kind: 'menu', rows: toneRows(text) }
    }];
  }
};

function toneRows(text) {
  return TONES.map((tone) => ({
    key: `rewrite:${tone.action}`,
    icon: tone.icon,
    label: tone.label,
    detailTitle: tone.label,
    detail: {
      // A rewrite is long enough that waiting for the whole answer is a visible
      // pause, so the tokens land as they are written.
      kind: 'stream',
      loading: tone.busy,
      run: (api, emit) => api.ai(tone.action, text, {}, emit),
      done: (res) => (tone.appends ? continueBlocks(text, res) : rewriteBlocks(text, tone, res))
    }
  }));
}

/** The original above the result, so a grammar fix can be checked against it. */
function rewriteBlocks(text, tone, res) {
  return [
    { type: 'label', text: `Was${provenance(res)}` },
    { type: 'quote', text },
    { type: 'label', text: tone.label },
    { type: 'text', text: res.text, rich: true },
    { type: 'actions', text: res.text }
  ];
}

/**
 * The whole passage, with the original dimmed and the new text in normal
 * weight, so it is obvious what was added. Copy and Replace take both.
 *
 * `dim` on a text block is exactly this two-tone rendering, so the appended
 * case needs no browser-shaped escape hatch of its own.
 */
function continueBlocks(original, res) {
  const joined = /\s$/.test(original) ? original + res.text : `${original} ${res.text}`;
  return [
    { type: 'label', text: `Continued${provenance(res)}` },
    { type: 'text', dim: original.trimEnd(), text: res.text },
    { type: 'actions', text: joined }
  ];
}
