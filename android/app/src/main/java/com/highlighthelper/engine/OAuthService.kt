package com.highlighthelper.engine

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * OAuth 2.0 authorization code + PKCE, the Android half.
 *
 * `src/common/oauth.js` is the browser's copy of the same flow, and the two are
 * deliberately the same shape: a public client, no secret, S256 challenge,
 * state checked on the way back. The strings differ in one place only — the
 * redirect URI, which on Chrome is a chromiumapp.org URL and here is an app
 * link this package registers.
 *
 * The sign-in happens in a **Custom Tab**, not in a WebView this app controls.
 * That is the whole point: the user types their password into the identity
 * provider's own page, in the browser's own process, where this app cannot read
 * the field, script the page, or see anything but the final redirect. A WebView
 * login screen would look identical to the user and would be indefensible.
 */
class OAuthService(private val context: Context, private val secrets: SecureStore) {

    private val http = OkHttpClient.Builder()
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    /** Where the sign-in comes back to. Must be registered with the server. */
    val redirectUri: String get() = REDIRECT_URI

    /**
     * One sign-in, start to finish.
     *
     * Suspends until the browser comes back through [OAuthRedirectActivity], or
     * until the user gives up — five minutes is long enough for a password
     * manager, a second factor and a moment of confusion, and short enough that
     * an abandoned attempt does not leave a pending state forever.
     */
    suspend fun signIn(providerId: String, config: Config): SecureStore.Tokens {
        val verifier = randomUrlSafe(32)
        val challenge = challengeFor(verifier)
        val state = randomUrlSafe(16)

        val url = Uri.parse(config.authUrl).buildUpon().apply {
            appendQueryParameter("response_type", "code")
            appendQueryParameter("client_id", config.clientId)
            appendQueryParameter("redirect_uri", REDIRECT_URI)
            appendQueryParameter("code_challenge", challenge)
            appendQueryParameter("code_challenge_method", "S256")
            appendQueryParameter("state", state)
            if (config.scope.isNotEmpty()) appendQueryParameter("scope", config.scope)
            if (config.audience.isNotEmpty()) appendQueryParameter("audience", config.audience)
        }.build()

        val waiting = CompletableDeferred<Uri>()
        pending = waiting

        withContext(Dispatchers.Main) {
            val tab = CustomTabsIntent.Builder().setShowTitle(true).build()
            tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { tab.launchUrl(context, url) }.onFailure {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }

        val redirect = try {
            withTimeout(SIGN_IN_TIMEOUT_MS) { waiting.await() }
        } catch (err: TimeoutCancellationException) {
            throw EngineException("Sign-in was not completed.")
        } finally {
            pending = null
        }

        val error = redirect.getQueryParameter("error")
        if (error != null) {
            throw EngineException(
                redirect.getQueryParameter("error_description") ?: "Sign-in failed: $error"
            )
        }
        // Checked before the code is used, not after: this is what stops a
        // redirect the app never initiated from being accepted as a sign-in.
        if (redirect.getQueryParameter("state") != state) {
            throw EngineException("The sign-in came back with the wrong state and was ignored.")
        }
        val code = redirect.getQueryParameter("code")
            ?: throw EngineException("The sign-in came back without an authorization code.")

        val tokens = exchange(
            config,
            FormBody.Builder()
                .add("grant_type", "authorization_code")
                .add("client_id", config.clientId)
                .add("code", code)
                .add("code_verifier", verifier)
                .add("redirect_uri", REDIRECT_URI)
                .build(),
            previous = null
        )
        secrets.setTokens(providerId, tokens)
        return tokens
    }

    fun signOut(providerId: String) = secrets.setTokens(providerId, null)

    /**
     * A usable access token, renewed if it has gone stale.
     *
     * A refresh that fails clears the stored tokens rather than leaving a dead
     * credential to fail on every later request — a revoked grant should surface
     * as "sign in again", once.
     */
    suspend fun accessToken(providerId: String, config: Config): String {
        val stored = secrets.tokensFor(providerId) ?: throw EngineException(NOT_SIGNED_IN)

        // A minute's margin, because a token checked as valid one millisecond
        // before expiry is a request that fails just after the check passed.
        val stale = stored.expiresAt != 0L &&
            System.currentTimeMillis() + SKEW_MS >= stored.expiresAt
        if (!stale) return stored.accessToken

        if (stored.refreshToken.isEmpty()) {
            secrets.setTokens(providerId, null)
            throw EngineException(NOT_SIGNED_IN)
        }

        val refreshed = try {
            exchange(
                config,
                FormBody.Builder()
                    .add("grant_type", "refresh_token")
                    .add("client_id", config.clientId)
                    .add("refresh_token", stored.refreshToken)
                    .apply { if (config.scope.isNotEmpty()) add("scope", config.scope) }
                    .build(),
                previous = stored
            )
        } catch (err: Throwable) {
            secrets.setTokens(providerId, null)
            throw EngineException(NOT_SIGNED_IN)
        }

        secrets.setTokens(providerId, refreshed)
        return refreshed.accessToken
    }

    /** What the settings screen shows about the current sign-in. */
    fun describe(providerId: String): String {
        val tokens = secrets.tokensFor(providerId) ?: return "Not signed in."
        if (tokens.expiresAt == 0L) return "Signed in."

        val left = tokens.expiresAt - System.currentTimeMillis()
        if (left <= 0) {
            return if (tokens.refreshToken.isNotEmpty()) {
                "Signed in — the token has expired and will be renewed on the next request."
            } else {
                "Signed in, but the token has expired and there is no refresh token. Sign in again."
            }
        }
        val minutes = (left / 60000).toInt()
        return if (minutes < 90) "Signed in — token valid for another $minutes min."
        else "Signed in — token valid for another ${minutes / 60} h."
    }

    private suspend fun exchange(
        config: Config,
        body: FormBody,
        previous: SecureStore.Tokens?
    ): SecureStore.Tokens = withContext(Dispatchers.IO) {
        val call = Request.Builder()
            .url(config.tokenUrl)
            .addHeader("Accept", "application/json")
            .post(body)
            .build()

        http.newCall(call).execute().use { response ->
            val text = response.body.string()
            val payload = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()

            if (!response.isSuccessful) {
                val detail = payload?.str("error_description") ?: payload?.str("error")
                throw EngineException("The sign-in server refused: ${detail ?: "HTTP ${response.code}"}")
            }

            val access = payload?.str("access_token").orEmpty()
            if (access.isEmpty()) throw EngineException("No access token was issued.")

            val lifetime = payload?.get("expires_in")?.jsonPrimitive?.doubleOrNull
            SecureStore.Tokens(
                accessToken = access,
                // A refresh response usually omits this, meaning "keep the one
                // you have". Overwriting it with empty would quietly turn a
                // durable sign-in into one that dies at the next expiry.
                refreshToken = payload?.str("refresh_token")
                    ?: previous?.refreshToken.orEmpty(),
                expiresAt = if (lifetime != null) {
                    System.currentTimeMillis() + (lifetime * 1000).toLong()
                } else 0L
            )
        }
    }

    private fun randomUrlSafe(bytes: Int): String {
        val buffer = ByteArray(bytes)
        SecureRandom().nextBytes(buffer)
        return android.util.Base64.encodeToString(
            buffer,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or
                android.util.Base64.NO_WRAP
        )
    }

    private fun challengeFor(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray())
        return android.util.Base64.encodeToString(
            digest,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or
                android.util.Base64.NO_WRAP
        )
    }

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull

