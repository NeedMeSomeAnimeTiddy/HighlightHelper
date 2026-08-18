package com.highlighthelper.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import kotlin.random.Random

/**
 * The tools the user wrote.
 *
 * The `custom` detector has always worked on the phone: it reads `customTools`
 * out of the settings and turns each entry into a menu row that sends the
 * selection to the model under that tool's own system prompt. What was missing
 * was anywhere to type one, so the list was always empty and the detector never
 * matched. This screen is that half and nothing more — the stored shape belongs
 * to `src/common/settings.js`, and what makes a tool usable belongs to
 * `src/content/detectors/custom.js`. Both are mirrored here rather than
 * re-decided, so the app cannot offer a tool the sheet will refuse to show.
 */

/**
 * One entry of `customTools`.
 *
 * These three fields are the whole documented shape, in the extension and in
 * the detector alike, which is what makes rewriting the array from a list of
 * these lossless. If the shape ever grows a fourth field, this is the class
 * that has to learn about it — a rewrite drops what it did not read.
 */
data class CustomTool(val id: String, val name: String, val prompt: String)

/**
 * Reads the stored array into tools the screen can act on.
 *
 * An entry missing a name or a prompt is dropped, because `custom.js` filters
 * on exactly those two before building any rows: listing it here would be the
 * editor claiming a tool is installed when the sheet will never offer it. An
 * entry with no id is dropped for a harder reason — the id is the only handle
 * edit and delete have on a row, and `custom:<id>` is the key the sheet builds
 * from it, so there is nothing to do with one that has none.
 */
fun customToolsFrom(stored: JsonArray): List<CustomTool> = stored.mapNotNull { entry ->
    val row = entry as? JsonObject ?: return@mapNotNull null
    val id = row["id"].asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
    val name = row["name"].asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
    val prompt = row["prompt"].asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
    CustomTool(id, name, prompt)
}

private fun JsonElement?.asText(): String? = (this as? JsonPrimitive)?.contentOrNull

/**
 * A fresh id for a new tool.
 *
 * It has to be unique and it has to never move afterwards: the sheet keys its
 * row on `custom:<id>`, so an id that got reused or renumbered would point a
 * saved reference at somebody else's prompt. Base-36 milliseconds separate
 * tools written at different times; the random suffix separates two written
 * inside the same one. A position in the list would give neither — deleting the
 * first tool would silently renumber every tool after it.
 *
 * The loop covers the cases the clock cannot: a restored backup, or a device
 * whose time went backwards far enough to land on a millisecond already spent.
 */
private fun newToolId(existing: List<CustomTool>): String {
    while (true) {
        val suffix = Random.nextInt(1 shl 16, 1 shl 20).toString(36)
        val id = "${System.currentTimeMillis().toString(36)}-$suffix"
        if (existing.none { it.id == id }) return id
    }
}

/**
 * The patch for the whole list.
 *
 * `SettingsStore.update` shallow-merges, and merges one level deeper only for
 * `detectors` — so there is no such thing as patching a single tool. Every save
 * writes the entire array. That is fine as long as the array being written was
 * derived from the one that was just read, which is why this takes the finished
 * list rather than a diff: there is no place to hold a half-applied edit.
 */
private fun patchFor(tools: List<CustomTool>): JsonObject = buildJsonObject {
    put("customTools", buildJsonArray {
        tools.forEach { tool ->
            add(buildJsonObject {
                put("id", tool.id)
                put("name", tool.name)
                put("prompt", tool.prompt)
            })
        }
    })
}

/**
 * What `fillTemplate` in `src/common/prompts.js` actually substitutes.
 *
 * Exactly these three and no others — a prompt containing anything else keeps
 * it verbatim, and the model is handed the braces. `{text}` is the notable
 * absence: the selection travels as the user turn instead, so that a page
 * cannot get its own words spliced into the sentence telling the model what to
 * do. Said here because a user who is not told will try it.
 */
private val PLACEHOLDERS = listOf(
    "{title}" to "the title of the page the selection came from",
    "{url}" to "that page's address",
    "{lang}" to "the language chosen under Language, spelled out"
)

