package com.highlighthelper

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.highlighthelper.engine.OAuthService
import com.highlighthelper.ui.CustomToolsScreen
import com.highlighthelper.ui.HistoryRow
import com.highlighthelper.ui.LoadingRow
import com.highlighthelper.ui.Note
import com.highlighthelper.ui.customToolsFrom
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import kotlin.math.roundToInt

/**
 * Settings.
 *
 * The screen holds no opinions of its own. Every default, every detector, every
 * language and every currency code comes off the `defaults` bridge method, which
 * reads them from the same `src/common/settings.js` and detector registry the
 * extension uses — so adding a detector or a currency to the shared source shows
 * up here without anyone remembering to edit Kotlin. A hand-kept copy would not
 * fail loudly when it fell behind; it would just quietly offer the wrong list.
 *
 * What is stored is the other half of the same idea: [SettingsStore] holds only
 * the keys the user actually changed, and the engine merges them over its own
 * DEFAULTS on the way in. So a value shown here is the override if there is one
 * and the engine's default otherwise, and a setting the user has never touched
 * keeps tracking the default when the default moves.
 *
 * `customTools` is the one setting that is not a row: it needs a prompt editor,
 * so it is a row that opens [CustomToolsScreen] instead.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as HighlightHelperApp

        setContent {
            MaterialTheme {
                Surface {
                    SettingsScreen(app)
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ *
 * The engine's answer
 * ------------------------------------------------------------------ */

/**
 * The `defaults` payload, unpacked once.
 *
 * `languages` and `currencies` arrive as pairs of positional JSON arrays rather
 * than objects, because they are the extension's own `[code, name]` tables
 * crossing the bridge as they stand. Anything malformed is dropped rather than
 * thrown on: a single bad row should cost one entry in a picker, not the whole
 * settings screen.
 */
private class EngineDefaults(payload: JsonObject) {

    val settings: JsonObject = payload["settings"]?.jsonObjectOrNull() ?: JsonObject(emptyMap())

    val detectors: List<Pair<String, String>> =
        payload["registry"]?.jsonArrayOrNull().orEmpty().mapNotNull { entry ->
            val row = entry.jsonObjectOrNull() ?: return@mapNotNull null
            val id = row["id"]?.text() ?: return@mapNotNull null
            id to (row["title"]?.text() ?: id)
        }

    val languages: List<Pair<String, String>> = payload["languages"].asCodeNamePairs()

    val currencies: List<Pair<String, String>> = payload["currencies"].asCodeNamePairs()

    /**
     * The model services, straight off `src/common/providers.js`.
     *
     * Same reasoning as the lists above, with more at stake: an endpoint kept
     * in Kotlin as well as in the registry is an endpoint that can disagree
     * with the one the engine resolved, and the failure would be a request sent
     * somewhere nobody chose.
     */
    val providers: List<ProviderInfo> =
        payload["providers"]?.jsonArrayOrNull().orEmpty().mapNotNull { entry ->
            val row = entry.jsonObjectOrNull() ?: return@mapNotNull null
            val id = row["id"]?.text() ?: return@mapNotNull null
            ProviderInfo(
                id = id,
                name = row["name"]?.text() ?: id,
                models = row["models"]?.jsonArrayOrNull().orEmpty().mapNotNull { it.text() },
                defaultModel = row["defaultModel"]?.text().orEmpty(),
                keysAt = row["keysAt"]?.text().orEmpty(),
                keyHint = row["keyHint"]?.text().orEmpty(),
                note = row["note"]?.text().orEmpty(),
                needsKey = (row["needsKey"] as? JsonPrimitive)?.booleanOrNull ?: true,
                editableEndpoint = (row["editableEndpoint"] as? JsonPrimitive)?.booleanOrNull ?: false,
                auth = row["auth"]?.text() ?: "key"
            )
        }

