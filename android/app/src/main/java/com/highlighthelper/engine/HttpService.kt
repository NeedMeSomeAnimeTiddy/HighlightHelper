package com.highlighthelper.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * A plain GET, for the engine's `fetch` shim.
 *
 * The encyclopedia and dictionary modules are the extension's own, running
 * unchanged inside the WebView, and they call `fetch`. They cannot be allowed
 * the page's fetch — this WebView is not permitted to reach the network, and a
 * cross-origin request from an asset origin would depend on whatever CORS
 * headers each API happens to send. So their fetch is replaced with one that
 * arrives here.
 *
 * Deliberately dumb: a URL in, a status and a body out. No headers the caller
 * did not ask for, and above all no credentials — the only credential this app
 * holds is the DeepSeek key, and that is attached in DeepSeekService, to one
 * endpoint, and never reaches the engine at all.
 */
class HttpService {

    private val client = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun get(url: String): JsonObject = withContext(Dispatchers.IO) {
        if (!url.startsWith("https://")) {
            throw EngineException("Refused a non-HTTPS request: $url")
        }

        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            // The Wikimedia APIs ask callers to identify themselves, and a
            // request without this is liable to be throttled first.
            .header("Api-User-Agent", "HighlightHelper/0.1 (Android)")
            .build()

        client.newCall(request).execute().use { response ->
            buildJsonObject {
                // A 404 is an answer, not a failure — "no article for this
                // term" is exactly what the lookup modules expect to read off
                // the status, so it must not be turned into an exception here.
                put("status", response.code)
                put("body", response.body.string())
            }
        }
    }
}
