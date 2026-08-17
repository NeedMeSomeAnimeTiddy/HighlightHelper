package com.highlighthelper

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/**
 * Settings, and the only reason this screen exists yet: somewhere to put the
 * DeepSeek API key.
 *
 * The extension's options page is a much larger thing — detector toggles,
 * search engines, custom tools, the highlight library. None of that is here.
 * What is here is the one setting without which nine of the twenty-two tools
 * cannot work at all, and saying so plainly beats a screen of switches that
 * imply more is wired up than is.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as HighlightHelperApp

        setContent {
            MaterialTheme {
                Surface {
                    var key by remember { mutableStateOf(app.secrets.apiKey) }
                    var saved by remember { mutableStateOf(false) }

                    Column(
                        Modifier
                            .verticalScroll(rememberScrollState())
                            .padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("Highlight Helper", style = MaterialTheme.typography.headlineSmall)

                        Text(
                            "Select text in any app, then choose “Highlight” from the " +
                                "selection menu. It may be under the ⋮ overflow.",
                            style = MaterialTheme.typography.bodyMedium
                        )

                        HorizontalDivider(Modifier.padding(vertical = 8.dp))

                        Text("DeepSeek API key", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Needed for explain, translate, summarise, rewrite and the " +
                                "code tools. Conversions, the calculator, colours, dates, " +
                                "regex and the text tools all work without one.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        OutlinedTextField(
                            value = key,
                            onValueChange = { key = it; saved = false },
                            label = { Text("sk-…") },
                            singleLine = true,
                            // Masked by default: this is a credential, and the
                            // screen it is typed on is over whatever app the
                            // user was reading.
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = {
                                app.secrets.apiKey = key
                                saved = true
                            }) { Text(if (saved) "Saved" else "Save") }

                            if (app.secrets.hasKey) {
                                OutlinedButton(onClick = {
                                    app.secrets.apiKey = ""
                                    key = ""
                                    saved = false
                                }) { Text("Forget it") }
                            }
                        }

                        Text(
                            "Stored encrypted on this device, and sent only to " +
                                "api.deepseek.com. It never reaches the page the selection " +
                                "came from.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}