    /** The per-detector defaults, which live under `settings`, not `detectors`. */
    private val detectorDefaults: JsonObject =
        settings["detectors"]?.jsonObjectOrNull() ?: JsonObject(emptyMap())

    fun defaultFor(id: String): Boolean =
        detectorDefaults[id]?.jsonPrimitive?.booleanOrNull ?: true
}

/** One row of the provider registry, as the settings screen needs it. */
data class ProviderInfo(
    val id: String,
    val name: String,
    val models: List<String>,
    val defaultModel: String,
    val keysAt: String,
    val keyHint: String,
    val note: String,
    val needsKey: Boolean,
    val editableEndpoint: Boolean,
    /** "key" or "oauth" — whether the credential is pasted or signed in for. */
    val auth: String
)

private fun JsonElement?.asCodeNamePairs(): List<Pair<String, String>> =
    this?.jsonArrayOrNull().orEmpty().mapNotNull { entry ->
        val pair = entry.jsonArrayOrNull() ?: return@mapNotNull null
        val code = pair.getOrNull(0)?.text() ?: return@mapNotNull null
        code to (pair.getOrNull(1)?.text() ?: code)
    }

private fun JsonElement.jsonObjectOrNull(): JsonObject? = this as? JsonObject
private fun JsonElement.jsonArrayOrNull(): JsonArray? = this as? JsonArray
private fun JsonElement.text(): String? = (this as? JsonPrimitive)?.contentOrNull

/**
 * One setting, read the way the engine will read it.
 *
 * Two lookups in a fixed order and nothing else. Writing it once here means no
 * row can accidentally invent its own fallback, which is how the app and the
 * engine would end up disagreeing about what "unset" means.
 */
private class Settings(private val overrides: JsonObject, val defaults: EngineDefaults) {

    fun string(key: String): String =
        (overrides[key] ?: defaults.settings[key])?.text().orEmpty()

    /** A setting whose value is an object rather than a scalar — `oauth`. */
    fun obj(key: String): JsonObject =
        (overrides[key] as? JsonObject) ?: (defaults.settings[key] as? JsonObject)
            ?: JsonObject(emptyMap())

    fun int(key: String, fallback: Int): Int =
        (overrides[key] ?: defaults.settings[key])?.let { (it as? JsonPrimitive)?.intOrNull }
            ?: fallback

    /**
     * A list-valued setting, read the same two ways round as the scalars.
     *
     * There is no third lookup and no literal empty list standing in for a
     * default the engine already publishes — `customTools: []` is declared in
     * `src/common/settings.js`, and an empty array here means the engine sent
     * something that was not a list at all.
     */
    fun array(key: String): JsonArray =
        (overrides[key] ?: defaults.settings[key])?.jsonArrayOrNull() ?: JsonArray(emptyList())

