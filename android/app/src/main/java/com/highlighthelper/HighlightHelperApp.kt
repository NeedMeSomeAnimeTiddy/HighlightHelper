package com.highlighthelper

import android.app.Application
import android.content.pm.ApplicationInfo
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import com.highlighthelper.engine.AiService
import com.highlighthelper.engine.OAuthService
import com.highlighthelper.engine.DetectorEngine
import com.highlighthelper.engine.HostServices
import com.highlighthelper.engine.HttpService
import com.highlighthelper.engine.KeyValueStore
import com.highlighthelper.engine.RatesService
import com.highlighthelper.engine.ResponseCache
import com.highlighthelper.engine.SecureStore
import com.highlighthelper.engine.SettingsStore

/**
 * Holds the engine across activities.
 *
 * A cold WebView is a few hundred milliseconds before the first `detect()`
 * returns, and the sheet is expected to be instant — it opens from a menu the
 * user is already looking at. Keeping one instance alive here means the second
 * and subsequent selections cost nothing.
 *
 * It is deliberately only an optimisation. Android may reclaim the process
 * between selections whatever this class does, so the sheet is built to show
 * its header immediately and fill rows as they arrive rather than to depend on
 * a warm engine — see SelectionSheet.
 */
class HighlightHelperApp : Application() {

    val engine: DetectorEngine by lazy { DetectorEngine(this) }
    val rates: RatesService by lazy { RatesService() }
    val http: HttpService by lazy { HttpService() }
    val secrets: SecureStore by lazy { SecureStore(this) }
    val oauth: OAuthService by lazy { OAuthService(this, secrets) }
    val ai: AiService by lazy { AiService(secrets, oauth) }
    val settings: SettingsStore by lazy { SettingsStore(this) }
    val cache: ResponseCache by lazy { ResponseCache(this) }
    val store: KeyValueStore by lazy { KeyValueStore(this) }

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /**
     * The services the engine talks to when no sheet is open.
     *
     * The settings and history screens ask the engine things too, and a request
     * it makes with nothing bound simply never gets an answer. A selection
     * sheet rebinds this to its own instance while it is up, because only a
     * sheet can put text back into the app it came from — this one refuses to,
     * which is correct rather than a limitation: there is nothing to replace.
     */
    val services: HostServices by lazy {
        HostServices(
            context = this,
            scope = appScope,
            rates = rates,
            ai = ai,
            http = http,
            cache = cache,
            store = store,
            onReplace = { false }
        )
    }

    override fun onCreate() {
        super.onCreate()
        engine.services = services

        /*
         * Makes the engine's WebView visible to desktop Chrome at
         * chrome://inspect — a real console and debugger over the detectors.
         *
         * Without it the engine is a black box: a detector that throws shows up
         * as a row that never resolves, with the reason discardable inside a
         * WebView nobody can open. Debug builds only, and gated on the manifest
         * flag rather than BuildConfig so it cannot survive into a release by
         * way of someone enabling buildConfig generation later.
         */
        val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true)
    }

    override fun onTerminate() {
        super.onTerminate()
        engine.destroy()
    }
}
