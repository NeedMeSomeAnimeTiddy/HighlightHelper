package com.highlighthelper.engine

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File

/**
 * Somewhere for the engine's `chrome.storage.local` to put things.
 *
 * The only client is `src/common/history.js`, running unmodified inside the
 * WebView. Its rules are the part worth keeping — truncate a long selection
 * because the point is recognition rather than archive, replace an entry rather
 * than stacking when the same tool is run on the same text, cap the list — and
 * they only need a place to live, not a rewrite.
 *
 * A file rather than DataStore because the values are opaque JSON belonging to
 * the engine, and DataStore's typed preferences would be a wrapper around a
 * string either way.
 *
 * Worth stating plainly, since this is the most personal thing the app holds:
 * it is a record of what someone highlighted while reading. It is capped by
 * history.js, it never leaves the device, and clearing it is one button.
 */
class KeyValueStore(private val file: File) {

    constructor(context: Context) : this(File(context.filesDir, "store.json"))

    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Mutex()
    private var cached: MutableMap<String, JsonElement>? = null

    /** Mirrors `chrome.storage.local.get(key)` — an object keyed by what was asked for. */
    suspend fun get(key: String): JsonObject = withContext(Dispatchers.IO) {
        lock.withLock {
            val value = load()[key]
            buildJsonObject { if (value != null) put(key, value) }
        }
    }

    /**
     * Mirrors `chrome.storage.local.set(patch)`. A null value removes the key,
     * which is how the shim expresses `remove()`.
     */
    suspend fun set(patch: JsonObject): JsonObject = withContext(Dispatchers.IO) {
        lock.withLock {
            val map = load()
            patch.forEach { (key, value) ->
                if (value is JsonNull) map.remove(key) else map[key] = value
            }
            save(map)
            buildJsonObject { }
        }
    }

    private fun load(): MutableMap<String, JsonElement> {
        cached?.let { return it }
        val loaded = mutableMapOf<String, JsonElement>()
        runCatching {
            if (file.exists()) {
                json.parseToJsonElement(file.readText()).jsonObject
                    .forEach { (key, value) -> loaded[key] = value }
            }
        }
        cached = loaded
        return loaded
    }

    private fun save(map: Map<String, JsonElement>) {
        runCatching {
            file.writeText(buildJsonObject { map.forEach { (k, v) -> put(k, v) } }.toString())
        }
    }
}
