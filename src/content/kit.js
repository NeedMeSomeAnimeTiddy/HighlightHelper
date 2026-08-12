/**
 * Minimal DOM helpers used by the panel and by every detector's render().
 * Everything here builds plain elements — no framework, no innerHTML with
 * page-derived strings.
 */

/** el('div', { class: 'x', onclick: fn }, child, 'text') */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function btn(label, onClick, { variant = '', title = '', disabled = false } = {}) {
  return el('button', {
    class: `hh-btn ${variant}`.trim(),
    type: 'button',
    title,
    disabled,
    onclick: onClick
  }, label);
}

export function spinner(label = 'Thinking…') {
  return el('div', { class: 'hh-loading' },
    el('span', { class: 'hh-spinner', 'aria-hidden': 'true' }),
    el('span', { text: label })
  );
}

export function note(text, variant = '') {
  return el('p', { class: `hh-note ${variant}`.trim(), text });
}

export function errorBox(message, { onRetry, onSettings } = {}) {
  const box = el('div', { class: 'hh-error' }, el('span', { text: message }));
  const actions = el('div', { class: 'hh-row' });
  if (onRetry) actions.append(btn('Retry', onRetry, { variant: 'hh-ghost' }));
  if (onSettings) actions.append(btn('Settings', onSettings, { variant: 'hh-ghost' }));
  if (actions.childElementCount) box.append(actions);
  return box;
}

/** Swaps a container's contents for `nodes` in one go. */
export function replaceContent(container, ...nodes) {
  container.replaceChildren(...nodes.flat().filter(Boolean));
  return container;
}

/**
 * The standard "here's your text back" block: the result, plus Copy and
 * Replace buttons wired to the page.
 */
export function resultBlock(text, api, { label = '' } = {}) {
  const wrap = el('div', { class: 'hh-result' });
  if (label) wrap.append(el('div', { class: 'hh-label', text: label }));
  wrap.append(el('div', { class: 'hh-text', text }));

  const copyBtn = btn('Copy', async () => {
    const ok = await api.copy(text);
    copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
  });

  const row = el('div', { class: 'hh-row' }, copyBtn);

  const replaceBtn = btn(
    'Replace',
    async () => {
      const ok = await api.replace(text);
      replaceBtn.textContent = ok ? 'Replaced' : "Couldn't replace";
      setTimeout(() => { replaceBtn.textContent = 'Replace'; }, 1400);
    },
    {
      variant: 'hh-primary',
      disabled: !api.canReplace,
      title: api.canReplace
        ? 'Replace the selected text on the page'
        : "The selected text isn't in an editable field"
    }
  );
  row.append(replaceBtn);
  wrap.append(row);
  return wrap;
}

/**
 * Runs an async producer into a container: spinner first, then the result or a
 * friendly error with a retry.
 */
export async function withLoading(container, loadingLabel, producer, onError) {
  replaceContent(container, spinner(loadingLabel));
  try {
    const node = await producer();
    replaceContent(container, node);
  } catch (err) {
    replaceContent(container, onError(err));
  }
}
