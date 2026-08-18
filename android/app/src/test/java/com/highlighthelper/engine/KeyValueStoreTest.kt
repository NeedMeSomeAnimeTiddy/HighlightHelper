package com.highlighthelper.engine

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * The engine's storage, on the JVM.
 *
 * `history.js` runs against this believing it is `chrome.storage.local`, so
 * what matters is not that values round-trip but that they round-trip under
 * *that* contract: a get answers with an object keyed by what was asked for,
 * a set merges rather than replaces the file, and a null removes. Getting any
 * of those subtly wrong makes history quietly stop working rather than fail.
 */
class KeyValueStoreTest {

    @get:Rule
    val temp = TemporaryFolder()

    private fun store(name: String = "store.json") = KeyValueStore(File(temp.root, name))

    private fun patch(key: String, value: String) =
        buildJsonObject { put(key, value) }

    @Test
    fun `a get answers keyed by what was asked for`() = runTest {
        val store = store()
        store.set(patch("hh:history", "value"))

        val got = store.get("hh:history")
        assertEquals(JsonPrimitive("value"), got["hh:history"])
    }

    /**
     * `chrome.storage.local.get` on a key that was never written resolves to an
     * empty object rather than throwing — and `history.js` destructures it with
     * a default, so an absent key must be absent, not null-valued.
     */
    @Test
    fun `an unknown key answers with an empty object`() = runTest {
        val got = store().get("nothing")
        assertTrue(got.isEmpty())
    }

    /** A set patches; it does not replace everything else in the file. */
    @Test
    fun `set merges rather than replacing`() = runTest {
        val store = store()
        store.set(patch("a", "1"))
        store.set(patch("b", "2"))

        assertEquals(JsonPrimitive("1"), store.get("a")["a"])
        assertEquals(JsonPrimitive("2"), store.get("b")["b"])
    }

    /** How the shim expresses `remove()`, since it has no separate operation. */
    @Test
    fun `a null value removes the key`() = runTest {
        val store = store()
        store.set(patch("a", "1"))
        store.set(buildJsonObject { put("a", JsonNull) })

        assertTrue(store.get("a").isEmpty())
    }

    @Test
    fun `survives being reopened`() = runTest {
        val file = File(temp.root, "shared.json")
        KeyValueStore(file).set(patch("k", "written first"))
        assertEquals(JsonPrimitive("written first"), KeyValueStore(file).get("k")["k"])
    }

    /**
     * What history actually stores is an array of objects, not a string, and it
     * has to come back as one — a store that stringified its values would hand
     * `history.js` something `Array.isArray` rejects, and it would silently
     * decide the history was empty.
     */
    @Test
    fun `structured values keep their shape`() = runTest {
        val store = store()
        val entries = buildJsonArray {
            add(buildJsonObject {
                put("action", "explain"); put("source", "SLA")
                put("text", "an answer"); put("at", 1_700_000_000_000)
            })
        }
        store.set(buildJsonObject { put("hh:history", entries) })

        val round = store.get("hh:history")["hh:history"]
        assertTrue(round is kotlinx.serialization.json.JsonArray)
        assertEquals(1, round!!.jsonArray.size)
        assertEquals(
            JsonPrimitive("SLA"),
            (round.jsonArray[0] as JsonObject)["source"]
        )
    }

    @Test
    fun `a corrupt file reads as empty rather than throwing`() = runTest {
        val file = File(temp.root, "broken.json")
        file.writeText("{ this is not json")

        val store = KeyValueStore(file)
        assertTrue(store.get("anything").isEmpty())
        // And it must still be writable afterwards, or one bad write would
        // leave the store permanently unusable.
        store.set(patch("k", "v"))
        assertEquals(JsonPrimitive("v"), store.get("k")["k"])
    }

    @Test
    fun `an absent value is absent, not null`() = runTest {
        assertNull(store().get("missing")["missing"])
    }
}
