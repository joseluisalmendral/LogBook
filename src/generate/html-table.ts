/**
 * generate/html-table.ts — Raw HTML table builder for generator output.
 *
 * GFM pipe-tables require remark-gfm to render; this project uses remark-parse
 * without that plugin. All generators that need tabular output must call
 * buildHtmlTable() instead of emitting pipe syntax.
 *
 * The resulting <table> is a plain block-level HTML element. The placeholder
 * mechanism in markdown-to-html.ts (preprocessRawHtmlPlaceholders / LBRAW_<n>)
 * already lists "table" in BLOCK_HTML_TAGS, so the table survives the unified
 * pipeline unchanged and is injected back verbatim into the final HTML.
 *
 * CSS: the project's global table/th/td selectors in styles.css handle all
 * styling — no extra class needed. The <table> element IS styled by default.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Alignment for a single column. Default is "left". */
export type ColAlign = "left" | "center" | "right";

export interface TableOptions {
  /** Column header labels. */
  headers: string[];
  /** Per-column alignment. Defaults to "left" for missing entries. */
  alignments?: ColAlign[];
  /** CSS class to add to <table>. Optional — global styles apply by default. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escape HTML special chars in a cell value.
 * Pipe characters are safe in HTML cells (no need to escape as \| here),
 * but < / > / & / " must be escaped.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// buildHtmlTable
// ---------------------------------------------------------------------------

/**
 * Build a raw HTML <table> string from headers and rows.
 *
 * @param options  Table configuration (headers, alignments, optional class).
 * @param rows     Array of rows; each row is an array of cell strings (may
 *                 contain pre-rendered HTML — not escaped by this function).
 *                 Pass `escapeRow: false` (default) to preserve HTML in cells.
 *                 If cells are plain text, use escapeRow: true.
 *
 * @returns  Multiline HTML string starting with <table> and ending with </table>.
 */
export function buildHtmlTable(
  options: TableOptions,
  rows: string[][],
  escapeRow = false,
): string {
  const { headers, alignments = [], className } = options;
  const classAttr = className ? ` class="${className}"` : "";

  const lines: string[] = [];
  lines.push(`<table${classAttr}>`);

  // thead
  lines.push("<thead>");
  lines.push("<tr>");
  for (let i = 0; i < headers.length; i++) {
    const align = alignments[i] ?? "left";
    lines.push(`<th style="text-align:${align}">${escapeHtml(headers[i]!)}</th>`);
  }
  lines.push("</tr>");
  lines.push("</thead>");

  // tbody
  lines.push("<tbody>");
  for (const row of rows) {
    lines.push("<tr>");
    for (let i = 0; i < headers.length; i++) {
      const align = alignments[i] ?? "left";
      const raw = row[i] ?? "";
      const cell = escapeRow ? escapeHtml(raw) : raw;
      lines.push(`<td style="text-align:${align}">${cell}</td>`);
    }
    lines.push("</tr>");
  }
  lines.push("</tbody>");

  lines.push("</table>");
  return lines.join("\n");
}
