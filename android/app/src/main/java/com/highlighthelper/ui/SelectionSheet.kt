package com.highlighthelper.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
// Explicit rather than a star import: `engine.Row` and Compose's `Row` layout
// would otherwise both be in scope unqualified, and neither wins.
import com.highlighthelper.engine.DetectorEngine
import com.highlighthelper.engine.Detection
import com.highlighthelper.engine.HostServices
import com.highlighthelper.engine.View
import com.highlighthelper.engine.Row as MenuRowData
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/**
 * The panel, as a bottom sheet.
 *
 * Same model as the extension: a menu of what can be done with the selection,
 * drilling into a detail view, with a back arrow returning. What changes is the
 * shape — a sheet pinned to the bottom of the screen rather than a popover
 * beside the text, because on a phone the selection is under the user's thumb
 * and the OS already owns the space around it with its own drag handles.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectionSheet(
    text: String,
    canReplace: Boolean,
    engine: DetectorEngine,
    services: HostServices,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true; encodeDefaults = true } }

    var session by remember { mutableStateOf<Long?>(null) }
    var stack by remember { mutableStateOf(listOf<Screen>()) }
    var error by remember { mutableStateOf<String?>(null) }

    /*
     * Detection starts here rather than in the activity, so the sheet is already
     * on screen showing the selection while it runs. The extension's rows can
     * resolve late and the panel is built for it; the same is true here, and it
     * is what makes a cold engine survivable.
     */
    LaunchedEffect(text) {
        engine.services = services
        runCatching {
            val args = buildJsonObject {
                put("text", text)
                put("canReplace", canReplace)
                put("settings", JsonObject(emptyMap()))
            }
            json.decodeFromJsonElement<Detection>(engine.call("detect", args))
        }.onSuccess {
            session = it.session
            stack = listOf(Screen.Menu(title = null, rows = it.rows))
        }.onFailure {
            error = it.message ?: "Detection failed"
        }
    }

    val back: () -> Unit = { if (stack.size > 1) stack = stack.dropLast(1) else onDismiss() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(Modifier.padding(bottom = 24.dp)) {

            SheetHeader(
                snippet = text,
                title = (stack.lastOrNull() as? Screen.Detail)?.title,
                canGoBack = stack.size > 1,
                onBack = back
            )

            HorizontalDivider()

            Box(Modifier.heightIn(min = 96.dp)) {
                when {
                    error != null -> ErrorNote(error!!) { onDismiss() }

                    stack.isEmpty() -> LoadingRow("Looking at the selection…")

                    else -> when (val screen = stack.last()) {
                        is Screen.Menu -> RowList(
                            rows = screen.rows,
                            session = session,
                            engine = engine,
                            json = json,
                            onOpen = { row ->
                                scope.launch {
                                    val id = session ?: return@launch
                                    runCatching {
                                        val args = buildJsonObject {
                                            put("session", id); put("key", row.key)
                                        }
                                        json.decodeFromJsonElement<View>(engine.call("openRow", args))
                                    }.onSuccess { view ->
                                        stack = stack + screenFor(row.detailTitle, view)
                                    }.onFailure {
                                        error = it.message
                                    }
                                }
                            }
                        )

                        is Screen.Detail -> DetailView(
                            screen = screen,
                            session = session,
                            engine = engine,
                            json = json,
                            onOpenRow = { row ->
                                scope.launch {
                                    val id = session ?: return@launch
                                    runCatching {
                                        val args = buildJsonObject {
                                            put("session", id); put("key", row.key)
                                        }
                                        json.decodeFromJsonElement<View>(engine.call("openRow", args))
                                    }.onSuccess { view ->
                                        stack = stack + screenFor(row.detailTitle, view)
                                    }.onFailure { error = it.message }
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}

private fun screenFor(title: String, view: View): Screen =
    if (view.kind == "menu") Screen.Menu(title, view.rows) else Screen.Detail(title, view)

sealed interface Screen {
    data class Menu(val title: String?, val rows: List<MenuRowData>) : Screen
    data class Detail(val title: String, val view: View) : Screen
}

@Composable
private fun SheetHeader(
    snippet: String,
    title: String?,
    canGoBack: Boolean,
    onBack: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        if (canGoBack) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text(
                text = title.orEmpty(),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        } else {
            // The selection itself, so the sheet says what it is acting on
            // before any detection has finished.
            Text(
                text = "“" + snippet.replace(Regex("\\s+"), " ").trim().take(64) + "”",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp)
            )
        }
    }
}

@Composable
private fun RowList(
    rows: List<MenuRowData>,
    session: Long?,
    engine: DetectorEngine,
    json: Json,
    onOpen: (MenuRowData) -> Unit
) {
    if (rows.isEmpty()) {
        Note("Nothing to convert, explain or rewrite in this selection.")
        return
    }
    Column(Modifier.verticalScroll(rememberScrollState())) {
        rows.forEach { row -> MenuRow(row, session, engine, json, onOpen) }
    }
}

@Composable
private fun MenuRow(
    row: MenuRowData,
    session: Long?,
    engine: DetectorEngine,
    json: Json,
    onOpen: (MenuRowData) -> Unit
) {
    // A row whose value is a task resolves after the row is on screen, which is
    // the extension's behaviour too: the menu appears at once and the answers
    // land into it.
    var resolved by remember(row.key) { mutableStateOf(row.value?.text) }
    var failed by remember(row.key) { mutableStateOf(false) }

    if (row.value?.kind == "task" && session != null) {
        LaunchedEffect(row.key, session) {
            runCatching {
                val args = buildJsonObject { put("session", session); put("key", row.key) }
                engine.call("rowValue", args).jsonPrimitive.content
            }.onSuccess { resolved = it }.onFailure { failed = true }
        }
    }

    val enabled = row.hasDetail && row.supported

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .then(if (enabled) Modifier.clickable { onOpen(row) } else Modifier)
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        Column(Modifier.weight(1f)) {
            Text(row.label, style = MaterialTheme.typography.bodyLarge)
            if (!row.supported) {
                Text(
                    "Not available in the app yet",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        when {
            failed -> Text("—", color = MaterialTheme.colorScheme.error)
            resolved != null -> Text(
                resolved!!,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            row.value?.kind == "task" -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        }

        if (enabled) {
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun DetailView(
    screen: Screen.Detail,
    session: Long?,
    engine: DetectorEngine,
    json: Json,
    onOpenRow: (MenuRowData) -> Unit
) {
    val view = screen.view
    var blocks by remember(screen) { mutableStateOf(view.blocks) }
    var running by remember(screen) { mutableStateOf(view.kind == "async" || view.kind == "stream") }
    var failure by remember(screen) { mutableStateOf<String?>(null) }

    if ((view.kind == "async" || view.kind == "stream") && session != null && view.viewId != null) {
        LaunchedEffect(screen, session) {
            runCatching {
                val args = buildJsonObject { put("session", session); put("view", view.viewId) }
                engine.call("runView", args).jsonArray.map { it.jsonObject }
            }.onSuccess { blocks = it; running = false }
                .onFailure { failure = it.message ?: "That didn't work."; running = false }
        }
    }

    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        when {
            running -> LoadingRow(view.loading)
            failure != null -> Note(failure!!)
            else -> blocks.forEach { block ->
                BlockView(block, session, engine, onOpenRow)
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
fun LoadingRow(label: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(16.dp)
    ) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(12.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun Note(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(16.dp)
    )
}

@Composable
private fun ErrorNote(message: String, onDismiss: () -> Unit) {
    Column(Modifier.padding(16.dp)) {
        Text(message, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onDismiss) { Text("Close") }
    }
}
