/**
 * Tools the user wrote.
 *
 * PopClip's real model is not its 250 extensions, it is that anyone can write
 * the 251st. Twenty-one built-in tools will always be missing the one somebody
 * needs — "turn this into a Jira ticket", "explain this to a six-year-old",
 * "convert this to TypeScript" — and this is the answer to all of them at once.
 *
 * A tool is a name and a prompt. `{title}`, `{url}` and `{lang}` are filled in
 * from the page; `{text}` deliberately is not — see fillTemplate in
 * common/prompts.js for why the selection stays in its own turn.
 */

import { el, streamView, actionRow, provenance, followUp, menu, textBlock } from '../kit.js';
import { AI } from '../../common/constants.js';
import { fillTemplate } from '../../common/prompts.js';
import { looksLikeLanguage } from '../../common/text.js';

const MIN_CHARS = 2;
const MAX_LEN = 8000;

/** Stable id -> menu key, so a right-click entry can reach one directly. */
export const keyFor = (id) => `custom:${id}`;

export default {
  id: 'custom',
  title: 'My tools',
  // Above the catch-alls: someone who wrote a tool wants to see it.
  priority: 55,

  matches(text, settings) {
    const tools = (settings.customTools || []).filter((t) => t?.name && t?.prompt);
    if (!tools.length) return null;

    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_LEN) return null;
    // The same 0.45 every other shape-matched tool uses. A looser gate here let
    // "#3f8ae0" through by a single character, which is exactly the noise the
    // catch-all rule exists to prevent.
    if (!looksLikeLanguage(t, { minLetterRatio: 0.45 })) return null;

    return { tools };
  },

  items({ text, match, settings, api }) {
    const context = {
      title: api?.context?.title || '',
      url: api?.context?.url || '',
      language: settings.language
    };

    const rows = match.tools.map((tool) => ({
      key: keyFor(tool.id),
      icon: 'custom',
      label: tool.name,
      detailTitle: tool.name,
      open: (ctx) => runView(text, tool, context, ctx)
    }));

    // One tool is a row; several are a drill-in. A user with six of them should
    // not have six rows above every detector that recognised something.
    if (rows.length === 1) return rows;

    return [{
      key: 'custom',
      icon: 'custom',
      label: 'My tools',
      value: String(rows.length),
      detailTitle: 'My tools',
      open: (ctx) => menu(rows, ctx)
    }];
  }
};

function runView(text, tool, context, api) {
  const systemPrompt = fillTemplate(tool.prompt, context);

  return streamView(
    `${tool.name}…`,
    (emit) => api.ai(AI.CUSTOM, text, { systemPrompt }, emit),
    (res) => {
      const view = el('div', {},
        el('div', { class: 'hh-label', text: `${tool.name}${provenance(res)}` }),
        textBlock(res.text),
        actionRow(res.text, api)
      );
      followUp({ system: systemPrompt, source: text, answer: res.text }, api, view);
      return view;
    },
    (err, retry) => api.errorFor(err, retry)
  );
}
