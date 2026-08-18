package com.highlighthelper.ui

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.core.content.getSystemService
import com.highlighthelper.engine.DetectorEngine
import com.highlighthelper.engine.Speaker
// Aliased: Compose's own `Row` layout is used constantly in this file, and an
// unqualified `Row` would be ambiguous between the two.
import com.highlighthelper.engine.Row as MenuRowData
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import kotlin.math.floor

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
                Text(richText(block), style = MaterialTheme.typography.bodyMedium)
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

        "disclosure" -> Disclosure(block, session, engine, onOpenRow)

        "choice" -> Choice(block, session, engine, onOpenRow)

        "conversation" -> Conversation(block, session, engine)

        "qrcode" -> QrCode(block)

        "speech" -> Speech(block)

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
 * The blocks that carry behaviour
 * ------------------------------------------------------------------ */

/**
 * A button that becomes a panel.
 *
 * The deferred-work shape: nothing here costs a request until it is pressed,
 * which is the whole reason "Find a source" and "Synonyms" are buttons and not
 * content. `runBlocks` answers with a fresh block list, and that list goes back
 * through [BlockView] — so whatever the detector chose to return renders with
 * no help from this function.
 *
 * A failure leaves the button standing rather than replacing it with the error.
 * The work was deferred because it can fail (it is usually a network call), and
 * a dead end where a button used to be is the one outcome with no way forward.
 */
@Composable
private fun Disclosure(
    block: JsonObject,
    session: Long?,
    engine: DetectorEngine,
    onOpenRow: (MenuRowData) -> Unit
) {
    val scope = rememberCoroutineScope()
    val action = block.str("action")

    var revealed by remember(block) { mutableStateOf<List<JsonObject>?>(null) }
    var running by remember(block) { mutableStateOf(false) }
    var failure by remember(block) { mutableStateOf<String?>(null) }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        failure?.let { FailureNote(it) }

        when {
            running -> LoadingRow(block.str("busy") ?: "Working…")

            revealed != null -> NestedBlocks(revealed!!, session, engine, onOpenRow)

            else -> OutlinedButton(
                enabled = action != null && session != null,
                onClick = {
                    if (action == null || session == null) return@OutlinedButton
                    running = true
                    failure = null
                    scope.launch {
                        runCatching { runBlocks(engine, session, action, null) }
                            .onSuccess { revealed = it }
                            .onFailure { failure = it.message ?: "That didn't work." }
                        running = false
                    }
                }
            ) { Text(block.str("label").orEmpty()) }
        }
    }
}

/**
 * A picker that rebuilds the content under it — the language switcher.
 *
 * A plain button and a [DropdownMenu] rather than `ExposedDropdownMenuBox`: the
 * latter is a text field that only looks un-editable, and inside a bottom sheet
 * it invites the keyboard up over the very content the choice is about to
 * change. What is wanted here is a menu, so this is a menu.
 *
 * `options` arrives as positional `[code, name]` pairs — the wire form the
 * extension's `<option value=… >` maps onto — so the code is what travels back
 * to the detector and the name is only ever shown.
 */
@Composable
private fun Choice(
    block: JsonObject,
    session: Long?,
    engine: DetectorEngine,
    onOpenRow: (MenuRowData) -> Unit
) {
    val scope = rememberCoroutineScope()
    val action = block.str("action")
    val options = remember(block) { block.pairs("options") }

    var selected by remember(block) { mutableStateOf(block.str("value")) }
    var expanded by remember(block) { mutableStateOf(false) }
    var produced by remember(block) { mutableStateOf<List<JsonObject>?>(null) }
    var running by remember(block) { mutableStateOf(false) }
    var failure by remember(block) { mutableStateOf<String?>(null) }

    /*
     * The current selection renders straight away, without waiting to be
     * changed — which is what makes this a picker over content rather than a
     * control above an empty space. The translation view is the case that
     * needs it: it is "translate into <language>: <answer>" from the first
     * frame, and switching replaces the answer rather than stacking a second
     * one beneath the first.
     *
     * Keyed on `block` alone, not on `selected`, so choosing an option does not
     * run the work twice — the menu item below already runs it.
     */
    LaunchedEffect(block, session) {
        val start = block.str("value")
        if (action == null || session == null || start == null) return@LaunchedEffect
        running = true
        runCatching { runBlocks(engine, session, action, start) }
            .onSuccess { produced = it }
            .onFailure { failure = it.message ?: "That didn't work." }
        running = false
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            block.str("label") ?: "Choose",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Box {
            OutlinedButton(
                enabled = options.isNotEmpty() && action != null && session != null,
                onClick = { expanded = true }
            ) {
                // The name for the current code, falling back to the code
                // itself — a value the detector set but did not list is still
                // more informative shown than blanked out.
                Text(options.firstOrNull { it.first == selected }?.second ?: selected.orEmpty())
                Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
            }

            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { (code, name) ->
                    DropdownMenuItem(
                        text = { Text(name) },
                        onClick = {
                            expanded = false
                            if (action == null || session == null || code == selected) {
                                return@DropdownMenuItem
                            }
                            selected = code
                            running = true
                            failure = null
                            scope.launch {
                                runCatching { runBlocks(engine, session, action, code) }
                                    .onSuccess { produced = it }
                                    .onFailure { failure = it.message ?: "That didn't work." }
                                running = false
                            }
                        }
                    )
                }
            }
        }

        failure?.let { FailureNote(it) }

        when {
            running -> LoadingRow(block.str("busy") ?: "Working…")
            // Whatever the last selection produced replaces whatever the one
            // before it did, which is why this is a single slot and not a list
            // that accumulates.
            produced != null -> NestedBlocks(produced!!, session, engine, onOpenRow)
        }
    }
}