    /** The public half of a sign-in: a client id and some URLs. No secret. */
    data class Config(
        val clientId: String,
        val authUrl: String,
        val tokenUrl: String,
        val scope: String = "",
        val audience: String = ""
    ) {
        val ready: Boolean
            get() = clientId.isNotEmpty() && authUrl.isNotEmpty() && tokenUrl.isNotEmpty()

        val missing: List<String>
            get() = buildList {
                if (clientId.isEmpty()) add("client id")
                if (authUrl.isEmpty()) add("authorization URL")
                if (tokenUrl.isEmpty()) add("token URL")
            }

        companion object {
            /** Reads the config out of whatever the engine sent with a request. */
            fun from(row: JsonObject?): Config = Config(
                clientId = row?.get("clientId")?.jsonPrimitive?.contentOrNull.orEmpty(),
                authUrl = row?.get("authUrl")?.jsonPrimitive?.contentOrNull.orEmpty(),
                tokenUrl = row?.get("tokenUrl")?.jsonPrimitive?.contentOrNull.orEmpty(),
                scope = row?.get("scope")?.jsonPrimitive?.contentOrNull.orEmpty(),
                audience = row?.get("audience")?.jsonPrimitive?.contentOrNull.orEmpty()
            )
        }
    }

    companion object {
        /**
         * The app link the browser returns to. Registered in the manifest
         * against [OAuthRedirectActivity] and must be added to the allowed
         * redirect URIs on the server.
         */
        const val REDIRECT_URI = "com.highlighthelper://oauth"

        const val NOT_SIGNED_IN =
            "This service signs in rather than using a key, and this device is not signed " +
                "in — or the session was revoked. Sign in again in settings."

        private const val SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000L
        private const val SKEW_MS = 60_000L

        /**
         * The in-flight sign-in, waiting for the browser to come back.
         *
         * Static because the redirect arrives as a *new Activity*, not as a
         * result delivered to the one that started the flow — the browser is a
         * separate app and the trip back through an app link has no handle on
         * whatever was waiting. At most one sign-in can be in flight, which is
         * true by construction: it takes a button press and the screen is gone
         * while the Custom Tab is up.
         */
        @Volatile
        private var pending: CompletableDeferred<Uri>? = null

        /** Called by [OAuthRedirectActivity]. Returns false if nothing was waiting. */
        fun deliver(redirect: Uri): Boolean = pending?.complete(redirect) ?: false
    }
}
