/**
 * generate/index-doc.ts — Build logbook/docs/index.md (T11).
 *
 * Content:
 *  - # LogBook heading
 *  - ## Sessions — bullet list sorted by ts ascending
 *  - ## Milestones — bullet list sorted by ts ascending
 *  - ## Decisions (ADR Index) — table sorted by adrCounter ascending
 *
 * Deterministic: same RenderContext → same bytes. No I/O here (pure function).
 * I/O is in generate/index.ts via upsertGeneratedBlock.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";
import { buildHtmlTable } from "./html-table.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format a timestamp to a short human-readable date (UTC, YYYY-MM-DD). */
function formatDate(ts: string): string {
  try {
    return ts.slice(0, 10); // "2026-01-01"
  } catch {
    return ts;
  }
}

function formatTime(ts: string): string {
  // Return the full ISO timestamp trimmed to second precision
  try {
    return ts.slice(0, 19).replace("T", " ") + "Z";
  } catch {
    return ts;
  }
}

function eventTitle(e: RenderEvent): string {
  if (typeof e["title"] === "string" && e["title"]) return e["title"];
  if (typeof e["description"] === "string" && e["description"])
    return e["description"];
  return e.id;
}

// ---------------------------------------------------------------------------
// buildIndexDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/index.md as a string.
 * Pure function — no I/O.
 */
export function buildIndexDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# LogBook");
  lines.push("");

  // --- Sessions section ---
  lines.push("## Sessions");
  lines.push("");
  // Sort defensively — callers may not have gone through readContext
  const sessions = [...ctx.sessions].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0
  );
  if (sessions.length === 0) {
    lines.push("_No sessions recorded yet._");
  } else {
    for (const s of sessions) {
      const label = eventTitle(s);
      lines.push(`- **${label}** — id: \`${s.id}\` — started: ${formatDate(s.ts)}`);
    }
  }
  lines.push("");

  // --- Milestones section ---
  lines.push("## Milestones");
  lines.push("");
  const milestones = [...ctx.milestones].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0
  );
  if (milestones.length === 0) {
    lines.push("_No milestones recorded yet._");
  } else {
    for (const m of milestones) {
      const label = eventTitle(m);
      lines.push(`- **${label}** — ${formatDate(m.ts)}`);
    }
  }
  lines.push("");

  // --- Decisions (ADR Index) section ---
  lines.push("## Decisions (ADR Index)");
  lines.push("");

  // Sort decisions by adrCounter ascending; fall back to ts for decisions without counter
  const sorted = [...ctx.decisions].sort((a, b) => {
    const ca = typeof a["adrCounter"] === "number" ? a["adrCounter"] : Infinity;
    const cb = typeof b["adrCounter"] === "number" ? b["adrCounter"] : Infinity;
    if (ca !== cb) return ca - cb;
    // Secondary sort by ts for determinism when counters are equal
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    return 0;
  });

  if (sorted.length === 0) {
    lines.push("_No decisions recorded yet._");
  } else {
    // Raw HTML <table> instead of GFM pipe-tables (remark-gfm not installed).
    function escH(s: string): string {
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    const tableRows = sorted.map((d) => {
      const counter = typeof d["adrCounter"] === "number"
        ? String(d["adrCounter"]).padStart(4, "0")
        : "????";
      const title = escH(eventTitle(d));
      const status = escH(typeof d["status"] === "string" ? d["status"] : "Unknown");
      const adrPath = typeof d["adrPath"] === "string" ? d["adrPath"] : "";
      const link = adrPath
        ? `<a href="../../${escH(adrPath)}" rel="noopener">${counter}</a>`
        : counter;
      return [counter, title, status, link];
    });
    lines.push(buildHtmlTable(
      { headers: ["#", "Title", "Status", "Link"] },
      tableRows,
      false, // cells pre-escaped above
    ));
  }
  lines.push("");

  return lines.join("\n");
}