/**
 * The follow-up thread.
 *
 * This is the block that stops an AI answer being a dead end, so it is built to
 * feel like a conversation and not like a form: the question appears the
 * instant it is sent, the reply lands under it, and the field is ready for the
 * next one without anything having to be dismissed.
 *
 * Only the chat id crosses the bridge — the history itself lives in the engine
 * and grows there, so this side holds the exchanges purely to draw them. That
 * also means a failed turn needs no repair here: the bridge pops it off its own
 * history, and all that is owed is putting the question back where the user can
 * press send again.
 */
@Composable
private fun Conversation(block: JsonObject, session: Long?, engine: DetectorEngine) {
    val scope = rememberCoroutineScope()
    val chat = block.str("chat")

    var turns by remember(block) { mutableStateOf(listOf<Pair<String, String>>()) }
    var asking by remember(block) { mutableStateOf<String?>(null) }
    var question by remember(block) { mutableStateOf("") }
    var failure by remember(block) { mutableStateOf<String?>(null) }

    val send = {
        val asked = question.trim()
        if (asked.isNotEmpty() && chat != null && session != null && asking == null) {
            question = ""
            failure = null
            asking = asked
            scope.launch {
                runCatching {
                    val args = buildJsonObject {
                        put("session", session)
                        put("chat", chat)
                        put("question", asked)
                    }
                    /*
                     * A longer leash than the engine's default. Every earlier
                     * turn is resent as context, so the fifth question is a
                     * bigger request than the first, and a thread timing out
                     * because it got interesting is the wrong way to lose one.
                     */
                    engine.call("ask", args, timeoutMs = 60_000).jsonPrimitive.content
                }.onSuccess {
                    turns = turns + (asked to it)
                }.onFailure {
                    failure = it.message ?: "That didn't work."
                    // The question goes back in the field rather than being
                    // retyped: the thread is unchanged on both sides, so
                    // pressing send again simply asks it.
                    question = asked
                }
                asking = null
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        turns.forEach { (asked, reply) ->
            Asked(asked)
            Text(reply, style = MaterialTheme.typography.bodyMedium)
        }

        asking?.let {
            Asked(it)
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        }

        failure?.let { FailureNote(it) }

        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = question,
                onValueChange = { question = it },
                enabled = chat != null && session != null && asking == null,
                placeholder = { Text("Ask a follow-up…") },
                singleLine = true,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(8.dp))
            Button(
                enabled = question.isNotBlank() && chat != null && session != null && asking == null,
                onClick = send
            ) { Text("Ask") }
        }
    }
}

/** One turn from the user, tinted so the thread reads as two voices. */
@Composable
private fun Asked(question: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Surface(
            color = MaterialTheme.colorScheme.secondaryContainer,
            shape = RoundedCornerShape(12.dp)
        ) {
            Text(
                question,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
            )
        }
    }
}

/**
 * A QR code, drawn from the module grid the encoder already produced.
 *
 * Painting it directly is not an economy measure — it is that a QR code is a
 * grid of squares, and a library that turns a grid of squares into a bitmap
 * would be a dependency doing arithmetic this function does in six lines.
 *
 * Two details are what make it scan rather than merely look right. The quiet
 * zone is four modules on every side: the spec requires it, scanners use it to
 * find the symbol's edges, and a code drawn flush to its container is the
 * classic reason one will not read. And the module size is floored to whole
 * pixels with the remainder split as an outer margin, so every square lands on
 * a pixel boundary — at fractional widths the antialiased edges of neighbouring
 * dark modules blend into grey seams, which is exactly the sort of noise a
 * decoder's sampling grid trips over.
 *
 * Black on white regardless of theme, for the same reason: the camera is the
 * reader here, not the user, and it wants contrast in the direction the format
 * specifies rather than whatever the palette is doing tonight.
 */
@Composable
private fun QrCode(block: JsonObject) {
    val grid = remember(block) { block.grid("modules") }
    if (grid.isEmpty()) return

    val quiet = 4
    val span = grid.size + quiet * 2

    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Canvas(
            Modifier
                // Capped rather than filled: on a wide sheet a QR code stretched
                // to the full width is no easier to scan, just louder.
                .sizeIn(maxWidth = 240.dp)
                .fillMaxWidth()
                .aspectRatio(1f)
        ) {
            val module = floor(size.minDimension / span).coerceAtLeast(1f)
            val origin = (size.minDimension - module * span) / 2f

            drawRect(color = Color.White, size = size)

            grid.forEachIndexed { y, row ->
                row.forEachIndexed { x, on ->
                    if (on) drawRect(
                        color = Color.Black,
                        topLeft = Offset(
                            origin + (x + quiet) * module,
                            origin + (y + quiet) * module
                        ),
                        size = Size(module, module)
                    )
                }
            }
        }
    }
}

