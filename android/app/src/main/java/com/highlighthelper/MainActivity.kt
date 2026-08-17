package com.highlighthelper

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The launcher screen: the library, history and settings — the extension's
 * options page, rebuilt.
 *
 * A placeholder for now. It is phase B4, and it is deliberately last: the app's
 * value is entirely in the selection sheet, and a settings screen for tools
 * that are not yet wired up would be a screen full of switches that do nothing.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    Column(Modifier.padding(24.dp)) {
                        Text("Highlight Helper", style = MaterialTheme.typography.headlineSmall)
                        Text(
                            "Select text in any app and choose “Highlight” from the " +
                                "selection menu.",
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = 12.dp)
                        )
                    }
                }
            }
        }
    }
}
