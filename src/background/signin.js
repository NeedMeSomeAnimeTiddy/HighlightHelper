/**
 * The browser half of the OAuth flow.
 *
 * `src/common/oauth.js` builds the strings; this opens the window, holds the
 * exchange, and keeps the tokens. It lives in the background worker for the
 * same reason the API keys do: a content script must never be able to read a
 * bearer credential, and the options page only ever asks for the flow to be
 * *run*, never for the token that came out of it.
 *
 * Chrome's `chrome.identity.launchWebAuthFlow` does the part an extension
 * cannot do for itself — open a real browser window on the identity provider's
 * own origin, let the user type a password into a page this extension has no
 * script access to, and hand back only the final redirect. The password never
 * touches this code, which is the entire argument for signing in rather than
 * asking for credentials directly.
 */

import { getTokens, setTokens } from '../common/settings.js';
import {
  authorizeUrl,
  isExpired,
  pkce,
  randomState,
  readRedirect,
  readTokens,
  refreshBody,
  tokenExchangeBody
} from '../common/oauth.js';

/**
 * The address the identity provider must be told to send the user back to.
 *
 * `https://<extension-id>.chromiumapp.org/` — a URL Chrome intercepts and never
 * actually loads. It has to be registered with the authorization server, and it
 * differs per install for an unpacked extension, which is why the options page
 * shows it for copying rather than leaving it to be guessed.
 */
export function redirectUri() {
  return chrome.identity.getRedirectURL();
}

/**
 * One sign-in, start to finish.
 *
 * `interactive: true` is what makes a window appear. There is no silent variant
 * offered anywhere in this file: a token obtained without the user watching is
 * a token they did not knowingly grant, and every path here starts from a
 * button they pressed.
 */
export async function signIn(providerId, config) {
  const { verifier, challenge } = await pkce();
  const state = randomState();

  const url = authorizeUrl({
    authUrl: config.authUrl,
    clientId: config.clientId,
    redirectUri: redirectUri(),
    scope: config.scope,
    audience: config.audience,
    challenge,
    state
  });

  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (err) {
    // Closing the window is the ordinary way to change your mind, and it
    // arrives here as an error. Reporting it as a failure would be wrong.
    const message = String(err?.message || err);
    throw new Error(
      /closed|cancel/i.test(message) ? 'Sign-in was cancelled.' : `Sign-in failed: ${message}`
    );
  }

  const { code, error } = readRedirect(redirect || '', state);
  if (error) throw new Error(error);

  const tokens = await exchange(config, tokenExchangeBody({
    clientId: config.clientId,
    code,
    verifier,
    redirectUri: redirectUri()
  }));

  await setTokens(providerId, tokens);
  return tokens;
}

/** Drops the tokens. The session at the provider is theirs to end, not ours. */
export async function signOut(providerId) {
  await setTokens(providerId, null);
}

/**
 * A usable access token, refreshed if it has gone stale.
 *
 * Callers get a token or an error; they never get an expired one. A refresh
 * that fails clears the stored tokens rather than leaving a dead credential in
 * place to fail again on every subsequent request — a revoked grant should
 * surface as "sign in again", once.
 */
export async function accessToken(providerId, config) {
  const stored = await getTokens(providerId);
  if (!stored?.accessToken) throw new Error('NOT_SIGNED_IN');
  if (!isExpired(stored)) return stored.accessToken;

  if (!stored.refreshToken) {
    await setTokens(providerId, null);
    throw new Error('NOT_SIGNED_IN');
  }

  let refreshed;
  try {
    refreshed = await exchange(
      config,
      refreshBody({
        clientId: config.clientId,
        refreshToken: stored.refreshToken,
        scope: config.scope
      }),
      stored
    );
  } catch {
    await setTokens(providerId, null);
    throw new Error('NOT_SIGNED_IN');
  }

  await setTokens(providerId, refreshed);
  return refreshed.accessToken;
}

/** POSTs a form body to the token endpoint and reads what comes back. */
async function exchange(config, body, previous = null) {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw new Error(`The sign-in server refused: ${detail}`);
  }
  return readTokens(payload, { previous });
}