/**
 * Read aloud.
 *
 * The engine is built on first press rather than on first draw. Constructing a
 * [Speaker] binds to the system synthesis service and warms a voice, which is a
 * real cost to pay for a button that in most sheets is never touched.
 *
 * The `DisposableEffect` is the part that matters. A [android.speech.tts.TextToSpeech]
 * outliving the composable that made it does not merely leak a service
 * connection — it carries on talking, so a sheet dismissed mid-sentence would
 * finish the sentence to an empty screen with no control left to stop it.
 */
@Composable
private fun Speech(block: JsonObject) {
    val context = LocalContext.current
    val text = block.str("text").orEmpty()
    val lang = block.str("lang")

    val holder = remember { mutableStateOf<Speaker?>(null) }
    var speaking by remember(block) { mutableStateOf(false) }

    DisposableEffect(Unit) {
        onDispose {
            holder.value?.shutdown()
            holder.value = null
        }
    }

    Button(
        enabled = text.isNotBlank(),
        onClick = {
            val existing = holder.value
            if (speaking) {
                existing?.stop()
                speaking = false
            } else {
                val speaker = existing
                    ?: Speaker(context) { active -> speaking = active }.also { holder.value = it }
                speaking = true
                speaker.speak(text, lang)
            }
        }
    ) { Text(if (speaking) "Stop" else "Read aloud") }
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/**
 * Blocks that arrived from a control rather than from a view.
 *
 * Spaced the same as the detail view spaces its own blocks, so a disclosure
 * opening does not look like a different kind of content from the section
 * above it.
 */
@Composable
private fun NestedBlocks(
    blocks: List<JsonObject>,
    session: Long?,
    engine: DetectorEngine,
    onOpenRow: (MenuRowData) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        blocks.forEach { BlockView(it, session, engine, onOpenRow) }
    }
}

/** The one bridge method behind both `disclosure` and `choice`. */
private suspend fun runBlocks(
    engine: DetectorEngine,
    session: Long,
    action: String,
    value: String?
): List<JsonObject> {
    val args = buildJsonObject {
        put("session", session)
        put("action", action)
        if (value != null) put("value", value)
    }
    return engine.call("runBlocks", args).jsonArray.map { it.jsonObject }
}

@Composable
private fun FailureNote(message: String) {
    Text(
        message,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error
    )
}

/**
 * A model's answer, with its markdown rendered rather than shown.
 *
 * The parsing is not done here. Every prompt asks for a bare answer, models
 * emit `**bold**` anyway, and the reader that copes with that — including the
 * rules that stop an italic marker eating a snake_case identifier or a
 * multiplication sign — lives in `kit.js` and is tested in Node. The bridge
 * sends its tokens, so this only has to decide what bold looks like.
 *
 * A block with no tokens is plain text and renders as itself, which is also
 * what a partial answer does while it is still streaming: half-written
 * markdown renders as nonsense, so formatting waits for the finished blocks.
 */
@Composable
private fun richText(block: JsonObject): AnnotatedString {
    val tokens = block["tokens"]?.jsonArray
        ?: return AnnotatedString(block.str("text").orEmpty())

    val code = MaterialTheme.colorScheme.surfaceVariant

    return buildAnnotatedString {
        tokens.forEach { entry ->
            val token = entry.jsonObject
            val text = token.str("text").orEmpty()
            when (token.str("tag")) {
                "strong" -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(text) }
                "em" -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(text) }
                "code" -> withStyle(
                    SpanStyle(fontFamily = FontFamily.Monospace, background = code)
                ) { append(text) }
                else -> append(text)
            }
        }
    }
}

private fun JsonObject.str(key: String): String? =
    this[key]?.jsonPrimitive?.contentOrNull

private fun JsonObject.flag(key: String): Boolean =
    this[key]?.jsonPrimitive?.booleanOrNull == true

/**
 * A list of positional `[code, name]` pairs, as `choice.options` arrives.
 *
 * Positional rather than named because the extension's own option lists are
 * pairs — `LANGUAGES` and the currency table both — and giving them keys purely
 * for this crossing would mean reshaping them at the source. Anything that is
 * not a two-element pair of strings is dropped rather than substituted: an
 * option whose code did not survive would run the wrong conversion.
 */
private fun JsonObject.pairs(key: String): List<Pair<String, String>> =
    (this[key] as? JsonArray).orEmpty().mapNotNull { entry ->
        val pair = entry as? JsonArray ?: return@mapNotNull null
        val code = (pair.getOrNull(0) as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
        code to ((pair.getOrNull(1) as? JsonPrimitive)?.contentOrNull ?: code)
    }

/** The QR module matrix: rows of 0/1, read as off/on. */
private fun JsonObject.grid(key: String): List<List<Boolean>> =
    (this[key] as? JsonArray).orEmpty().map { row ->
        (row as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.intOrNull == 1 }
    }

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
