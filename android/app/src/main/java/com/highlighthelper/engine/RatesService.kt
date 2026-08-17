package com.highlighthelper.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Exchange rates, in the shape `currency.js` expects.
 *
 * A direct port of `src/background/rates.js`: same endpoint, same daily cache,
 * same "serve a stale table rather than fail" rule. Rates that are a day old
 * are still worth showing — a conversion that says "cached, offline" is useful,
 * and one that says nothing at all is not.
 */
class RatesService {

    private val http = OkHttpClient.Builder()
        .callTimeout(10, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    private data class Entry(val payload: JsonObject, val fetchedAt: Long)

    private val cache = HashMap<String, Entry>()

    suspend fun fetch(base: String): JsonObject = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val key = base.uppercase()

        cache[key]?.let { hit ->
            if (now - hit.fetchedAt < TTL_MS) return@withContext hit.payload.withStale(false)
        }

        try {
            val request = Request.Builder().url("$ENDPOINT/$key").build()
            val body = http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
                response.body.string()
            }

            val parsed = json.parseToJsonElement(body).jsonObject
            val rates = parsed["rates"]?.jsonObject
                ?: throw EngineException("The rate service returned no rates")

            val payload = buildJsonObject {
                put("ok", true)
                put("base", key)
                put("rates", rates)
                put("updated", (parsed["time_last_update_unix"]?.jsonPrimitive?.long ?: 0L) * 1000)
            }
            cache[key] = Entry(payload, now)
            payload.withStale(false)
        } catch (err: Exception) {
            // A stale table beats no answer — but it must say so, which is what
            // `stale` drives in the detail view's "cached, offline" line.
            cache[key]?.let { return@withContext it.payload.withStale(true) }
            throw EngineException("Couldn't reach the rate service.")
        }
    }

    private fun JsonObject.withStale(stale: Boolean) = buildJsonObject {
        this@withStale.forEach { (k, v) -> put(k, v) }
        put("stale", stale)
    }

    private companion object {
        const val ENDPOINT = "https://open.er-api.com/v6/latest"
        const val TTL_MS = 24L * 60 * 60 * 1000
    }
}
