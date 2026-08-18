/**
 * The last few answers, so you can find one again.
 *
 * Google Dictionary's lookup history and Liner's library are both quietly
 * load-bearing features: the thing you want is often the thing you already
 * asked about, on a tab you have since closed.
 *
 * Deliberately small and deliberately local. This is a record of what the user
 * highlighted while browsing, which is about as personal as anything this
 * extension touches — so it is capped, it never syncs, it is one button to
 * clear, and it can be switched off in settings. It is not a feature worth
 * having at the price of a permanent transcript nobody asked for.
 */

const KEY = 'hh:history';
const MAX_ENTRIES = 60;
/** Long selections are stored truncated: the point is recognition, not archive. */
const MAX_SOURCE_CHARS = 300;
const MAX_RESULT_CHARS = 2000;

/**
 * Clips to `max`, and says so.
 *
 * A record that ends mid-sentence with nothing marking it looks like the model
 * stopped there. One character spent on an ellipsis is the difference between
 * "this was shortened" and "this is what you got".
 */
function clip(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export async function readHistory() {
  try {
    const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Records one answer, newest first.
 *
 * The same action over the same text replaces its earlier entry rather than
 * stacking — re-running a tool on the same selection is the commonest thing
 * there is, and a history that was ninety percent one repeated lookup would be
 * useless.
 *
 * `label` is for the case the action id cannot describe: every tool someone
 * writes reports the same action, so without it a history of five custom tools
 * is five identical-looking rows. It also takes part in the de-duplication,
 * because two different tools run over the same sentence are two different
 * answers however alike their action ids are.
 */
export async function remember(entry) {
  const source = String(entry?.source || '').trim();
  const text = String(entry?.text || '').trim();
  if (!source || !text) return;

  const label = String(entry?.label || '').trim();

  const record = {
    action: entry.action || '',
    ...(label ? { label } : {}),
    source: clip(source, MAX_SOURCE_CHARS),
    text: clip(text, MAX_RESULT_CHARS),
    at: Date.now()
  };

  const list = (await readHistory()).filter(
    (h) => !(h.action === record.action
      && (h.label || '') === label
      && h.source === record.source)
  );

  list.unshift(record);
  await chrome.storage.local.set({ [KEY]: list.slice(0, MAX_ENTRIES) });
}

export async function clearHistory() {
  const count = (await readHistory()).length;
  await chrome.storage.local.set({ [KEY]: [] });
  return count;
}
