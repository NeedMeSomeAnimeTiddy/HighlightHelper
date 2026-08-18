# Signing in instead of pasting a key

Most services in the **Which service** list authenticate with an API key. One
does not: **Sign in instead (OAuth 2.0)** points at an OpenAI-compatible
endpoint that sits behind an identity provider, and gets its credential by
signing you in rather than by being given a key.

This is for endpoints protected by a login: a company gateway behind Entra ID or
Okta, an Azure OpenAI deployment, a LiteLLM or vLLM proxy with OIDC in front of
it, anything where "who are you" is answered by an authorization server rather
than by a static string.

## What it is not

**This is not "Sign in with ChatGPT", and it cannot be made into it.**

There is no OAuth client this app can register that would let it obtain OpenAI
API credentials on your behalf:

- OpenAI's platform API has no `/oauth/authorize`. No supported flow mints a
  credential billed to a user's OpenAI account for an outside app.
- "Sign in with ChatGPT" as it exists ships inside OpenAI's own tooling — the
  ChatGPT desktop app, Codex CLI, the IDE extensions. Those are first-party
  clients holding first-party client IDs.
- The OAuth documented for [plugins and GPT
  Actions](https://developers.openai.com/plugins/build/auth) runs the *other
  direction*: ChatGPT is the client authenticating into *your* service, and you
  operate the authorization server. It grants nothing to an app like this one.

So the flow in this document will never point at ChatGPT. Two things could,
and the difference between them is the whole point:

**Not this:** hardcoding the Codex CLI's client ID and running the flow as if
this app were Codex. That is impersonating a first-party client, it breaches
OpenAI's terms, and because this app is distributed it would risk *other
people's* ChatGPT accounts. Deliberately not implemented, and not a decision
that is up for revisiting.

**But legitimately this:** driving the real Codex CLI, which is signed by
OpenAI, installed by the user, and logged in through OpenAI's own flow. The app
never sees a client ID or a token; it asks Codex to start a login, opens the URL
Codex returns, and Codex keeps the credentials in its own home directory. The
[Fovea](https://github.com/) desktop app does exactly this over Codex's
`app-server` JSON-RPC protocol.

That route is open to this project too, with real constraints: a browser
extension cannot spawn a process, so it needs a **native messaging host**; and
Codex is a desktop binary with no Android build, so the phone can only reach one
running on a computer. See ROADMAP.md.

## What you need

From whoever runs the authorization server:

| Field | What it is |
| --- | --- |
| **Client ID** | The identifier issued to *this app* by that server. Public — it is not a secret and is visible in the sign-in URL |
| **Authorization URL** | Where the browser is sent to log in, e.g. `https://login.example.com/oauth/authorize` |
| **Token URL** | Where the authorization code is exchanged, e.g. `https://login.example.com/oauth/token` |
| **Scope** | Whatever the API needs. Include `offline_access` (or your server's equivalent) or you will be signed out when the access token expires |
| **Audience** | Optional. Auth0 and servers copying it will otherwise issue a token the API rejects |

Plus the **endpoint** itself, in the Model/Endpoint fields — the full
chat-completions URL the gateway serves.

### The redirect URI

The settings screen shows it; it must be on the server's allow-list.

- **Extension:** `https://<extension-id>.chromiumapp.org/` — Chrome intercepts
  this and never loads it. The extension ID differs per installation for an
  unpacked extension, so copy it from the settings page rather than guessing.
- **Android:** `com.highlighthelper://oauth`, registered by the app's manifest.

## There is no client secret

The app is a **public client** in the OAuth sense: it runs on your machine and
its source is readable. A client secret shipped inside it would be visible to
anyone who unzipped it, so there isn't one — the flow uses **PKCE** (RFC 7636)
instead, which is what makes an intercepted authorization code useless to
whoever intercepted it.

If your server refuses to register a client without a secret, ask for a *public*
/ *native* / *SPA* client type. A server that only supports confidential clients
cannot safely be used from an app like this one, and the honest answer is to put
an API key in front of the gateway instead.

## Where the flow runs, and what sees your password

Nothing in this app ever sees your password.

- **Extension:** `chrome.identity.launchWebAuthFlow` opens a browser window on
  the identity provider's own origin. The extension has no script access to that
  page and receives only the final redirect.
- **Android:** a **Custom Tab** — the browser's own process, not a WebView this
  app controls. A WebView login screen would look identical to you and would be
  indefensible, which is why it is not used.

## Where the tokens live

Exactly where the API keys live, because they are the same kind of thing — a
bearer credential that spends an account until it expires.

- **Extension:** `chrome.storage.local`. Never `sync`, so it never reaches your
  Google account. Only the background service worker reads it; content scripts
  ask the worker to make calls and never see a credential.
- **Android:** `EncryptedSharedPreferences`, hardware-backed. It never crosses
  into the WebView — the engine says *which* service to call and Kotlin attaches
  the credential.

Access tokens are refreshed automatically when they expire. A refresh that fails
clears the stored tokens rather than leaving a dead credential to fail on every
later request, so a revoked grant surfaces once, as "sign in again".

**Sign out** drops the tokens on this device. It does not end the session at the
provider — that is theirs to end, and this app will not pretend otherwise.

## When it goes wrong

| What you see | Usually means |
| --- | --- |
| *The sign-in came back with the wrong state* | A redirect this app did not start. Ignored on purpose; just sign in again |
| *The sign-in server refused: invalid_client* | The client ID is wrong, or the server expects a secret — see above |
| *…: redirect_uri_mismatch* | The redirect URI is not on the allow-list, character for character |
| *No access token was issued* | The server returned a response with no `access_token`, often because the scope or audience is wrong |
| Signed in, then signed out at the first expiry | No refresh token. Add `offline_access` to the scope |
| Rows hang or 401 after signing in | The token is fine but the *endpoint* is wrong, or its origin was never granted permission. Re-check the endpoint field |

## The code

| | |
| --- | --- |
| [`src/common/oauth.js`](src/common/oauth.js) | The flow as pure functions — PKCE, the authorize URL, reading the redirect, reading a token response. Shared, and tested in `test/detectors.test.js` without a browser |
| [`src/background/signin.js`](src/background/signin.js) | The extension half: the identity API, the exchange, the stored tokens |
| [`OAuthService.kt`](android/app/src/main/java/com/highlighthelper/engine/OAuthService.kt) | The Android half: Custom Tab, app link, OkHttp exchange |
| [`OAuthRedirectActivity.kt`](android/app/src/main/java/com/highlighthelper/OAuthRedirectActivity.kt) | Where the browser lands on the way back |
