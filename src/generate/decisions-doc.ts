/**
 * generate/decisions-doc.ts — Build logbook/docs/decisions.md (ADR-22).
 *
 * EH-2: Emits a table of ADRs with columns:
 *   Title | Date | Status | Summary | Link
 *
 * Decisions are grouped by phase. A Phase column is included in the table
 * so all decisions appear in a single scannable table (one table > N tables).
 * When no decisions exist, an empty-state message is shown instead.
 *
 * Pure function — no I/O.
 * Deterministic: same RenderContext → same bytes.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";
import { buildHtmlTable } from "./html-table.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format ISO timestamp to YYYY-MM-DD (date only, short form). */
function formatDate(ts: string): string {
  try {
    return ts.slice(0, 10);
  } catch {
    return ts;
  }
}

/**
 * Extract the phase from a decision event.
 * Checks `phase` field first, then falls back to "General".
 */
function getPhase(e: RenderEvent): string {
  if (typeof e["phase"] === "string" && e["phase"]) return e["phase"];
  return "General";
}

/** Extract display title from a decision event. */
function getTitle(e: RenderEvent): string {
  if (typeof e["title"] === "string" && e["title"]) return e["title"];
  if (typeof e["description"] === "string" && e["description"])
    return e["description"].slice(0, 80);
  return `Decision (${e.id.slice(0, 8)})`;
}

/** Extract status from a decision event. */
function getStatus(e: RenderEvent): string {
  if (typeof e["status"] === "string" && e["status"]) return e["status"];
  return "proposed";
}

/**
 * Extract summary (first sentence of rationale, truncated to ~120 chars).
 * Falls back to description, then empty string.
 */
function getSummary(e: RenderEvent): string {
  const source =
    (typeof e["rationale"] === "string" && e["rationale"])
      ? e["rationale"]
      : (typeof e["description"] === "string" && e["description"])
      ? e["description"]
      : "";

  if (!source) return "—";

  // First sentence: up to first ". " or ".\n" or end of string.
  const firstSentenceMatch = source.match(/^[^.!?]*[.!?]/);
  const sentence = firstSentenceMatch ? firstSentenceMatch[0] : source;
  const trimmed = sentence.trim();
  return trimmed.length > 120 ? trimmed.slice(0, 117) + "…" : trimmed;
}

/**
 * Extract the ADR file path from a decision event.
 * Checks `filePath`, `file`, `path` fields. Returns undefined if not present.
 */
function getFilePath(e: RenderEvent): string | undefined {
  if (typeof e["filePath"] === "string" && e["filePath"]) return e["filePath"];
  if (typeof e["file"] === "string" && e["file"]) return e["file"];
  if (typeof e["path"] === "string" && e["path"]) return e["path"];
  return undefined;
}

// ---------------------------------------------------------------------------
// buildDecisionsDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/decisions.md as a Markdown string.
 *
 * @param ctx  RenderContext from readContext.
 */
export function buildDecisionsDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# Decisions");
  lines.push("");

  if (ctx.decisions.length === 0) {
    lines.push("_No decisions recorded yet._");
    lines.push("");
    return lines.join("\n");
  }

  // EH-2: single table with Phase column — one table is more scannable than N tables.
  // Raw HTML <table> is used instead of GFM pipe-tables because remark-parse
  // is used without remark-gfm; pipe-tables would render as plain text.
  //
  // Cells are HTML-escaped here (not via buildHtmlTable escapeRow) so the link
  // column can remain a raw HTML <a> element while the other columns are safe
  // plain text.
  function esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const tableRows = ctx.decisions.map((e) => {
    const filePath = getFilePath(e);
    const linkHtml = filePath
      ? `<a href="${esc(filePath)}" rel="noopener">adr</a>`
      : "—";
    return [
      esc(getPhase(e)),
      esc(getTitle(e)),
      formatDate(e.ts), // date is already safe (YYYY-MM-DD)
      esc(getStatus(e)),
      esc(getSummary(e)),
      linkHtml, // pre-escaped above
    ];
  });

  lines.push(buildHtmlTable(
    { headers: ["Phase", "Title", "Date", "Status", "Summary", "Link"] },
    tableRows,
    false, // cells already escaped or intentionally raw HTML
  ));

  lines.push("");
  return lines.join("\n");
}
