package com.highlighthelper.ui

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.getSystemService
import com.highlighthelper.HighlightHelperApp
import com.highlighthelper.engine.DetectorEngine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit

/**
 * The answers you already asked for.
 *
 * The recording is not done here and deliberately so: `src/common/history.js`
 * runs inside the engine against a storage shim Kotlin owns, so the rules that
 * make this list worth having — truncate a long selection because the point is
 * recognition rather than archive, replace an entry when the same tool is run
 * on the same text, cap the list, newest first — are the extension's own and
 * are stated once. This screen only reads what that file wrote.
 *
 * It is also the most personal thing the app stores. A record of what someone
 * highlighted while reading says more about them than the answers do, so every
 * decision below leans the same way: nothing is fetched that is not shown, the
 * switch that stops the recording is on this screen rather than buried, the
 * clear button says how many entries it is about to destroy before it does it
 * and how many it destroyed afterwards, and neither the list nor the count is
 * reported anywhere off the device.
 */

/**
 * One recorded answer, as `history.js` writes it.
 *
 * Four fields and no id — `action` plus `source` is what that file de-duplicates
 * on, so a pair of them is as close to a stable identity as an entry has, and
 * even that changes the moment the same tool is run on the same text again.
 * Nothing here holds a reference to an entry across a reload for that reason.
 */
private data class HistoryEntry(
    val action: String,
    /**
     * What to call this, when the action id cannot say.
     *
     * Every tool someone writes reports the same action, so without this a
     * history of five custom tools is five rows all labelled "My tools". The
     * record carries the tool's own name when there is one.
     */
    val label: String,
    val source: String,
    val answer: String,
    val at: Long
)

/**
 * One read of the history, with everything the list needs already resolved.
 *
 * `readAt` is captured with the entries rather than read per row: relative times
 * computed during recomposition would drift apart from each other, so "2 hours
 * ago" and "3 hours ago" could end up describing the same instant on the same
 * screen. Fixing the clock at the moment of the read makes the whole list agree.
 */
private class HistoryPage(
    val entries: List<HistoryEntry>,
    val labels: Map<String, String>,
    val readAt: Long
)

/* ------------------------------------------------------------------ *
 * Reading it
 * ------------------------------------------------------------------ */

private suspend fun loadHistory(engine: DetectorEngine): HistoryPage {
    val raw = engine.call("history", JsonObject(emptyMap())) as? JsonArray ?: JsonArray(emptyList())

    // Not re-sorted. The order is `history.js`'s own — it unshifts — and a
    // second opinion about it here would only matter when the device clock had
    // moved, which is exactly when the stored order is the more trustworthy of
    // the two.
    val entries = raw.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val source = row["source"].asString().orEmpty()
        val answer = row["text"].asString().orEmpty()
        // `remember()` refuses to write an entry missing either half, so one
        // arriving here means the stored list was edited or truncated by
        // something else. Dropping it costs a row; drawing it would show the
        // user a question with no answer or an answer to nothing.
        if (source.isBlank() || answer.isBlank()) return@mapNotNull null
        HistoryEntry(
            action = row["action"].asString().orEmpty(),
            label = row["label"].asString().orEmpty(),
            source = source,
            answer = answer,
            at = (row["at"] as? JsonPrimitive)?.longOrNull ?: 0L
        )
    }

    // One call for the whole table rather than one per distinct action — the
    // wording does not vary by entry, and a round trip per row is a round trip
    // per row.
    val titles = actionTitles(engine)
    val labels = entries.map { it.action }.distinct().associateWith { labelFor(titles, it) }
    return HistoryPage(entries, labels, System.currentTimeMillis())
}

