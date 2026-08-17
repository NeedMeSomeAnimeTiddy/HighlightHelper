package com.highlighthelper.engine

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * The cache, on the JVM.
 *
 * It decides whether a request costs money, and every way it can be wrong is
 * quiet: a stale answer looks exactly like a fresh one, and a key that collides
 * serves one selection's reply for another. None of that shows up by using the
 * app, so it is checked here instead.
 */
class ResponseCacheTest {

    @get:Rule
    val temp = TemporaryFolder()

    private fun cache(name: String = "responses.json") =
        ResponseCache(File(temp.root, name))

    @Test
    fun `stores and returns a value`() = runTest {
        val cache = cache()
        cache.put("k", "an answer")
        assertEquals("an answer", cache.get("k", ResponseCache.DEFAULT_TTL_MS))
    }

    @Test
    fun `misses on an unknown key`() = runTest {
        assertNull(cache().get("nothing", ResponseCache.DEFAULT_TTL_MS))
    }

    @Test
    fun `expires an entry older than the ttl`() = runTest {
        val cache = cache()
        cache.put("k", "an answer")
        // A zero-length window makes anything already stored older than it.
        assertNull(cache.get("k", 0))
    }

    /**
     * `cacheDays: 0` in settings means "do not cache", and it has to mean that
     * on read as well as write — otherwise turning caching off would still
     * serve answers stored while it was on.
     */
    @Test
    fun `a zero ttl disables reads entirely`() = runTest {
        val cache = cache()
        cache.put("k", "an answer")
        assertNull(cache.get("k", 0))
    }

    @Test
    fun `survives being reopened`() = runTest {
        val file = File(temp.root, "shared.json")
        ResponseCache(file).put("k", "written by the first instance")
        assertEquals(
            "written by the first instance",
            ResponseCache(file).get("k", ResponseCache.DEFAULT_TTL_MS)
        )
    }

    @Test
    fun `clear empties it`() = runTest {
        val cache = cache()
        cache.put("k", "an answer")
        cache.clear()
        assertNull(cache.get("k", ResponseCache.DEFAULT_TTL_MS))
        assertEquals(0, cache.count())
    }

    @Test
    fun `evicts oldest first past the cap`() = runTest {
        val cache = cache()
        repeat(ResponseCache.MAX_ENTRIES + 20) { cache.put("key$it", "value$it") }

        assertEquals(ResponseCache.MAX_ENTRIES, cache.count())
        // The earliest writes are the ones that should have gone.
        assertNull(cache.get("key0", ResponseCache.DEFAULT_TTL_MS))
        assertEquals(
            "value${ResponseCache.MAX_ENTRIES + 19}",
            cache.get("key${ResponseCache.MAX_ENTRIES + 19}", ResponseCache.DEFAULT_TTL_MS)
        )
    }

    /**
     * Anything that changes the answer has to change the key. The prompt is in
     * there precisely so that rewording a system prompt cannot serve replies
     * the old wording produced.
     */
    @Test
    fun `key covers every part of the request`() {
        val base = ResponseCache.keyFor("deepseek-chat", "system", "user", null)

        assertNotEquals(base, ResponseCache.keyFor("deepseek-reasoner", "system", "user", null))
        assertNotEquals(base, ResponseCache.keyFor("deepseek-chat", "system REWORDED", "user", null))
        assertNotEquals(base, ResponseCache.keyFor("deepseek-chat", "system", "different text", null))
        assertEquals(base, ResponseCache.keyFor("deepseek-chat", "system", "user", null))
    }

    /**
     * Concatenation without a separator would make ("ab","c") and ("a","bc")
     * the same request — which is how one selection ends up served another's
     * answer.
     */
    @Test
    fun `key does not blur its boundaries`() {
        assertNotEquals(
            ResponseCache.keyFor("ab", "c"),
            ResponseCache.keyFor("a", "bc")
        )
    }
}
