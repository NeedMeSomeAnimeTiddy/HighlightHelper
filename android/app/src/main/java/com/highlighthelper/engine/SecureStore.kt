package com.highlighthelper.engine

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * The API keys, and nothing else.
 *
 * The extension keeps it in `chrome.storage.local` — never in sync storage,
 * never in the source. The equivalent promise on a phone is the keystore: the
 * key is encrypted at rest with a hardware-backed master key, so it is not
 * readable from a backup or from another app's view of the filesystem.
 *
 * It also never crosses into the WebView. The engine builds the prompt and
 * Kotlin attaches the credential, which is the reason the AI call is the one
 * request the bridge does not simply hand to the page's own fetch.
 */
/*
 * Jetpack Security is deprecated, and is used here anyway.
 *
 * Google retired androidx.security-crypto without shipping a replacement, so
 * the alternatives are plaintext preferences — not acceptable for a credential
 * — or hand-rolled Keystore AES/GCM, which is the kind of code that fails
 * quietly and asymmetrically: an IV mishandled on write is only discovered on
 * read, on someone else's device. The library still works and still uses the
 * hardware keystore. Replacing it is worth doing deliberately, with a device to
 * test against, rather than as a footnote to wiring up the network.
 */
@Suppress("DEPRECATION")
class SecureStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val master = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "highlight-helper-secrets",
            master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * One key per provider.
     *
     * Kept separately rather than overwritten, because trying OpenAI for an
     * afternoon and going back to DeepSeek should not mean finding the first
     * key again — and a key nobody can find is a key that ends up pasted into a
     * notes app.
     */
    fun keyFor(providerId: String): String =
        prefs.getString(entry(providerId), "").orEmpty().trim().ifEmpty {
            // The pre-registry single key, read as DeepSeek's. Folded in on read
            // rather than migrated once at startup: a migration that throws has
            // no second chance, and this cannot be missed.
            if (providerId == "deepseek") prefs.getString(LEGACY_KEY, "").orEmpty().trim() else ""
        }

    fun setKey(providerId: String, value: String) {
        prefs.edit().apply {
            val trimmed = value.trim()
            if (trimmed.isEmpty()) remove(entry(providerId)) else putString(entry(providerId), trimmed)
            // Once the value has a home under the new name, the old entry goes:
            // one credential should not sit in two places on disk.
            if (providerId == "deepseek") remove(LEGACY_KEY)
        }.apply()
    }

    fun hasKeyFor(providerId: String): Boolean = keyFor(providerId).isNotEmpty()

    private fun entry(providerId: String) = "api_key_$providerId"

    /**
     * OAuth tokens, kept beside the keys because they are the same kind of
     * thing: a bearer credential that spends an account until it expires. How
     * it was obtained changes nothing about how it must be stored.
     *
     * Held as one JSON blob rather than three preferences so a token and its
     * expiry cannot be written apart and read together — a refresh that updated
     * the token but not the deadline would look valid and 401 forever.
     */
    fun tokensFor(providerId: String): Tokens? {
        val raw = prefs.getString(tokenEntry(providerId), null) ?: return null
        return runCatching {
            val row = Json.parseToJsonElement(raw).jsonObject
            Tokens(
                accessToken = row["accessToken"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                refreshToken = row["refreshToken"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                expiresAt = row["expiresAt"]?.jsonPrimitive?.longOrNull ?: 0L
            )
        }.getOrNull()?.takeIf { it.accessToken.isNotEmpty() }
    }

    fun setTokens(providerId: String, tokens: Tokens?) {
        prefs.edit().apply {
            if (tokens == null) {
                remove(tokenEntry(providerId))
            } else {
                putString(tokenEntry(providerId), buildJsonObject {
                    put("accessToken", tokens.accessToken)
                    put("refreshToken", tokens.refreshToken)
                    put("expiresAt", tokens.expiresAt)
                }.toString())
            }
        }.apply()
    }

    private fun tokenEntry(providerId: String) = "oauth_tokens_$providerId"

    /** `expiresAt` is epoch milliseconds; zero means the server stated no expiry. */
    data class Tokens(
        val accessToken: String,
        val refreshToken: String,
        val expiresAt: Long
    )

    private companion object {
        const val LEGACY_KEY = "deepseek_api_key"
    }
}
