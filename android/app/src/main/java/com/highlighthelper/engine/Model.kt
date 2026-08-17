package com.highlighthelper.engine

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * The shapes that cross the bridge.
 *
 * Rows are typed because they are small, stable, and every screen touches them.
 * Blocks are deliberately left as [JsonObject]: the vocabulary is defined once,
 * in `kit.js`, and mirroring it into a sealed Kotlin hierarchy would mean two
 * definitions of the same list with nothing to keep them honest. The renderer
 * switches on `type` and ignores what it does not know, which is the same
 * contract the extension's own renderer follows.
 */

@Serializable
data class Detection(
    val session: Long,
    val rows: List<Row> = emptyList()
)

@Serializable
data class Row(
    val key: String,
    val icon: String = "dot",
    val label: String,
    val detailTitle: String = label,
    val value: RowValue? = null,
    val hasDetail: Boolean = false,
    /**
     * False for a detector still on the extension's older `items()` form, which
     * builds DOM and therefore cannot render here. The sheet shows the row and
     * says it is not available yet — see `describeRow` in bridge.js for why
     * that beats hiding it.
     */
    val supported: Boolean = true
)

@Serializable
data class RowValue(
    val kind: String,
    val text: String? = null
)

/** A detail view: static blocks, a submenu, or something that has to run first. */
@Serializable
data class View(
    val kind: String = "blocks",
    val loading: String = "Working…",
    val blocks: List<JsonObject> = emptyList(),
    val rows: List<Row> = emptyList(),
    @SerialName("view") val viewId: String? = null
)
