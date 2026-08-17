package com.highlighthelper.engine

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.util.concurrent.atomic.AtomicLong

/**
 * The extension's detector engine, running unmodified in a headless WebView.
 *
 * This class is the only thing in the app that knows JavaScript exists. Above
 * it, [Detection] and [Row] are ordinary Kotlin; below it, the extension's own
 * `matches()` and `rows()` do the work they already do in Chrome.
 *
 * The WebView is never attached to a layout and never draws. It is a JS runtime
 * with an ES module loader attached, which is the one thing Android does not
 * otherwise provide — `androidx.javascriptengine` evaluates a script string and
 * cannot resolve `import`, so using it would mean bundling, and bundling would
 * give the extension the build step it has deliberately never had.
 *
 * Threading: every WebView touch is on the main thread; every caller suspends.
 */
class DetectorEngine(context: Context) {

    private val app = context.applicationContext
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val calls = AtomicLong(0)
    private val pending = HashMap<Long, CompletableDeferred<JsonElement>>()

    /** Requests JS made of us — `api.send()` and friends. */
    private val requests = HashMap<Long, CompletableDeferred<Unit>>()

    private val loaded = CompletableDeferred<Unit>()

    /** Set by whoever owns the session — see [HostServices]. */
    var services: HostServices? = null