/**
 * Human names for action ids, asked for rather than tabulated.
 *
 * `actionTitles` returns the wording the right-click menu is built from —
 * "Fix spelling & grammar", "Key points", "Add comments to this code" — so the
 * history calls a tool what the rest of the app calls it. Keeping a Kotlin
 * table instead would be a second set of names for the same operations, and
 * the first rewording anywhere else would make it wrong without failing.
 *
 * The fallback makes the id readable rather than guessing at a better name: an
 * action the engine has no title for is one this build does not know about,
 * and "Comment code" derived from the record is honest in a way an invented
 * phrase would not be.
 */
private suspend fun actionTitles(engine: DetectorEngine): Map<String, String> =
    runCatching {
        (engine.call("actionTitles", JsonObject(emptyMap())) as JsonObject)
            .mapNotNull { (id, title) -> title.asString()?.let { id to it } }
            .toMap()
    }.getOrDefault(emptyMap())

private fun labelFor(titles: Map<String, String>, action: String): String {
    if (action.isBlank()) return "Answer"
    titles[action]?.takeIf { it.isNotBlank() }?.let { return it }

    return action.replace('-', ' ').replace('_', ' ')
        .replaceFirstChar { it.uppercase() }
}

/**
 * "2 hours ago", the way someone would actually say it.
 *
 * Coarse on purpose. The useful question about a history entry is whether it is
 * from this reading session or an older one, and a timestamp to the minute
 * invites the reader to reconstruct their afternoon from it — which is more
 * precision about a person's browsing than this list needs to carry.
 *
 * Days are counted as calendar days rather than as multiples of 24 hours,
 * because "yesterday" means the day before today: something asked at eleven
 * last night is yesterday at nine this morning, not "10 hours ago".
 */
private fun relativeTime(at: Long, now: Long): String {
    if (at <= 0L) return ""

    val seconds = (now - at) / 1000
    // Negative when the clock has been moved back since the entry was written.
    // "just now" is the least wrong thing to say about an answer from the
    // future, and certainly better than "-3 hours ago".
    if (seconds < 45) return "just now"

    val minutes = seconds / 60
    if (minutes < 2) return "a minute ago"
    if (minutes < 60) return "$minutes minutes ago"

    val hours = minutes / 60
    if (hours < 2) return "an hour ago"

    val zone = ZoneId.systemDefault()
    val then = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()

    return when (val days = ChronoUnit.DAYS.between(then, today)) {
        0L -> "$hours hours ago"
        1L -> "yesterday"
        in 2L..6L -> "$days days ago"
        // Past a week the relative form stops helping — "23 days ago" is
        // arithmetic, not a memory — so it becomes a date, in the phone's own
        // locale rather than this file's idea of one.
        else -> then.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
    }
}

private fun JsonElement?.asString(): String? = (this as? JsonPrimitive)?.contentOrNull

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

/**
 * The settings row that opens the history, and the history itself.
 *
 * Both live in one composable so that reaching this screen costs the settings
 * screen a single line. The screen is presented as a full-screen dialog rather
 * than by swapping the settings content out, which keeps the "which screen is
 * up" question inside this file: the settings screen does not have to hold a
 * flag for a destination it otherwise knows nothing about, and the system back
 * gesture closes the dialog without anyone wiring a handler for it.
 */
