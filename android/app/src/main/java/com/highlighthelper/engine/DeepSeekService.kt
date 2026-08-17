package com.highlighthelper.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * DeepSeek, as a transport and nothing more.
 *
 * Every instruction this app gives a model lives in `src/common/prompts.js` and
 * is built inside the engine, so what arrives here is a finished system/user
 * pair. That is deliberate: the wording of those prompts is the product, and it
 * should not exist twice. This class knows how to send messages and how to read
 * a server-sent-event stream, and nothing about what is being asked.
 */
class DeepSeekService(private val secrets: SecureStore) {

    private val http = OkHttpClient.Builder()
        .callTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

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
            val key = secrets.apiKey
            if (key.isEmpty()) throw EngineException(ERR_NO_KEY)

            val streaming = onChunk != null
            val body = buildJsonObject {
                put("model", request.str("model") ?: "deepseek-chat")
                put("messages", messagesFor(request))
                request["temperature"]?.let { put("temperature", it) }
                request["maxTokens"]?.let { put("max_tokens", it) }
                put("stream", streaming)
            }

            val call = Request.Builder()
                .url(ENDPOINT)
                .addHeader("Authorization", "Bearer $key")
                .post(body.toString().toRequestBody(JSON_MEDIA))
                .build()

            http.newCall(call).execute().use { response ->
                if (!response.isSuccessful) throw EngineException(errorFor(response.code))
                val payload = response.body

                val text = if (onChunk != null) readStream(payload.charStream().buffered(), onChunk)
                else {
                    val parsed = json.parseToJsonElement(payload.string()).jsonObject
                    parsed["choices"]?.jsonArray?.firstOrNull()
                        ?.jsonObject?.get("message")?.jsonObject
                        ?.get("content")?.jsonPrimitive?.contentOrNull.orEmpty()
                }

                buildJsonObject {
                    put("ok", true)
                    put("text", text)
                    put("cached", false)
                }
            }
        }

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
    private fun readStream(reader: java.io.Reader, onChunk: (String) -> Unit): String {
        val whole = StringBuilder()

        reader.forEachLine { raw ->
            val line = raw.trim()
            if (!line.startsWith("data:")) return@forEachLine

            val payload = line.removePrefix("data:").trim()
            if (payload == "[DONE]") return@forEachLine

            val delta = runCatching {
                json.parseToJsonElement(payload).jsonObject["choices"]?.jsonArray
                    ?.firstOrNull()?.jsonObject?.get("delta")?.jsonObject
                    ?.get("content")?.jsonPrimitive?.contentOrNull
            }.getOrNull()

            if (!delta.isNullOrEmpty()) {
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
     */
    private fun errorFor(code: Int): String = when (code) {
        401, 403 -> "DeepSeek rejected that API key. Check it in settings."
        402 -> "Your DeepSeek account is out of credit."
        429 -> "DeepSeek is rate-limiting right now. Try again in a moment."
        in 500..599 -> "DeepSeek is having trouble. Try again shortly."
        else -> "DeepSeek returned $code"
    }

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull

    companion object {
        const val ENDPOINT = "https://api.deepseek.com/chat/completions"
        private val JSON_MEDIA = "application/json".toMediaType()

        const val ERR_NO_KEY =
            "This needs a DeepSeek API key. Add one in Highlight Helper's settings."
    }
}