    /**
     * Serves the bundled engine over a real https:// origin.
     *
     * The path handler is registered at "/" rather than "/engine/", and that
     * detail is load-bearing: AssetsPathHandler *strips* the prefix it is
     * registered under before looking the asset up. Registered at "/engine/",
     * a request for `/engine/index.html` becomes a lookup for `index.html` at
     * the assets root, which does not exist — the main frame 404s, no script
     * runs, and the only symptom is that the engine never reports ready.
     */
    private val assetLoader = WebViewAssetLoader.Builder()
        .setDomain(ASSET_DOMAIN)
        .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(app))
        .build()

    @SuppressLint("SetJavaScriptEnabled")
    private val web: WebView = WebView(app).apply {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = true

        webViewClient = object : WebViewClient() {

            /**
             * Every request the page makes, answered from the APK or refused.
             *
             * The engine talks to Kotlin and never to the network: anything the
             * detectors need fetched goes out through OkHttp, where the API key
             * lives and where a failure is something we can see. That rule is
             * enforced here, by denying anything the asset loader does not
             * recognise, rather than with `blockNetworkLoads` — which is a
             * setting on the same network stack the asset loader has to reach
             * through, and one more thing to suspect when a page will not load.
             */
            override fun shouldInterceptRequest(
                view: WebView,
                request: android.webkit.WebResourceRequest
            ): WebResourceResponse? {
                assetLoader.shouldInterceptRequest(request.url)?.let { return it }
                Log.w(TAG, "engine asked for something outside the APK: ${request.url}")
                return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), null)
            }

            /**
             * A module that 404s takes the whole engine down, and does it
             * quietly — `window.onerror` does not fire for a failed module
             * fetch, so nothing on the JS side is left to report it. Without
             * this the only symptom is a call that waits out its timeout.
             */
            override fun onReceivedHttpError(
                view: WebView,
                request: android.webkit.WebResourceRequest,
                errorResponse: WebResourceResponse
            ) {
                val message = "${errorResponse.statusCode} for ${request.url}"
                Log.e(TAG, "engine resource failed: $message")
                if (request.isForMainFrame) failToLoad(message)
            }

            override fun onReceivedError(
                view: WebView,
                request: android.webkit.WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                val message = "${error.description} for ${request.url}"
                Log.e(TAG, "engine load error: $message")
                if (request.isForMainFrame) failToLoad(message)
            }
        }

        // JS console output into logcat. The engine has no visible surface, so
        // without this a detector throwing is invisible unless someone happens
        // to have chrome://inspect open at the time.
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d(TAG, "engine: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        addJavascriptInterface(Host(), "AndroidHost")
        loadUrl("https://$ASSET_DOMAIN/engine/index.html")
    }

    private fun failToLoad(message: String) {
        if (!loaded.isCompleted) {
            loaded.completeExceptionally(
                IllegalStateException("The detector engine failed to load: $message")
            )
        }
    }

    /**
     * The JS side of the bridge, calling in.
     *
     * Every method here runs on a WebView-owned binder thread, never the main
     * thread, so nothing in it may touch the WebView directly.
     */
    private inner class Host {

        @JavascriptInterface
        fun ready() {
            loaded.complete(Unit)
        }

        @JavascriptInterface
        fun failed(message: String) {
            Log.e(TAG, "engine reported a load failure: $message")
            failToLoad(message)
        }

        @JavascriptInterface
        fun settle(callId: Long, ok: Boolean, payload: String) {
            val slot = synchronized(pending) { pending.remove(callId) } ?: return
            val parsed = runCatching { json.parseToJsonElement(payload) }.getOrNull()
            if (ok) {
                slot.complete(parsed?.jsonObjectOrNull()?.get("value") ?: JsonObject(emptyMap()))
            } else {
                val message = parsed?.jsonObjectOrNull()?.get("error")?.toString()?.trim('"')
                slot.completeExceptionally(EngineException(message ?: "Request failed"))
            }
        }

        /**
         * `api.send()` from a detector — the message protocol the extension's
         * service worker answers in Chrome, answered here by [HostServices].
         *
         * Detectors were written against this protocol and did not have to
         * change to run on Android, which is most of why the port is cheap.
         */
        @JavascriptInterface
        fun request(id: Long, messageJson: String) {
            val handler = services ?: run { settleRequest(id, false, """{"error":"No services bound"}"""); return }
            handler.scope.launch {
                val reply = runCatching {
                    handler.handle(json.parseToJsonElement(messageJson).jsonObjectOrNull() ?: JsonObject(emptyMap()))
                }
                if (reply.isSuccess) {
                    settleRequest(id, true, reply.getOrThrow().toString())
                } else {
                    val message = reply.exceptionOrNull()?.message.orEmpty().replace("\"", "'")
                    settleRequest(id, false, """{"error":"$message"}""")
                }
            }
        }
    }

    private fun settleRequest(id: Long, ok: Boolean, payload: String) {
        evaluate("window.__hhSettle($id, $ok, '${payload.asJsStringLiteral()}')")
    }

    /**
     * Escaping for a value being pasted into a single-quoted JS string literal.
     *
     * Newlines matter as much as quotes here and are easier to forget: a raw
     * newline terminates the literal and turns the whole `evaluateJavascript`
     * call into a syntax error, which surfaces as a call that simply never
     * settles. An error message is the most likely thing to contain one, so the
     * failure would show up exactly when something had already gone wrong.
     */
    private fun String.asJsStringLiteral(): String = this
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")

    /**
     * Runs a script in the engine, from any thread.
     *
     * Deliberately NOT `web.post { … }`. `View.post` on a view that is not
     * attached to a window does not run the runnable — it parks it in the
     * view's HandlerActionQueue, which is only drained by
     * `dispatchAttachedToWindow()`. This WebView is headless and never attaches
     * to anything, so every runnable posted that way waits forever.
     *
     * That is not a hypothetical: it is why every reply to a request the engine
     * made — a rate lookup, an AI call — hung until its caller timed out, while
     * detection itself worked fine. Detection goes out through `call`, which
     * dispatches to the main thread directly, and never touched the queue.
     */
    private fun evaluate(script: String) {
        main.post { web.evaluateJavascript(script, null) }
    }

    private val main = Handler(Looper.getMainLooper())

    /**
     * Calls a bridge method and waits for its answer.
     *
     * The timeout is not defensive padding. A detector that hangs — a rate
     * lookup with no reply, a regex pathologically backtracking on a pasted
     * wall of text — would otherwise leave the sheet spinning with no way out,
     * and a sheet that never resolves is worse than one that says it failed.
     */
    suspend fun call(method: String, args: JsonElement, timeoutMs: Long = 20_000): JsonElement {
        // Named rather than left as a bare TimeoutCancellationException: this
        // firing means the page never came up at all, which is a different
        // problem from a detector being slow, and the message should say so.
        try {
            withTimeout(ENGINE_LOAD_TIMEOUT_MS) { loaded.await() }
        } catch (timeout: kotlinx.coroutines.TimeoutCancellationException) {
            throw EngineException(
                "The detector engine did not start. Check logcat for tag $TAG."
            )
        }

        val id = calls.incrementAndGet()
        val slot = CompletableDeferred<JsonElement>()
        synchronized(pending) { pending[id] = slot }

        val argsLiteral = args.toString().asJsStringLiteral()

        withContext(Dispatchers.Main) {
            web.evaluateJavascript("window.HH.call($id, '$method', '$argsLiteral')", null)
        }

        return try {
            withTimeout(timeoutMs) { slot.await() }
        } finally {
            synchronized(pending) { pending.remove(id) }
        }
    }

    fun destroy() {
        main.post {
            web.removeJavascriptInterface("AndroidHost")
            web.destroy()
        }
    }

    companion object {
        /**
         * Not a real host, and never resolved by DNS — WebViewAssetLoader
         * intercepts it. It exists so the page has a secure origin, which is
         * what ES modules and `crypto.subtle` both require.
         */
        const val ASSET_DOMAIN = "appassets.androidplatform.net"
        const val ENGINE_LOAD_TIMEOUT_MS = 10_000L
        const val TAG = "HighlightHelper"
    }
}

class EngineException(message: String) : Exception(message)

private fun JsonElement.jsonObjectOrNull(): JsonObject? = this as? JsonObject