@Composable
fun HistoryRow(app: HighlightHelperApp) {
    var open by remember { mutableStateOf(false) }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable { open = true }
    ) {
        Column(Modifier.weight(1f)) {
            Text("History", style = MaterialTheme.typography.bodyLarge)
            Text(
                "The answers you have already asked for, and the button that " +
                    "throws them away.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
    }

    if (open) {
        Dialog(
            onDismissRequest = { open = false },
            // The platform default is a centred card with margins around it,
            // which is the wrong shape for a scrolling list of long answers.
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Surface(Modifier.fillMaxSize()) {
                HistoryScreen(app, onBack = { open = false })
            }
        }
    }
}

@Composable
private fun HistoryScreen(app: HighlightHelperApp, onBack: () -> Unit) {

    val scope = rememberCoroutineScope()

    /*
     * Bumped to re-read. The list is not patched in place after a clear: the
     * engine owns the stored list, so the honest way to show what is there
     * afterwards is to ask it again rather than to assume the write did what
     * was asked.
     */
    var round by remember { mutableIntStateOf(0) }

    val loaded by produceState<Result<HistoryPage>?>(null, round) {
        value = runCatching { loadHistory(app.engine) }
    }

    // Straight off DataStore, like the settings screen, so the toggle below
    // reflects what is stored rather than what was last tapped. `keepHistory`
    // defaults to true in `src/common/settings.js`, and only an explicit `false`
    // override switches it off.
    val overrides by app.settings.overrides.collectAsState(initial = null)
    val keeping = (overrides?.get("keepHistory") as? JsonPrimitive)?.booleanOrNull ?: true

    var confirming by remember { mutableStateOf(false) }
    var report by remember { mutableStateOf<String?>(null) }

    val page = loaded?.getOrNull()

    Column(Modifier.fillMaxSize()) {

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 8.dp)
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text("History", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))

            // Only offered when there is something to destroy, and coloured as
            // the destructive action it is. It sits in the header rather than
            // under sixty entries because a control for getting rid of all of
            // this should not require scrolling through all of it first.
            if (page != null && page.entries.isNotEmpty()) {
                TextButton(
                    onClick = { confirming = true },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) { Text("Clear") }
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(start = 24.dp, end = 24.dp, bottom = 24.dp)
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "What you highlighted and what came back. Kept on this " +
                            "device, never synced, and only the last 60 answers.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    KeepHistorySwitch(keeping) { next ->
                        scope.launch {
                            app.settings.update(buildJsonObject { put("keepHistory", next) })
                        }
                    }

                    report?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    HorizontalDivider(Modifier.padding(top = 4.dp))
                }
            }

            when {
                loaded?.isFailure == true -> item {
                    Note(
                        "The history could not be read: it is kept by the " +
                            "detector engine rather than as a second copy here, " +
                            "and the engine did not answer. " +
                            loaded?.exceptionOrNull()?.message.orEmpty()
                    )
                }

                page == null -> item { LoadingRow("Reading the history from the engine…") }

                page.entries.isEmpty() -> item { EmptyHistory(keeping) }

                else -> items(page.entries) { entry ->
                    HistoryItem(
                        entry = entry,
                        // The record's own label wins: only it can tell one
                        // user-written tool from another, since they all report
                        // the same action id.
                        label = entry.label.ifBlank { page.labels[entry.action] ?: entry.action },
                        ago = relativeTime(entry.at, page.readAt)
                    )
                    HorizontalDivider()
                }
            }
        }
    }

    if (confirming) {
        val count = page?.entries?.size ?: 0
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Clear history?") },
            text = {
                // Says what actually goes, in the user's terms rather than the
                // storage's: an "entry" is a thing they highlighted plus the
                // answer they got, and both halves are destroyed. It also says
                // what clearing does not do, because a button that quietly left
                // the recording running would be the more alarming surprise.
                Text(
                    "This deletes " +
                        when (count) {
                            1 -> "the one entry"
                            else -> "all $count entries"
                        } +
                        " — every selection and every answer, permanently, with " +
                        "no copy anywhere else to restore from. Answers will " +
                        "keep being recorded afterwards unless you switch that " +
                        "off as well."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        scope.launch {
                            val cleared = runCatching {
                                (app.engine.call("clearHistory", JsonObject(emptyMap())) as? JsonPrimitive)
                                    ?.intOrNull ?: 0
                            }
                            // The engine counts before it empties, so this is a
                            // number the user can check against what they were
                            // just looking at — which is the difference between
                            // being told it worked and being shown that it did.
                            report = cleared.fold(
                                onSuccess = { removed ->
                                    when (removed) {
                                        0 -> "There was nothing to clear."
                                        1 -> "Cleared 1 entry."
                                        else -> "Cleared $removed entries."
                                    }
                                },
                                onFailure = { "Nothing was cleared: ${it.message}" }
                            )
                            round++
                        }
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) { Text("Clear it all") }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text("Keep it") }
            }
        )
    }
}