    fun detectorOn(id: String): Boolean =
        overrides["detectors"]?.jsonObjectOrNull()?.get(id)?.jsonPrimitive?.booleanOrNull
            ?: defaults.defaultFor(id)
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

@Composable
private fun SettingsScreen(app: HighlightHelperApp) {

    val scope = rememberCoroutineScope()

    /*
     * Asking the engine means starting a WebView and importing the module tree,
     * which is the slowest thing on this screen by a wide margin. It runs in
     * produceState so the API key section — the one setting that needs nothing
     * from the engine — is usable immediately, and the rest fills in behind it.
     */
    val loaded by produceState<Result<EngineDefaults>?>(null) {
        value = runCatching {
            EngineDefaults(app.engine.call("defaults", JsonObject(emptyMap())) as JsonObject)
        }
    }

    // Straight off DataStore rather than a local copy, so a save is reflected by
    // the same read path that produced the value in the first place. There is no
    // "I saved that, now let me also remember it" step to get wrong.
    val overrides by app.settings.overrides.collectAsState(initial = null)

    val save: (JsonObject) -> Unit = { patch -> scope.launch { app.settings.update(patch) } }

    val defaults = loaded?.getOrNull()
    val current = overrides
    val settings = if (defaults != null && current != null) Settings(current, defaults) else null

    /*
     * Which of the two screens is up. A boolean rather than a navigation
     * library or a second Activity: there is one destination, it is reached
     * from one row, and everything it needs is already resolved here. Keeping
     * it inside this composable also means coming back is free — leaving for an
     * Activity of its own would tear this one down and pay for the engine's
     * `defaults` call again on the way back.
     */
    var editingTools by remember { mutableStateOf(false) }

    if (editingTools && settings != null) {
        CustomToolsScreen(
            tools = customToolsFrom(settings.array("customTools")),
            save = save,
            onBack = { editingTools = false }
        )
        return
    }

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

        ProviderSection(
            app = app,
            providers = defaults?.providers.orEmpty(),
            settings = settings,
            save = save
        )

        when {
            loaded?.isFailure == true -> {
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Note(
                    "The detector engine did not start, so the rest of the " +
                        "settings cannot be shown: they are read from it rather " +
                        "than kept as a second copy here. " +
                        loaded?.exceptionOrNull()?.message.orEmpty()
                )
            }

            settings == null ->
                LoadingRow("Reading the defaults from the engine…")

            else -> {
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                ConversionsSection(settings, save)

                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                LanguageSection(settings, save)

                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                DetectorsSection(settings, save)

                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                CustomToolsRow(customToolsFrom(settings.array("customTools")).size) {
                    editingTools = true
                }

                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                StorageSection(app, settings, save)

                // Next to storage because that is what it is — the other thing
                // this app keeps on the device, and the more personal of the
                // two. The row carries its own screen, so nothing about the
                // history is decided here.
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                HistoryRow(app)
            }
        }
    }
}

/**
 * Which service answers, and the key for it.
 *
 * Deliberately still above the engine gate, and deliberately able to render
 * without it: when the WebView fails to start this is the one section that has
 * to keep working, because a wrong or missing key is one of the few causes a
 * user can actually fix. Without the engine there is no list to pick from, so
 * it falls back to a bare key field for whichever service was last saved.
 */