@Composable
fun CustomToolsScreen(
    tools: List<CustomTool>,
    save: (JsonObject) -> Unit,
    onBack: () -> Unit
) {
    /*
     * The tool the form is working on, or null for the list. Opening "New tool"
     * mints its id up front and starts with empty fields, which makes adding
     * and editing one path: a save replaces the entry carrying this id if the
     * list has one, and appends it otherwise. An id minted for a form that is
     * then cancelled is simply never used — ids are not a sequence, so there is
     * nothing to hand back.
     */
    var editing by remember { mutableStateOf<CustomTool?>(null) }
    var deleting by remember { mutableStateOf<CustomTool?>(null) }

    // Back means "out of the form" while the form is up and "out of the screen"
    // otherwise, so that a half-typed prompt is not one gesture away from the
    // settings screen.
    BackHandler { if (editing != null) editing = null else onBack() }

    val commit: (CustomTool) -> Unit = { tool ->
        val next = if (tools.any { it.id == tool.id }) {
            tools.map { if (it.id == tool.id) tool else it }
        } else {
            tools + tool
        }
        // Nothing is kept locally afterwards: the saved list comes back through
        // the same DataStore flow that produced `tools`, so what is on screen is
        // what is stored rather than what was hoped for.
        save(patchFor(next))
        editing = null
    }

    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        when (val open = editing) {
            null -> ToolList(
                tools = tools,
                onBack = onBack,
                onNew = { editing = CustomTool(newToolId(tools), "", "") },
                onEdit = { editing = it },
                onDelete = { deleting = it }
            )

            else -> ToolEditor(
                tool = open,
                isNew = tools.none { it.id == open.id },
                onSave = commit,
                onCancel = { editing = null }
            )
        }
    }

    // Confirmed rather than undoable: a prompt is something the user wrote by
    // hand, it exists nowhere else on the device, and the delete control sits a
    // thumb's width from the row that opens it for editing.
    deleting?.let { tool ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete “${tool.name}”?") },
            text = { Text("Its prompt is not stored anywhere else, so it cannot be brought back.") },
            confirmButton = {
                TextButton(onClick = {
                    save(patchFor(tools.filterNot { it.id == tool.id }))
                    deleting = null
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun ToolList(
    tools: List<CustomTool>,
    onBack: () -> Unit,
    onNew: () -> Unit,
    onEdit: (CustomTool) -> Unit,
    onDelete: (CustomTool) -> Unit
) {
    TextButton(onClick = onBack) { Text("← Settings") }

    Text("My tools", style = MaterialTheme.typography.headlineSmall)

    Text(
        "A tool is a name and a prompt of your own. Each one becomes a row in " +
            "the selection sheet that sends the selected text to DeepSeek under " +
            "that prompt. One tool is its own row; several share a “My tools” row " +
            "that opens them.",
        style = MaterialTheme.typography.bodyMedium
    )

    HorizontalDivider(Modifier.padding(vertical = 8.dp))

    if (tools.isEmpty()) {
        Note(
            "No tools yet. They are for the thing the twenty-one built-in tools " +
                "do not do — “turn this into a Jira ticket”, “explain this to a " +
                "six-year-old”, “rewrite this as a commit message”."
        )
    }

    tools.forEach { tool ->
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clickable { onEdit(tool) }
        ) {
            Column(Modifier.weight(1f)) {
                Text(tool.name, style = MaterialTheme.typography.bodyLarge)
                Text(
                    // Flattened rather than truncated as written: a prompt is
                    // often several lines, and the first of them is usually the
                    // least informative part of it.
                    tool.prompt.replace(WHITESPACE, " ").trim(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = { onDelete(tool) }) {
                Icon(Icons.Filled.Delete, contentDescription = "Delete ${tool.name}")
            }
        }
    }

    Button(onClick = onNew, modifier = Modifier.padding(top = 8.dp)) { Text("New tool") }
}

private val WHITESPACE = Regex("\\s+")

@Composable
private fun ToolEditor(
    tool: CustomTool,
    isNew: Boolean,
    onSave: (CustomTool) -> Unit,
    onCancel: () -> Unit
) {
    // Keyed on the id so that opening a different tool re-seeds the fields, and
    // so that a recomposition caused by anything else does not throw away what
    // is being typed.
    var name by remember(tool.id) { mutableStateOf(tool.name) }
    var prompt by remember(tool.id) { mutableStateOf(tool.prompt) }

    // Trimmed before they are judged and again before they are saved, because a
    // name of one space passes an isNotEmpty check here and then fails the
    // truthiness check in `custom.js` — which would leave a tool that is listed
    // on this screen and absent from every sheet, with nothing to explain why.
    val cleanName = name.trim()
    val cleanPrompt = prompt.trim()
    val complete = cleanName.isNotEmpty() && cleanPrompt.isNotEmpty()

    Text(
        if (isNew) "New tool" else "Edit tool",
        style = MaterialTheme.typography.headlineSmall
    )

    OutlinedTextField(
        value = name,
        onValueChange = { name = it },
        label = { Text("Name") },
        singleLine = true,
        supportingText = { Text("What the row in the selection sheet says.") },
        modifier = Modifier.fillMaxWidth()
    )

    OutlinedTextField(
        value = prompt,
        onValueChange = { prompt = it },
        label = { Text("Prompt") },
        // Tall by default: this is an instruction to a model, not a field, and
        // a five-line box invites the detail that makes the answers good.
        minLines = 5,
        supportingText = {
            Text(
                "The system instruction. The selected text is sent separately, " +
                    "as the message — write the instruction as if the text will " +
                    "follow it."
            )
        },
        modifier = Modifier.fillMaxWidth()
    )

    Text("Placeholders", style = MaterialTheme.typography.titleSmall)

    PLACEHOLDERS.forEach { (token, meaning) ->
        Text(
            "$token — $meaning",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    Text(
        "There is no {text}: the selection is sent as the message rather than " +
            "pasted into your prompt, so a page cannot slip instructions into it.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )

    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(top = 8.dp)
    ) {
        Button(
            onClick = { onSave(tool.copy(name = cleanName, prompt = cleanPrompt)) },
            enabled = complete
        ) { Text("Save") }

        OutlinedButton(onClick = onCancel) { Text("Cancel") }
    }

    if (!complete) {
        // Disabled buttons do not say why they are disabled, and the reason here
        // is not a house rule: a tool missing either field is skipped by the
        // detector, so saving one would look like the save had failed.
        Text(
            "A tool needs both a name and a prompt. One missing either is " +
                "skipped, and never appears in the sheet.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
