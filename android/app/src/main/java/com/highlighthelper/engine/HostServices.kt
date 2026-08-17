package com.highlighthelper.engine

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.getSystemService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Everything the detectors ask for that is not computation.
 *
 * In Chrome these messages are answered by the background service worker; here
 * they are answered by Kotlin. The protocol is identical, which is the reason
 * the detector files needed no changes to run on Android — `currency.js` asks
 * for `hh:rates` and has no opinion about who replies.
 *
 * Network deliberately lives on this side rather than in the WebView. Not only
 * because a page has no `host_permissions` escape from CORS, but because the
 * DeepSeek key belongs in the Android keystore and should never enter the JS
 * heap at all.
 */
class HostServices(
    private val context: Context,
    val scope: CoroutineScope,
    private val rates: RatesService,
    private val deepSeek: DeepSeekService,
    private val http: HttpService,
    /** Set when the selection came from an editable field — see ProcessTextActivity. */
    private val onReplace: (String) -> Boolean
) {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * The answer so far, for whichever streamed view is running.
     *
     * Kotlin is the side holding the HTTP connection, so it already has the
     * tokens; the sheet observes this instead of waiting for the finished
     * result. Null means nothing is streaming.
     */
    private val _streaming = MutableStateFlow<String?>(null)
    val streaming: StateFlow<String?> = _streaming.asStateFlow()

    fun clearStream() { _streaming.value = null }

    suspend fun handle(message: JsonObject): JsonObject {
        return when (val type = message["type"]?.jsonPrimitive?.contentOrNull) {
            "hh:rates" -> {
                val base = message["base"]?.jsonPrimitive?.contentOrNull ?: "USD"
                rates.fetch(base)
            }

            "copy" -> {
                val text = message["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
                withContext(Dispatchers.Main) { copy(text) }
                ok()
            }

            "replace" -> {
                val text = message["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val done = withContext(Dispatchers.Main) { onReplace(text) }
                buildJsonObject { put("ok", done) }
            }

            "open" -> {
                val url = message["url"]?.jsonPrimitive?.contentOrNull.orEmpty()
                withContext(Dispatchers.Main) { open(url) }
                ok()
            }

            /*
             * The encyclopedia and dictionary lookups, on behalf of the
             * engine's `fetch` shim. Keyless public APIs, so nothing is
             * attached — but they still come through here rather than going
             * out from the WebView, so there is one place where this app
             * talks to the network.
             */
            "http" -> http.get(message["url"]?.jsonPrimitive?.contentOrNull.orEmpty())

            "ai", "chat" -> {
                val streaming = message["stream"]?.jsonPrimitive?.booleanOrNull == true
                try {
                    // Passing a non-null callback is what selects the streaming
                    // request, so it has to actually be null when it is not
                    // wanted — a lambda that checks a flag would still stream.
                    if (streaming) _streaming.value = ""
                    val onChunk: ((String) -> Unit)? =
                        if (streaming) ({ soFar -> _streaming.value = soFar }) else null

                    deepSeek.complete(message, onChunk)
                        .also { if (streaming) _streaming.value = null }
                } catch (err: Throwable) {
                    _streaming.value = null
                    throw err
                }
            }

            else -> throw EngineException("Unknown message: $type")
        }
    }

    private fun ok() = buildJsonObject { put("ok", true) }

    private fun copy(text: String) {
        val clipboard = context.getSystemService<ClipboardManager>() ?: return
        clipboard.setPrimaryClip(ClipData.newPlainText("Highlight Helper", text))
    }

    /**
     * A Custom Tab rather than a bare ACTION_VIEW: it keeps the user in the app
     * they were reading, which for a "look this up" affordance is the whole
     * point. Falls back when no browser supports one.
     */
    private fun open(url: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
        val intent = CustomTabsIntent.Builder().setShowTitle(true).build()
        intent.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { intent.launchUrl(context, uri) }.onFailure {
            runCatching {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }
    }
}
