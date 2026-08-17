package com.highlighthelper

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.highlighthelper.engine.HostServices
import com.highlighthelper.ui.SelectionSheet

/**
 * The entry point that makes this an app rather than an extension.
 *
 * Android's text-selection toolbar offers this activity in every app on the
 * phone. What arrives is a string and almost nothing else — no page, no DOM, no
 * URL — which is exactly the shape the detector engine was already built to
 * work in, and exactly why highlights cannot come along. See ANDROID.md.
 */
class ProcessTextActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val selection = intent
            .getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
            ?.toString()
            .orEmpty()

        /*
         * The host app tells us whether it will accept a replacement. When it
         * will, "Replace" is a real offer and the rewrite tools mean what they
         * say — in any app's editor, which is more than the extension manages
         * on a web page. When it won't, the sheet must not pretend: the button
         * is disabled with a reason, exactly as `api.canReplace` drives it in
         * the panel.
         */
        val readOnly = intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)

        if (selection.isBlank()) {
            finish()
            return
        }

        val app = application as HighlightHelperApp

        val services = HostServices(
            context = this,
            scope = lifecycleScope,
            rates = app.rates,
            deepSeek = app.deepSeek,
            http = app.http,
            onReplace = { replacement ->
                if (readOnly) false else {
                    setResult(
                        Activity.RESULT_OK,
                        Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, replacement)
                    )
                    true
                }
            }
        )

        setContent {
            SelectionSheet(
                text = selection,
                canReplace = !readOnly,
                engine = app.engine,
                services = services,
                onDismiss = { finish() }
            )
        }
    }

    /*
     * There is deliberately no finish() override suppressing the exit
     * animation. The theme already sets `windowAnimationStyle` to null, which
     * does the same job without the deprecated call — the sheet animates
     * itself, and the window it sits in should never appear to be a screen the
     * user is leaving.
     */
}
