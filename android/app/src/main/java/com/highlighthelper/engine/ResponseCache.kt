package com.highlighthelper.engine

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.io.File
import java.security.MessageDigest

/**
 * Answers already paid for.
 *
 * The extension caches model answers and lookups for seven days, and until now
 * the app cached nothing — so re-selecting the same sentence billed DeepSeek
 * again for a reply it had already been given. That is the kind of cost that is
 * invisible while you are testing and obvious on a statement.
 *
 * Deliberately a single JSON file rather than a database. The whole point is a
 * few hundred short strings with a timestamp; a Room schema and its migrations
 * would be a great deal of machinery around a map.
 */
/*
 * Takes a File rather than a Context so it can be tested on the JVM.
 *
 * The whole value of a cache is that it returns the right thing and expires the
 * wrong thing, and both are exactly the kind of behaviour that fails quietly —
 * a stale answer looks like a fresh one. Depending on a Context would have put
 * this behind an emulator, which in practice means untested.
 */
class ResponseCache(private val file: File) {

    constructor(context: Context) : this(File(context.filesDir, "responses.json"))

    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Mutex()

    /** Loaded once and written through, so a lookup is not a disk read. */
    private var entries: MutableMap<String, Pair<String, Long>>? = null

    suspend fun get(key: String, ttlMs: Long): String? = withContext(Dispatchers.IO) {
        if (ttlMs <= 0) return@withContext null
        lock.withLock {
            val hit = load()[key] ?: return@withLock null
            val (value, storedAt) = hit
            if (System.currentTimeMillis() - storedAt > ttlMs) {
                load().remove(key)
                null
            } else {
                value
            }
        }
    }

    suspend fun put(key: String, value: String) = withContext(Dispatchers.IO) {
        lock.withLock {
            val map = load()
            map[key] = value to System.currentTimeMillis()

            // Bounded, oldest-first. An unbounded cache of model output on a
            // phone is a slow leak that only shows up as storage pressure.
            if (map.size > MAX_ENTRIES) {
                map.entries.sortedBy { it.value.second }
                    .take(map.size - MAX_ENTRIES)
                    .forEach { map.remove(it.key) }
            }
            save(map)
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        lock.withLock {
            entries = mutableMapOf()
            runCatching { file.delete() }
            Unit
        }
    }

    suspend fun count(): Int = withContext(Dispatchers.IO) { lock.withLock { load().size } }

    private fun load(): MutableMap<String, Pair<String, Long>> {
        entries?.let { return it }

        val loaded = mutableMapOf<String, Pair<String, Long>>()
        runCatching {
            if (file.exists()) {
                json.parseToJsonElement(file.readText()).jsonObject.forEach { (key, value) ->
                    val row = value.jsonObject
                    val text = row["v"]?.jsonPrimitive?.content ?: return@forEach
                    val at = row["t"]?.jsonPrimitive?.long ?: return@forEach
                    loaded[key] = text to at
                }
            }
        }
        entries = loaded
        return loaded
    }

    private fun save(map: Map<String, Pair<String, Long>>) {
        val out = buildJsonObject {
            map.forEach { (key, entry) ->
                put(key, buildJsonObject { put("v", entry.first); put("t", entry.second) })
            }
        }
        runCatching { file.writeText(out.toString()) }
    }

    companion object {
        const val MAX_ENTRIES = 400
        val DEFAULT_TTL_MS = 7L * 24 * 60 * 60 * 1000

        /**
         * A key for a request.
         *
         * Everything that changes the answer has to be in here, or a second
         * call with a different target language is served the first result —
         * which is the bug the extension's own cache key exists to avoid. The
         * whole prompt goes in, so a reworded system prompt invalidates the
         * entries it would otherwise have poisoned.
         */
        fun keyFor(vararg parts: String?): String {
            val digest = MessageDigest.getInstance("SHA-256")
            parts.forEach { digest.update((it ?: "").toByteArray()) ; digest.update(0) }
            return digest.digest().joinToString("") { "%02x".format(it) }.take(32)
        }
    }
}
