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

import { provenance } from '../kit.js';
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

  rows({ text, match, settings }) {
    const toolRows = match.tools.map((tool) => ({
      key: keyFor(tool.id),
      icon: 'custom',
      label: tool.name,
      detailTitle: tool.name,
      detail: runDetail(text, tool, settings.language)
    }));

    // One tool is a row; several are a drill-in. A user with six of them should
    // not have six rows above every detector that recognised something. The
    // drill-in keeps the `custom:<id>` keys underneath it, which is what a
    // right-click entry for one particular tool resolves against.
    if (toolRows.length === 1) return toolRows;

    return [{
      key: 'custom',
      icon: 'custom',
      label: 'My tools',
      value: String(toolRows.length),
      detailTitle: 'My tools',
      detail: { kind: 'menu', rows: toolRows }
    }];
  }
};

function runDetail(text, tool, language) {
  /*
   * `{title}` and `{url}` come from the page, and `rows` is handed no api to
   * read them from — deliberately, since it must return data a non-browser can
   * consume. `run` and `done` both receive one, so the template is filled at
   * the moment the tool is actually invoked instead of when the row is built.
   */
  const systemPromptFor = (api) => fillTemplate(tool.prompt, {
    title: api?.context?.title || '',
    url: api?.context?.url || '',
    language
  });

  return {
    kind: 'stream',
    loading: `${tool.name}…`,
    run: (api, emit) => api.ai(AI.CUSTOM, text, { systemPrompt: systemPromptFor(api) }, emit),
    /*
     * `done` is handed the api for the same reason `run` is: the tool's own
     * prompt is the system turn the thread continues from, and filling the
     * template needs the page the answer was asked about.
     */
    done: (res, api) => [
      { type: 'label', text: `${tool.name}${provenance(res)}` },
      { type: 'text', text: res.text, rich: true },
      { type: 'actions', text: res.text },
      { type: 'conversation', system: systemPromptFor(api), source: text, answer: res.text }
    ]
  };
}
