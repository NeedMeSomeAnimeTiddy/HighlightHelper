package com.highlighthelper.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * The model call, as a transport and nothing more.
 *
 * Every instruction this app gives a model lives in `src/common/prompts.js` and
 * is built inside the engine, so what arrives here is a finished system/user
 * pair. Which service to send it to is decided in the engine too — the
 * `provider` field on each request is `resolveProvider()`'s answer, from the
 * same `src/common/providers.js` the extension reads. That is deliberate: a
 * provider added to that table has to appear on both platforms, and it cannot
 * if Kotlin keeps its own list of endpoints.
 *
 * What is left here is genuinely transport: a socket, a timeout, two wire
 * formats, and the credential — which is the one thing that must NOT cross into
 * the WebView, and so is the one thing the engine never sends.
 */
class AiService(
    private val secrets: SecureStore,
    private val oauth: OAuthService
) {

    private val http = OkHttpClient.Builder()
        .callTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Where a request is going, unpacked from what the engine sent.
     *
     * Every field has a fallback, because a request built by an older engine
     * than this build — the assets are copied in at compile time, but a cached
     * page could in principle be stale — should still reach DeepSeek rather
     * than posting to an empty URL.
     */
    private data class Target(
        val id: String,
        val name: String,
        val api: String,
        val endpoint: String,
        val model: String,
        val needsKey: Boolean,
        val auth: String,
        val oauth: OAuthService.Config
    )

    private fun targetFor(request: JsonObject): Target {
        val p = request["provider"] as? JsonObject
        return Target(
            id = p?.str("id") ?: "deepseek",
            name = p?.str("name") ?: "DeepSeek",
            api = p?.str("api") ?: "openai",
            endpoint = p?.str("endpoint")?.takeIf { it.isNotBlank() } ?: FALLBACK_ENDPOINT,
            model = p?.str("model")?.takeIf { it.isNotBlank() } ?: "deepseek-chat",
            needsKey = p?.get("needsKey")?.jsonPrimitive?.booleanOrNull ?: true,
            auth = p?.str("auth") ?: "key",
            oauth = OAuthService.Config.from(p?.get("oauth") as? JsonObject)
        )
    }

    /**
     * The bearer credential, however it was obtained.
     *
     * A pasted key and a token from a sign-in end up in the same header, so the
     * difference is confined here — which is also where an expired token is
     * quietly renewed, so no caller has to remember to.
     */
    private suspend fun credentialFor(target: Target): String = when {
        target.auth == "oauth" -> {
            if (!target.oauth.ready) {
                throw EngineException(
                    "Sign-in is not configured yet: no ${target.oauth.missing.joinToString(", ")}."
                )
            }
            oauth.accessToken(target.id, target.oauth)
        }

        !target.needsKey -> ""

        else -> secrets.keyFor(target.id).also {
            if (it.isEmpty()) throw EngineException(noKeyMessage(target.name))
        }
    }

    /**
     * One completion.
     *
     * `onChunk` turns this into the streaming path. A summary is the longest
     * thing this app produces and the first sentence is readable long before
     * the last, so the caller gets tokens as they arrive rather than four
     * seconds of spinner.
     */
    suspend fun complete(request: JsonObject, onChunk: ((String) -> Unit)?): JsonObject =
        withContext(Dispatchers.IO) {
            val target = targetFor(request)
            val key = credentialFor(target)

            val streaming = onChunk != null
            val call = Request.Builder()
                .url(target.endpoint)
                .apply { headersFor(target.api, key).forEach { (k, v) -> addHeader(k, v) } }
                .post(bodyFor(target, request, streaming).toString().toRequestBody(JSON_MEDIA))
                .build()

            http.newCall(call).execute().use { response ->
                if (!response.isSuccessful) {
                    throw EngineException(errorFor(target, response.code, response.body.string()))
                }
                val payload = response.body

                val text = if (onChunk != null) {
                    readStream(target.api, payload.charStream().buffered(), onChunk)
                } else {
                    readAnswer(target.api, json.parseToJsonElement(payload.string()).jsonObject)
                }

                buildJsonObject {
                    put("ok", true)
                    put("text", text)
                    put("cached", false)
                }
            }
        }

    /* -------------------------------------------------------------- *
     * Wire formats
     * -------------------------------------------------------------- */

    /**
     * Anthropic's Messages API differs structurally rather than cosmetically:
     * the system prompt is a top-level field, `max_tokens` is required, and the
     * stream carries typed events. `src/common/providers.js` says the same
     * thing for the browser; this is the same shape stated for OkHttp, and the
     * two are checked against each other by `android/tools/bridge-smoke.mjs`.
     */
    private fun bodyFor(target: Target, request: JsonObject, streaming: Boolean): JsonObject {
        val messages = messagesFor(request)

        if (target.api == "anthropic") {
            val system = messages.mapNotNull { entry ->
                val row = entry.jsonObject
                if (row.str("role") == "system") row.str("content") else null
            }.joinToString("\n\n")

            val rest = messages.filter { it.jsonObject.str("role") != "system" }

            return buildJsonObject {
                put("model", target.model)
                // Required by the API rather than optional, so an unset ceiling
                // has to become a number here instead of 400-ing on send.
                put("max_tokens", request["maxTokens"] ?: kotlinx.serialization.json.JsonPrimitive(1024))
                if (system.isNotEmpty()) put("system", system)
                request["temperature"]?.let { put("temperature", it) }
                put("messages", JsonArray(rest))
                put("stream", streaming)
            }
        }

        return buildJsonObject {
            put("model", target.model)
            put("messages", messages)
            request["temperature"]?.let { put("temperature", it) }
            request["maxTokens"]?.let { put("max_tokens", it) }
            put("stream", streaming)
        }
    }

    private fun headersFor(api: String, key: String): Map<String, String> =
        if (api == "anthropic") {
            mapOf(
                "Content-Type" to "application/json",
                "x-api-key" to key,
                "anthropic-version" to "2023-06-01"
            )
        } else {
            mapOf(
                "Content-Type" to "application/json",
                "Authorization" to "Bearer $key"
            )
        }

    private fun readAnswer(api: String, body: JsonObject): String =
        if (api == "anthropic") {
            body["content"]?.jsonArray.orEmpty()
                .filter { it.jsonObject.str("type") == "text" }
                .joinToString("") { it.jsonObject.str("text").orEmpty() }
        } else {
            body["choices"]?.jsonArray?.firstOrNull()
                ?.jsonObject?.get("message")?.jsonObject
                ?.get("content")?.jsonPrimitive?.contentOrNull.orEmpty()
        }

    /** One SSE payload turned into the text it adds, or "" for the many that add none. */
    private fun readDelta(api: String, payload: String): String = runCatching {
        val event = json.parseToJsonElement(payload).jsonObject
        if (api == "anthropic") {
            if (event.str("type") != "content_block_delta") return ""
            event["delta"]?.jsonObject?.str("text").orEmpty()
        } else {
            event["choices"]?.jsonArray?.firstOrNull()
                ?.jsonObject?.get("delta")?.jsonObject
                ?.get("content")?.jsonPrimitive?.contentOrNull.orEmpty()
        }
    }.getOrDefault("")

    /**
     * A `chat` request already carries the whole conversation; an `ai` request
     * carries a system/user pair that the engine built. Both end up as the same
     * message array, so the difference stops here.
     */
    private fun messagesFor(request: JsonObject): JsonArray {
        request["messages"]?.jsonArray?.let { return it }
        return buildJsonArray {
            request.str("system")?.let {
                add(buildJsonObject { put("role", "system"); put("content", it) })
            }
            add(buildJsonObject { put("role", "user"); put("content", request.str("user").orEmpty()) })
        }
    }

    /**
     * Reads the SSE body, accumulating content deltas.
     *
     * `onChunk` receives the answer *so far* rather than the newest fragment,
     * which is what the panel's streaming view expects — it replaces its text
     * each time rather than appending, so a dropped frame cannot leave a hole
     * in the middle of a sentence.
     */
    private fun readStream(api: String, reader: java.io.Reader, onChunk: (String) -> Unit): String {
        val whole = StringBuilder()

        reader.forEachLine { raw ->
            val line = raw.trim()
            if (!line.startsWith("data:")) return@forEachLine

            val payload = line.removePrefix("data:").trim()
            if (payload == "[DONE]") return@forEachLine

            val delta = readDelta(api, payload)
            if (delta.isNotEmpty()) {
                whole.append(delta)
                onChunk(whole.toString())
            }
        }

        if (whole.isEmpty()) {
            // A stream that produced nothing is a failure, not an empty answer.
            // Half a summary presented as a whole one would be worse than an
            // error the user can retry — the extension takes the same line.
            throw EngineException("The answer stopped before it started. Try again.")
        }
        return whole.toString()
    }

    /**
     * Finished sentences, not the extension's ERR codes.
     *
     * Those codes exist because the panel and the service worker are separate
     * contexts and the panel maps them to explanations in `main.js` — which is
     * browser-only, and whose wording sends people to chrome://extensions. On
     * a phone there is no such split and no such place to send them, so the
     * message the user should read is produced here rather than translated
     * twice.
     *
     * The provider's name is in every line because it is now a choice: "out of
     * credit" is only actionable if you know which account to top up.
     */
    private fun errorFor(target: Target, code: Int, body: String): String {
        val detail = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonObject?.str("message")
        }.getOrNull().orEmpty()

        return when {
            code == 401 || code == 403 ->
                "${target.name} rejected that API key. Check it in settings."
            code == 402 -> "Your ${target.name} account is out of credit."
            code == 429 && Regex("quota|credit|billing|insufficient", RegexOption.IGNORE_CASE)
                .containsMatchIn(detail) -> "Your ${target.name} account is out of credit."
            code == 429 -> "${target.name} is rate-limiting right now. Try again in a moment."
            code == 400 && detail.contains("credit balance", ignoreCase = true) ->
                "Your ${target.name} account is out of credit."
            code == 404 && detail.contains("model", ignoreCase = true) ->
                "${target.name} has no model called \"${target.model}\". Change it in settings."
            code in 500..599 -> "${target.name} is having trouble. Try again shortly."
            detail.isNotEmpty() -> "${target.name} returned $code: $detail"
            else -> "${target.name} returned $code"
        }
    }

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull

    companion object {
        private const val FALLBACK_ENDPOINT = "https://api.deepseek.com/chat/completions"
        private val JSON_MEDIA = "application/json".toMediaType()

        fun noKeyMessage(name: String) =
            "This needs a $name API key. Add one in Highlight Helper's settings."
    }
}
