package com.highlighthelper.engine

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Android's speech synthesiser, wrapped into something a composable can hold.
 *
 * Two properties of the platform API make it awkward to drive straight from a
 * button, and both are absorbed here. It starts asynchronously — a `speak()`
 * issued before the service has bound is dropped without a word or an error —
 * so a request that arrives early is parked and replayed the moment the engine
 * reports itself ready, which is what makes the *first* press work rather than
 * only the second. And it reports progress on a binder thread, where Compose
 * state must not be touched, so every callback is bounced through the main
 * looper before it turns into `speaking = false`.
 *
 * It lives in `engine` rather than `ui` because it is platform plumbing with no
 * drawing in it, the same way [DetectorEngine] is.
 */
class Speaker(context: Context, private val onSpeakingChanged: (Boolean) -> Unit) {

    private class Utterance(val text: String, val lang: String?)

    private val main = Handler(Looper.getMainLooper())

    private var ready = false
    private var disposed = false

    /** A request that arrived before the engine finished starting. */
    private var parked: Utterance? = null

    private val tts = TextToSpeech(context.applicationContext) { status ->
        // Posted rather than handled inline: this callback arrives on whichever
        // thread the synthesis service happens to answer on, and everything it
        // touches below — `ready`, `parked`, the state the caller flips — is
        // main-thread state.
        main.post {
            ready = status == TextToSpeech.SUCCESS
            val waiting = parked
            parked = null
            when {
                disposed -> Unit
                // Nothing is going to be said, so the button must not be left
                // sitting on "Stop" waiting for an utterance that never starts.
                !ready -> onSpeakingChanged(false)
                waiting != null -> start(waiting)
            }
        }
    }

    init {
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) {
                main.post { if (!disposed) onSpeakingChanged(false) }
            }

            /*
             * Deprecated in favour of the two-argument overload, and still the
             * abstract one: the base class leaves `onError(String, Int)` as a
             * concrete method that forwards to this. Overriding this catches
             * both, where overriding only the new one would miss any OEM engine
             * that still reports through the old path.
             */
            @Deprecated("Superseded by onError(String, Int), which forwards here.")
            @Suppress("OVERRIDE_DEPRECATION")
            override fun onError(utteranceId: String?) {
                main.post { if (!disposed) onSpeakingChanged(false) }
            }
        })
    }

    /** Speaks [text], interrupting anything already in progress. */
    fun speak(text: String, lang: String?) {
        val utterance = Utterance(text, lang)
        if (ready) start(utterance) else parked = utterance
    }

    fun stop() {
        parked = null
        if (ready) tts.stop()
    }

    /**
     * Releases the synthesis service.
     *
     * A [TextToSpeech] that outlives the view that made it keeps its connection
     * to the system service open and, worse, keeps talking — so the sheet being
     * dismissed mid-sentence has to end the sentence too.
     */
    fun shutdown() {
        disposed = true
        parked = null
        runCatching {
            tts.stop()
            tts.shutdown()
        }
    }

    private fun start(utterance: Utterance) {
        applyLanguage(utterance.lang)
        val queued = tts.speak(utterance.text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
        if (queued != TextToSpeech.SUCCESS) onSpeakingChanged(false)
    }

    /**
     * The detector's language tag, or the device's own if that voice is not
     * installed.
     *
     * Falling back rather than refusing is the kinder failure: hearing a French
     * phrase read with an English voice is at least *something*, and the user
     * can tell instantly what happened, whereas a button that does nothing when
     * pressed looks broken.
     */
    private fun applyLanguage(lang: String?) {
        val wanted = lang?.takeIf { it.isNotBlank() }?.let { Locale.forLanguageTag(it) }
            ?: Locale.getDefault()
        val status = tts.setLanguage(wanted)
        if (status == TextToSpeech.LANG_MISSING_DATA || status == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.getDefault())
        }
    }

    private companion object {
        /**
         * Any non-null id will do, but it must be non-null: `speak()` only
         * reports progress for utterances that carry one, so passing null would
         * silently cost us `onDone` and leave the button stuck on "Stop".
         */
        const val UTTERANCE_ID = "hh-speech"
    }
}
