package com.highlighthelper.ui

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.getSystemService
import com.highlighthelper.engine.DetectorEngine
// Aliased: Compose's own `Row` layout is used constantly in this file, and an
// unqualified `Row` would be ambiguous between the two.
import com.highlighthelper.engine.Row as MenuRowData
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/**
 * Built once. A `Json` instance is expensive enough that creating one per
 * recomposition of a menu block is measurable, and nothing here varies.
 */
private val LENIENT = Json { ignoreUnknownKeys = true }

/**
 * The block vocabulary, drawn natively.
 *
 * This is the twin of `BLOCKS` in `src/content/kit.js` and the two must stay in
 * step — same names, same fields, same meaning. What differs is only what a
 * block looks like, which is the entire point of describing views as data: the
 * detectors do not know whether "headline" means a flex row of spans or a
 * Compose `Row`, and they should not.
 *
 * An unknown block is skipped with a visible note rather than crashing. New
 * block types will reach an old build of this app, and a view that silently
 * drops a section looks like a bug in the detector that produced it.
 */
@Composable
fun BlockView(
    block: JsonObject,
    session: Long?,
    engine: DetectorEngine,
    onOpenRow: (MenuRowData) -> Unit
) {
    val scope = rememberCoroutineScope()

    when (block.str("type")) {

        "label" -> Text(
            block.str("text").orEmpty(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        "note" -> Text(
            block.str("text").orEmpty(),
            style = MaterialTheme.typography.bodyMedium,
            color = if (block.str("variant") == "hh-warn") MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurfaceVariant
        )

        "sub" -> Text(
            block.str("text").orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        "quote" -> Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(8.dp)
        ) {
            Text(
                block.str("text").orEmpty(),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(12.dp)
            )
        }

        // Three shapes, matching kit.js: a conversion (from → text), an answer
        // with a trailing detail, or a bare value.
        "headline" -> Row(verticalAlignment = Alignment.Bottom) {
            block.str("from")?.let {
                Text(it, style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    "  ${block.str("op") ?: "→"}  ",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                block.str("text").orEmpty(),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold
            )
            block.str("trailing")?.let {
                Spacer(Modifier.width(8.dp))
                Text(it, style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        "facts" -> Column {
            block.str("label")?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            block["items"]?.jsonArray?.forEach { entry ->
                val fact = entry.jsonObject
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        fact.str("label").orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontFamily = if (fact.flag("monoLabel")) FontFamily.Monospace
                        else FontFamily.Default
                    )
                    Text(
                        fact.str("value").orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = if (fact.flag("mono")) FontFamily.Monospace
                        else FontFamily.Default
                    )
                }
            }
        }

        /*
         * The regex breakdown. The indent is the meaning, not decoration —
         * `(a(b))` and `(a)(b)` have identical tokens and are different
         * patterns — so depth is rendered rather than flattened away.
         */
        "steps" -> Column {
            block["items"]?.jsonArray?.forEach { entry ->
                val step = entry.jsonObject
                val depth = step["depth"]?.jsonPrimitive?.intOrNull ?: 0
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = (depth * 11).dp, top = 2.dp, bottom = 2.dp)
                ) {
                    Text(
                        step.str("token").orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = FontFamily.Monospace
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        step.str("description").orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        // Whitespace is load-bearing here, so it scrolls rather than wraps.
        "code" -> Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(8.dp)
        ) {
            Text(
                block.str("text").orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                softWrap = false,
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(12.dp)
            )
        }

        "text" -> {
            val dim = block.str("dim")
            if (dim != null) {
                // The continuation case: the original in grey, the new text
                // after it, so it is obvious which half the model wrote.
                Column {
                    Text(dim, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(block.str("text").orEmpty())
                }
            } else {
                Text(block.str("text").orEmpty(), style = MaterialTheme.typography.bodyMedium)
            }
        }

        "swatch" -> Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(parseCssColor(block.str("css")) ?: Color.Transparent)
            )
            Spacer(Modifier.width(12.dp))
            Column {
                Text(
                    block.str("title").orEmpty(),
                    style = MaterialTheme.typography.titleMedium
                )
                block.str("sub")?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        "actions" -> ActionButtons(block, session, engine)

        "buttons" -> FlowButtons(block, session, engine)

        "menu" -> Column {
            block["rows"]?.jsonArray?.forEach { entry ->
                val row = runCatching {
                    LENIENT.decodeFromJsonElement<MenuRowData>(entry)
                }.getOrNull() ?: return@forEach
                ListItem(
                    headlineContent = { Text(row.label) },
                    modifier = Modifier.clickableIf(row.hasDetail && row.supported) { onOpenRow(row) }
                )
            }
        }

        "unsupported" -> Text(
            block.str("note") ?: "Not available in the app yet.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        else -> Text(
            "This view needs a newer version of the app.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/** Copy / Replace, plus whatever the detector added. */
@Composable
private fun ActionButtons(block: JsonObject, session: Long?, engine: DetectorEngine) {
    val text = block.str("text").orEmpty()
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CopyButton(text)
        block["extra"]?.jsonArray?.forEach { entry ->
            val extra = entry.jsonObject
            RunButton(extra.str("label").orEmpty(), extra.str("action"), session, engine)
        }
    }
}

@Composable
private fun FlowButtons(block: JsonObject, session: Long?, engine: DetectorEngine) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        block["items"]?.jsonArray?.forEach { entry ->
            val item = entry.jsonObject
            if (item.str("kind") == "copy") {
                CopyButton(item.str("text").orEmpty())
            } else {
                RunButton(item.str("label").orEmpty(), item.str("action"), session, engine)
            }
        }
    }
}

/**
 * Confirms on itself rather than in a snackbar — the same choice the extension
 * makes, and for the same reason: the answer to "did that work" belongs on the
 * thing you pressed.
 */
@Composable
private fun CopyButton(text: String) {
    val context = LocalContext.current
    var label by remember { mutableStateOf("Copy") }

    LaunchedEffect(label) {
        if (label != "Copy") {
            delay(1400)
            label = "Copy"
        }
    }

    OutlinedButton(onClick = {
        val clipboard = context.getSystemService<ClipboardManager>()
        label = if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("Highlight Helper", text))
            "Copied"
        } else {
            "Copy failed"
        }
    }) { Text(label) }
}

@Composable
private fun RunButton(label: String, action: String?, session: Long?, engine: DetectorEngine) {
    val scope = rememberCoroutineScope()
    OutlinedButton(
        enabled = action != null && session != null,
        onClick = {
            scope.launch {
                runCatching {
                    engine.call("runAction", buildJsonObject {
                        put("session", session!!); put("action", action!!)
                    })
                }
            }
        }
    ) { Text(label) }
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

private fun JsonObject.str(key: String): String? =
    this[key]?.jsonPrimitive?.contentOrNull

private fun JsonObject.flag(key: String): Boolean =
    this[key]?.jsonPrimitive?.booleanOrNull == true

private fun Modifier.clickableIf(enabled: Boolean, onClick: () -> Unit): Modifier =
    if (enabled) this.clickable(onClick = onClick) else this

/**
 * `rgb()` / `rgba()` as produced by `color.js`.
 *
 * Only these two forms, deliberately: the detector always emits one of them for
 * the swatch, so a general CSS colour parser here would be dead code pretending
 * to be robust.
 */
private fun parseCssColor(css: String?): Color? {
    if (css == null) return null
    val numbers = Regex("[\\d.]+").findAll(css).map { it.value }.toList()
    if (numbers.size < 3) return null
    return runCatching {
        Color(
            red = numbers[0].toFloat() / 255f,
            green = numbers[1].toFloat() / 255f,
            blue = numbers[2].toFloat() / 255f,
            alpha = if (numbers.size > 3) numbers[3].toFloat() else 1f
        )
    }.getOrNull()
}