@Composable
private fun KeepHistorySwitch(keeping: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    ) {
        Column(Modifier.weight(1f)) {
            Text("Keep a history", style = MaterialTheme.typography.bodyLarge)
            Text(
                // The second sentence is the part people get wrong about
                // switches like this one. Turning it off stops the recording;
                // it does not retract what was already recorded, and saying so
                // is cheaper than letting someone find out later.
                "Off means no new answers are written down. What is already " +
                    "here stays until it is cleared.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Switch(checked = keeping, onCheckedChange = onChange)
    }
}

/**
 * Why the list might be empty, which is two quite different situations.
 *
 * "Nothing here" reads as a fault when the reason is that the feature is off,
 * so the switched-off case says so and points at the switch immediately above
 * it. The other case is worth spending a sentence on too: most of what this app
 * does never involves the model at all, and someone who has been converting
 * currencies all week has a legitimate reason to expect a history and find none.
 */
@Composable
private fun EmptyHistory(keeping: Boolean) {
    Column(
        Modifier.padding(vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (!keeping) {
            Text("History is switched off.", style = MaterialTheme.typography.bodyLarge)
            Text(
                "Nothing new is being written down, so nothing will appear " +
                    "here. Turn “Keep a history” back on above and answers " +
                    "will start being recorded again.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            Text("Nothing here yet.", style = MaterialTheme.typography.bodyLarge)
            Text(
                "Only answers from the model are recorded — explaining, " +
                    "translating, summarising, rewriting and your own tools. " +
                    "Conversions, the calculator, colours, dates and the text " +
                    "tools are worked out on the phone and never written down.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                "It can also be switched off entirely with “Keep a history” " +
                    "above, and it only ever holds the last 60 answers.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * One entry: what was asked, what it was asked about, and what came back.
 *
 * The answer is collapsed and opens on a tap. A summary can run to two thousand
 * characters, and three of them expanded would be the whole screen — but
 * truncating without a way to open it would make the list a teaser for a record
 * the user cannot actually read, which is the wrong trade for their own data.
 */
@Composable
private fun HistoryItem(entry: HistoryEntry, label: String, ago: String) {
    var expanded by remember { mutableStateOf(false) }

    // Whether there is anything behind the fold, guessed from the text rather
    // than measured. A layout callback would be exact, but the cost of being
    // wrong here is an expander that opens onto nothing much, and it is worth
    // less than the recomposition it would take to be sure.
    val long = entry.answer.length > 160 || entry.answer.count { it == '\n' } > 2

    Column(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = long) { expanded = !expanded }
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text(
                ago,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // The selection, drawn the way the sheet draws a quote, so the thing
        // that was asked about is visibly not the answer to it.
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(8.dp)
        ) {
            Text(
                entry.source,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = if (expanded) Int.MAX_VALUE else 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(12.dp)
            )
        }

        Text(
            entry.answer,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = if (expanded) Int.MAX_VALUE else 3,
            overflow = TextOverflow.Ellipsis
        )

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            CopyAnswer(entry.answer)
            if (long) {
                TextButton(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "Show less" else "Show all")
                }
            }
        }
    }
}

/**
 * Copies the answer, and says so on itself — the same choice the sheet's copy
 * button makes, and for the same reason: the answer to "did that work" belongs
 * on the thing that was pressed.
 */
@Composable
private fun CopyAnswer(text: String) {
    val context = LocalContext.current
    var label by remember { mutableStateOf("Copy") }

    LaunchedEffect(label) {
        if (label != "Copy") {
            delay(1400)
            label = "Copy"
        }
    }

    TextButton(onClick = {
        val clipboard = context.getSystemService<ClipboardManager>()
        label = if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("Highlight Helper", text))
            "Copied"
        } else {
            "Copy failed"
        }
    }) { Text(label) }
}
