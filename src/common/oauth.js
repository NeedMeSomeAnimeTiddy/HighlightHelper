/**
 * OAuth 2.0 authorization code flow with PKCE, as pure functions.
 *
 * The app is a **public client**: it runs on the user's machine, its source is
 * readable, and anything shipped inside it is public. So there is no client
 * secret anywhere in this file, and PKCE is not optional decoration — it is the
 * whole reason an intercepted authorization code cannot be redeemed by someone
 * else.
 *
 * Nothing here performs a request or opens a window. Building a URL and reading
 * a token response are the parts that must be identical on both platforms and
 * are worth testing without a browser; launching the browser and holding the
 * socket are the parts that cannot be. Chrome does the first through
 * `chrome.identity.launchWebAuthFlow`, Android through a Custom Tab and an app
 * link, and both use exactly the strings this file produces.
 *
 * RFC 6749 for the flow, RFC 7636 for PKCE.
 */

/** Bytes as base64url — no padding, no + or /, per RFC 7636. */
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A PKCE pair.
 *
 * 32 bytes of `crypto.getRandomValues`, which lands well inside the 43–128
 * character range the spec requires once base64url'd. `Math.random()` would
 * also produce a string of the right shape and would defeat the entire point:
 * the verifier's only job is to be unguessable by whoever intercepted the code.
 */
export async function pkce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)), method: 'S256' };
}

/** An unguessable value tying the redirect back to the request that started it. */
export function randomState() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Where to send the browser.
 *
 * `prompt=consent` is deliberately absent: re-consenting on every sign-in is
 * noise, and a server that needs it will ask anyway. `offline_access` is not
 * added either — servers differ on whether it is a scope or a parameter, so
 * whether a refresh token comes back is left to the scope the user configured
 * rather than guessed at here.
 */
export function authorizeUrl({ authUrl, clientId, redirectUri, scope, audience, challenge, state }) {
  const url = new URL(authUrl);
  const params = url.searchParams;
  params.set('response_type', 'code');
  params.set('client_id', clientId);
  params.set('redirect_uri', redirectUri);
  params.set('code_challenge', challenge);
  params.set('code_challenge_method', 'S256');
  params.set('state', state);
  if (scope) params.set('scope', scope);
  if (audience) params.set('audience', audience);
  return url.toString();
}

/**
 * The code out of the URL the browser came back to, or the error the server
 * put there instead.
 *
 * The state check happens here rather than at the call site because forgetting
 * it is the classic way to implement this flow wrongly — it is what stops a
 * redirect the app did not initiate from being accepted as a sign-in.
 */
export function readRedirect(redirectUrl, expectedState) {
  let url;
  try {
    url = new URL(redirectUrl);
  } catch {
    return { error: 'The sign-in did not come back with a usable address.' };
  }

  // Some servers answer in the fragment rather than the query. Reading both
  // costs one line and saves an unexplainable failure against one of them.
  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams((url.hash || '').replace(/^#/, ''));
  const get = (name) => params.get(name) || fragment.get(name);

  const error = get('error');
  if (error) {
    return { error: get('error_description') || describeAuthError(error) };
  }

  if (get('state') !== expectedState) {
    return { error: 'The sign-in came back with the wrong state and was ignored.' };
  }

  const code = get('code');
  if (!code) return { error: 'The sign-in came back without an authorization code.' };
  return { code };
}

/** The standard error codes, in words. */
function describeAuthError(code) {
  const table = {
    access_denied: 'Sign-in was declined.',
    invalid_scope: 'The server rejected the requested scope. Check the scope in settings.',
    unauthorized_client: 'That client id is not allowed to use this flow.',
    invalid_request: 'The server rejected the sign-in request as malformed.',
    server_error: 'The sign-in server had an error. Try again.',
    temporarily_unavailable: 'The sign-in server is busy. Try again shortly.'
  };
  return table[code] || `Sign-in failed: ${code}`;
}

/** The form body that trades an authorization code for tokens. */
export function tokenExchangeBody({ clientId, code, verifier, redirectUri }) {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', clientId);
  body.set('code', code);
  body.set('code_verifier', verifier);
  body.set('redirect_uri', redirectUri);
  return body.toString();
}

/** The form body that trades a refresh token for a new access token. */
export function refreshBody({ clientId, refreshToken, scope }) {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', clientId);
  body.set('refresh_token', refreshToken);
  if (scope) body.set('scope', scope);
  return body.toString();
}

/**
 * A token response, turned into what gets stored.
 *
 * `expires_in` is seconds from now and is turned into an absolute moment,
 * because a duration is only meaningful next to the instant it was received and
 * that instant is not stored anywhere else.
 *
 * A refresh response often omits `refresh_token`, meaning "keep using the one
 * you have". Overwriting it with undefined at that point silently converts a
 * durable sign-in into one that dies at the next expiry, which then looks like
 * the server logging the user out at random.
 */
export function readTokens(body, { now = Date.now(), previous = null } = {}) {
  const accessToken = body?.access_token || '';
  if (!accessToken) {
    const detail = body?.error_description || body?.error || '';
    throw new Error(detail ? `The sign-in server refused: ${detail}` : 'No access token was issued.');
  }

  const lifetime = Number(body.expires_in);
  return {
    accessToken,
    refreshToken: body.refresh_token || previous?.refreshToken || '',
    // No expiry stated means no expiry known. Treated as "never expires" rather
    // than "already expired", because a server that omits it generally issues
    // long-lived tokens and the request itself will say so with a 401 if not.
    expiresAt: Number.isFinite(lifetime) ? now + lifetime * 1000 : 0,
    tokenType: body.token_type || 'Bearer'
  };
}

/**
 * Whether a token needs renewing.
 *
 * The skew matters: a token checked as valid one millisecond before it expires
 * is a request that fails after the check passed. A minute's margin turns that
 * race into a refresh.
 */
export function isExpired(tokens, { now = Date.now(), skewMs = 60000 } = {}) {
  if (!tokens?.accessToken) return true;
  if (!tokens.expiresAt) return false;
  return now + skewMs >= tokens.expiresAt;
}

/** What the settings screen shows about the current sign-in. */
export function describeTokens(tokens, { now = Date.now() } = {}) {
  if (!tokens?.accessToken) return 'Not signed in.';
  if (!tokens.expiresAt) return 'Signed in.';

  const left = tokens.expiresAt - now;
  if (left <= 0) {
    return tokens.refreshToken
      ? 'Signed in — the token has expired and will be renewed on the next request.'
      : 'Signed in, but the token has expired and there is no refresh token. Sign in again.';
  }

  const minutes = Math.round(left / 60000);
  if (minutes < 90) return `Signed in — token valid for another ${minutes} min.`;
  return `Signed in — token valid for another ${Math.round(minutes / 60)} h.`;
}
