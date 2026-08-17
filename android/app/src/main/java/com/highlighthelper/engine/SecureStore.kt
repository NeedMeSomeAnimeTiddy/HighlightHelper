package com.highlighthelper.engine

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The DeepSeek API key, and nothing else.
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

    var apiKey: String
        get() = prefs.getString(KEY, "").orEmpty().trim()
        set(value) = prefs.edit().putString(KEY, value.trim()).apply()

    val hasKey: Boolean get() = apiKey.isNotEmpty()

    private companion object {
        const val KEY = "deepseek_api_key"
    }
}