@Composable
private fun ProviderSection(
    app: HighlightHelperApp,
    providers: List<ProviderInfo>,
    settings: Settings?,
    save: (JsonObject) -> Unit
) {
    val links = LocalUriHandler.current

    val serviceId = settings?.string("aiService")?.ifEmpty { null } ?: DEFAULT_SERVICE
    val entry = providers.firstOrNull { it.id == serviceId }
    val name = entry?.name ?: serviceId.replaceFirstChar { it.uppercase() }

    // Keyed on the service, so switching the picker shows that service's saved
    // key rather than carrying the previous one across into a field that would
    // then overwrite it on Save.
    var key by remember(serviceId) { mutableStateOf(app.secrets.keyFor(serviceId)) }
    var model by remember(serviceId) { mutableStateOf(settings?.string("model").orEmpty()) }
    var endpoint by remember(serviceId) { mutableStateOf(settings?.string("aiEndpoint").orEmpty()) }
    var saved by remember(serviceId) { mutableStateOf(false) }

    SectionHeader(
        "Which service",
        "Needed for explain, translate, summarise, rewrite and the code " +
            "tools. Conversions, the calculator, colours, dates, regex and the " +
            "text tools all work without any of this."
    )

    if (providers.isNotEmpty()) {
        PickerSetting(
            label = "Service",
            options = providers.map { it.id to it.name },
            selected = serviceId,
            showCode = false,
            onPick = { picked ->
                /*
                 * The model and endpoint are cleared, not kept. A stored
                 * `deepseek-chat` following someone to OpenAI is a 404 that
                 * reads like a broken app, and empty already means "this
                 * service's own default" everywhere it is read.
                 */
                model = ""
                endpoint = ""
                save(buildJsonObject {
                    put("aiService", picked)
                    put("model", "")
                    put("aiEndpoint", "")
                })
            }
        )
    }

    if (entry?.note?.isNotEmpty() == true) {
        Text(
            entry.note,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    if (entry?.editableEndpoint == true) {
        OutlinedTextField(
            value = endpoint,
            onValueChange = { endpoint = it; saved = false },
            label = { Text("Endpoint") },
            placeholder = { Text("https://…/v1/chat/completions") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth()
        )
    }

    if (entry?.auth == "oauth") {
        SignInSection(app, settings, save)
    }

    if (entry == null || (entry.needsKey && entry.auth != "oauth")) {
        OutlinedTextField(
            value = key,
            onValueChange = { key = it; saved = false },
            label = { Text("API key") },
            placeholder = { Text(entry?.keyHint.orEmpty().ifEmpty { "…" }) },
            singleLine = true,
            // Masked by default: this is a credential, and the
            // screen it is typed on is over whatever app the
            // user was reading.
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth()
        )
    }

    OutlinedTextField(
        value = model,
        onValueChange = { model = it; saved = false },
        label = { Text("Model") },
        placeholder = { Text(entry?.defaultModel.orEmpty().ifEmpty { "model id" }) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth()
    )

    /*
     * Suggestions rather than a menu. Model ids change faster than this app
     * ships, so the field stays free text and these are shortcuts — a picker
     * would eventually be a list of names that no longer exist, with no way to
     * type the one that does.
     */
    if (entry?.models?.isNotEmpty() == true) {
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            entry.models.forEach { suggestion ->
                AssistChip(
                    onClick = { model = suggestion; saved = false },
                    label = { Text(suggestion) }
                )
            }
        }
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = {
            app.secrets.setKey(serviceId, key)
            save(buildJsonObject {
                put("aiService", serviceId)
                put("model", model.trim())
                put("aiEndpoint", endpoint.trim())
            })
            saved = true
        }) { Text(if (saved) "Saved" else "Save") }

        if (app.secrets.hasKeyFor(serviceId)) {
            OutlinedButton(onClick = {
                app.secrets.setKey(serviceId, "")
                key = ""
                saved = false
            }) { Text("Forget the key") }
        }

        if (entry?.keysAt?.isNotEmpty() == true) {
            TextButton(onClick = { links.openUri(entry.keysAt) }) { Text("Get a key") }
        }
    }

    Text(
        "Each service keeps its own key, stored encrypted on this device and " +
            "sent nowhere but that service. A key never reaches the app the " +
            "selection came from, and never enters the detector engine.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )

    Text(
        "These are API keys, billed per request — a ChatGPT Plus or Claude.ai " +
            "subscription does not cover them. Spending a subscription needs the " +
            "provider's own signed client, which is a desktop program; see " +
            "OAUTH.md in the repository.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}

/** Matches DEFAULT_PROVIDER in src/common/providers.js — used only before the engine answers. */
private const val DEFAULT_SERVICE = "deepseek"

/**
 * Signing in, rather than pasting a key.
 *
 * Five public values and two buttons. Nothing here is a secret — a client id is
 * a public identifier and the URLs belong to whoever runs the server — so these
 * live in ordinary settings, while the tokens the flow produces go into the
 * keystore beside the API keys.
 *
 * The sign-in itself opens a Custom Tab on the provider's own site. This screen
 * never sees a password, which is the reason to offer it at all.
 */
@Composable
private fun SignInSection(
    app: HighlightHelperApp,
    settings: Settings?,
    save: (JsonObject) -> Unit
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val stored = settings?.obj("oauth")

    fun stored(field: String) = (stored?.get(field) as? JsonPrimitive)?.contentOrNull.orEmpty()

    var clientId by remember(stored) { mutableStateOf(stored("clientId")) }
    var authUrl by remember(stored) { mutableStateOf(stored("authUrl")) }
    var tokenUrl by remember(stored) { mutableStateOf(stored("tokenUrl")) }
    var scopeValue by remember(stored) { mutableStateOf(stored("scope")) }
    var audience by remember(stored) { mutableStateOf(stored("audience")) }

    var status by remember { mutableStateOf(app.oauth.describe("oauth")) }
    var busy by remember { mutableStateOf(false) }

    val persist = {
        save(buildJsonObject {
            put("oauth", buildJsonObject {
                put("clientId", clientId.trim())
                put("authUrl", authUrl.trim())
                put("tokenUrl", tokenUrl.trim())
                put("scope", scopeValue.trim())
                put("audience", audience.trim())
            })
        })
    }

    OutlinedTextField(
        value = clientId,
        onValueChange = { clientId = it },
        label = { Text("Client ID") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth()
    )
    Text(
        "Issued to you by whoever runs the sign-in server. There is no client " +
            "secret: a secret shipped inside an installable app would not be one.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )

    OutlinedTextField(
        value = authUrl,
        onValueChange = { authUrl = it },
        label = { Text("Authorization URL") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth()
    )

    OutlinedTextField(
        value = tokenUrl,
        onValueChange = { tokenUrl = it },
        label = { Text("Token URL") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth()
    )

    OutlinedTextField(
        value = scopeValue,
        onValueChange = { scopeValue = it },
        label = { Text("Scope") },
        placeholder = { Text("openid profile offline_access") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth()
    )
    Text(
        "Include whatever your server wants for a refresh token — usually " +
            "offline_access. Without one you are signed out when the token expires.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )

    OutlinedTextField(
        value = audience,
        onValueChange = { audience = it },
        label = { Text("Audience (optional)") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth()
    )

    /*
     * Shown rather than assumed. This exact string has to be on the server's
     * allow-list or the sign-in fails at the very last step, with an error that
     * comes from the server and mentions nothing this app controls.
     */
    Text(
        "Redirect URI to register: ${OAuthService.REDIRECT_URI}",
        style = MaterialTheme.typography.bodySmall
    )

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            enabled = !busy && clientId.isNotBlank() && authUrl.isNotBlank() && tokenUrl.isNotBlank(),
            onClick = {
                // Saved first, so the flow reads the same values that are on
                // screen — a client id typed but not stored would fail in a way
                // that points at the server rather than at the form.
                persist()
                busy = true
                status = "Opening the sign-in page…"
                scope.launch {
                    status = try {
                        app.oauth.signIn(
                            "oauth",
                            OAuthService.Config(
                                clientId = clientId.trim(),
                                authUrl = authUrl.trim(),
                                tokenUrl = tokenUrl.trim(),
                                scope = scopeValue.trim(),
                                audience = audience.trim()
                            )
                        )
                        app.oauth.describe("oauth")
                    } catch (err: Throwable) {
                        err.message ?: "Sign-in failed."
                    }
                    busy = false
                }
            }
        ) { Text("Sign in") }

        OutlinedButton(onClick = {
            persist()
        }) { Text("Save") }

        TextButton(onClick = {
            app.oauth.signOut("oauth")
            status = app.oauth.describe("oauth")
        }) { Text("Sign out") }

        TextButton(onClick = {
            clipboard.setText(AnnotatedString(OAuthService.REDIRECT_URI))
        }) { Text("Copy URI") }
    }

    Text(
        status,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}

@Composable
private fun ConversionsSection(settings: Settings, save: (JsonObject) -> Unit) {
    SectionHeader(
        "Conversions",
        "What amounts and measurements are converted into when a selection " +
            "contains one."
    )

    PickerSetting(
        label = "Convert currency to",
        options = settings.defaults.currencies,
        selected = settings.string("targetCurrency"),
        onPick = { save(buildJsonObject { put("targetCurrency", it) }) }
    )

    val imperial = settings.string("unitSystem") == "imperial"

    ChoiceSetting(
        label = "Units",
        options = listOf("metric" to "Metric", "imperial" to "Imperial"),
        selected = settings.string("unitSystem"),
        onPick = { save(buildJsonObject { put("unitSystem", it) }) }
    )

    /*
     * A UK pint is a fifth larger than a US one and the gallons differ by the
     * same kind of margin, so this changes real answers — but only for imperial
     * volumes. Left visible and disabled rather than hidden: a control that
     * appears and vanishes as the switch above it moves reads as a glitch,
     * whereas a greyed one with a reason explains what the switch just did.
     */
    ChoiceSetting(
        label = "Imperial measures",
        options = listOf("us" to "US", "uk" to "UK"),
        selected = settings.string("imperialFlavor"),
        enabled = imperial,
        note = if (imperial) {
            "Which gallon, pint and fluid ounce to use."
        } else {
            "Only used when units are set to imperial."
        },
        onPick = { save(buildJsonObject { put("imperialFlavor", it) }) }
    )
}

@Composable
private fun LanguageSection(settings: Settings, save: (JsonObject) -> Unit) {
    SectionHeader(
        "Language",
        "Translations, definitions and encyclopedia lookups are produced in " +
            "this language. It is not the language of the app itself."
    )

    PickerSetting(
        label = "Translate into",
        options = settings.defaults.languages,
        selected = settings.string("language"),
        onPick = { save(buildJsonObject { put("language", it) }) }
    )
}

@Composable
private fun DetectorsSection(settings: Settings, save: (JsonObject) -> Unit) {
    SectionHeader(
        "Detectors",
        "Turning one off removes its rows from the sheet. Detection is the " +
            "expensive part of opening the sheet, so switching off what you " +
            "never use makes it open sooner as well as shorter."
    )

    settings.defaults.detectors.forEach { (id, title) ->
        val on = settings.detectorOn(id)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        ) {
            Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(
                checked = on,
                // Only this detector's key is written. The store merges
                // `detectors` a level deeper than the rest for exactly this
                // reason, so the other twenty-one keep whatever they had.
                onCheckedChange = { next ->
                    save(buildJsonObject {
                        put("detectors", buildJsonObject { put(id, next) })
                    })
                }
            )
        }
    }
}

/**
 * The way into the prompt editor.
 *
 * It counts what is stored rather than saying "Custom tools ›", because the
 * number is the one thing the settings screen can usefully tell someone about
 * a list it does not show: none means the `custom` detector never matches at
 * all, which explains an absence the detector list above cannot.
 */
@Composable
private fun CustomToolsRow(count: Int, onOpen: () -> Unit) {
    SectionHeader(
        "My tools",
        "Your own prompts, offered as rows in the sheet — for the thing the " +
            "built-in tools do not do."
    )

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable { onOpen() }
    ) {
        Column(Modifier.weight(1f)) {
            Text("Write and edit tools", style = MaterialTheme.typography.bodyLarge)
            Text(
                when (count) {
                    0 -> "None yet"
                    1 -> "1 tool"
                    else -> "$count tools"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun StorageSection(
    app: HighlightHelperApp,
    settings: Settings,
    save: (JsonObject) -> Unit
) {
    val scope = rememberCoroutineScope()

    SectionHeader(
        "Storage",
        "Answers from the model are kept on this device so that re-selecting " +
            "the same sentence is free and instant instead of another billed " +
            "request."
    )

    val stored = settings.int("cacheDays", 0)

    // Re-keyed on the stored value so a save re-seeds it, but untouched while a
    // drag is in progress — otherwise the thumb would fight the recomposition
    // caused by its own writes.
    var days by remember(stored) { mutableFloatStateOf(stored.toFloat()) }

    Text(
        when (val d = days.roundToInt()) {
            0 -> "Not cached — every request goes to DeepSeek"
            1 -> "Kept for a day"
            else -> "Kept for $d days"
        },
        style = MaterialTheme.typography.bodyMedium
    )

    Slider(
        value = days,
        onValueChange = { days = it },
        // Written on release rather than on every frame of the drag: DataStore
        // writes go to disk, and a slider dragged across the range would
        // otherwise queue thirty of them for one decision.
        onValueChangeFinished = { save(buildJsonObject { put("cacheDays", days.roundToInt()) }) },
        valueRange = 0f..CACHE_DAYS_MAX,
        steps = CACHE_DAYS_MAX.toInt() - 1,
        modifier = Modifier.fillMaxWidth()
    )

    var report by remember { mutableStateOf<String?>(null) }

    OutlinedButton(onClick = {
        scope.launch {
            // Counted before the clear, because afterwards there is nothing left
            // to count and "cleared everything" tells the user less than a
            // number does about whether anything was there.
            val dropped = app.cache.count()
            app.cache.clear()
            report = when (dropped) {
                0 -> "Nothing was cached."
                1 -> "Cleared 1 saved answer."
                else -> "Cleared $dropped saved answers."
            }
        }
    }) { Text("Clear cached answers") }

    report?.let {
        Text(
            it,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

private const val CACHE_DAYS_MAX = 30f

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

@Composable
private fun SectionHeader(title: String, blurb: String? = null) {
    Text(title, style = MaterialTheme.typography.titleMedium)
    if (blurb != null) {
        Text(
            blurb,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * A setting with more options than fit on the screen.
 *
 * A dialog rather than a dropdown because the currency list is every code the
 * engine knows: a menu that long anchored to a row ends up taller than the
 * phone, and a dialog is already the shape Android uses for "choose one of
 * many".
 */
@Composable
private fun PickerSetting(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    onPick: (String) -> Unit,
    /** Off for lists whose ids are plumbing rather than something to recognise. */
    showCode: Boolean = true
) {
    var open by remember { mutableStateOf(false) }

    // The code as well as the name, because "US Dollar" and "USD" are not
    // equally recognisable and the second is what the converted row will say.
    // A provider id is not like that — "OpenAI (openai)" is just noise.
    val shown = options.firstOrNull { it.first == selected }
        ?.let { (code, name) -> if (showCode) "$name ($code)" else name }
        ?: selected.ifEmpty { "—" }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(enabled = options.isNotEmpty()) { open = true }
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            Text(
                shown,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    if (open) {
        OptionDialog(
            title = label,
            options = options,
            selected = selected,
            onPick = { open = false; onPick(it) },
            onDismiss = { open = false }
        )
    }
}

@Composable
private fun OptionDialog(
    title: String,
    options: List<Pair<String, String>>,
    selected: String,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit
) {
    // Opened at whatever is already chosen. A list of every currency opened at
    // the top would show the user AED and leave them to find out for themselves
    // what the setting currently is.
    val start = options.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    val state = rememberLazyListState(initialFirstVisibleItemIndex = start)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            LazyColumn(state = state, modifier = Modifier.heightIn(max = 400.dp)) {
                items(options, key = { it.first }) { (code, name) ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPick(code) }
                            .padding(vertical = 4.dp)
                    ) {
                        RadioButton(selected = code == selected, onClick = { onPick(code) })
                        Spacer(Modifier.width(4.dp))
                        Text(name, style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

/** A setting with two or three options, all of which fit on the row. */
@Composable
private fun ChoiceSetting(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    onPick: (String) -> Unit,
    enabled: Boolean = true,
    note: String? = null
) {
    val dimmed = if (enabled) {
        MaterialTheme.colorScheme.onSurface
    } else {
        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
    }

    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = dimmed)

        Row(verticalAlignment = Alignment.CenterVertically) {
            options.forEach { (value, title) ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clickable(enabled = enabled) { onPick(value) }
                        .padding(end = 12.dp)
                ) {
                    RadioButton(
                        selected = value == selected,
                        enabled = enabled,
                        onClick = { onPick(value) }
                    )
                    Text(title, style = MaterialTheme.typography.bodyMedium, color = dimmed)
                }
            }
        }

        if (note != null) {
            Text(
                note,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
