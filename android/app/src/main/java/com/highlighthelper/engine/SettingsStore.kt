package com.highlighthelper.engine

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject

private val Context.dataStore by preferencesDataStore(name = "highlight-helper")

/**
 * Preferences, stored as the user's overrides and nothing more.
 *
 * The extension keeps one `settings` object in `chrome.storage.sync` and merges
 * it over `DEFAULTS` on read. This does the same thing, and deliberately does
 * *not* keep a Kotlin copy of those defaults: the engine merges what it is
 * given over its own, and the settings screen asks the engine what the defaults
 * are. A second list here would be a second thing to update whenever a detector
 * is added, and nothing would fail when it was forgotten.
 *
 * Held as raw JSON for the same reason. The shape belongs to
 * `src/common/settings.js`; typing it here would pin it in two places.
 */
class SettingsStore(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true }

    val overrides: Flow<JsonObject> = context.dataStore.data.map { prefs ->
        parse(prefs[KEY])
    }

    suspend fun current(): JsonObject = overrides.first()

    /**
     * Shallow-merges a patch, with `detectors` merged a level deeper — the same
     * rule `saveSettings()` follows in the extension, so turning one detector
     * off does not drop the rest of the map.
     */
    suspend fun update(patch: JsonObject) {
        context.dataStore.edit { prefs ->
            val existing = parse(prefs[KEY])
            val merged = buildJsonObject {
                existing.forEach { (k, v) -> put(k, v) }
                patch.forEach { (k, v) -> put(k, v) }

                val detectors = (existing["detectors"] as? JsonObject)
                val patched = (patch["detectors"] as? JsonObject)
                if (detectors != null || patched != null) {
                    put("detectors", buildJsonObject {
                        detectors?.forEach { (k, v) -> put(k, v) }
                        patched?.forEach { (k, v) -> put(k, v) }
                    })
                }
            }
            prefs[KEY] = merged.toString()
        }
    }

    private fun parse(raw: String?): JsonObject =
        raw?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
            ?: JsonObject(emptyMap())

    private companion object {
        val KEY = stringPreferencesKey("settings")
    }
}
