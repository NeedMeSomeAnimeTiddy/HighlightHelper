package com.highlighthelper

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.highlighthelper.engine.HostServices
import com.highlighthelper.ui.SelectionSheet

/**
 * The second way in: the share sheet.
 *
 * For apps whose selection toolbar is non-standard enough that PROCESS_TEXT
 * never appears, and for sharing a whole article rather than a phrase.
 *
 * Nothing shared this way can be replaced — a share is a copy, and the source
 * app is not waiting for an answer — so `canReplace` is false and the sheet
 * says so on the button rather than offering something that would do nothing.
 */
class ShareActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val shared = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
        if (shared.isBlank()) {
            finish()
            return
        }

        val app = application as HighlightHelperApp

        val services = HostServices(
            context = this,
            scope = lifecycleScope,
            rates = app.rates,
            onReplace = { false }
        )

        setContent {
            SelectionSheet(
                text = shared,
                canReplace = false,
                engine = app.engine,
                services = services,
                onDismiss = { finish() }
            )
        }
    }
}
