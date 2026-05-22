/**
 * generate/sessions-doc.ts — Build logbook/docs/sessions.md (ADR-22).
 *
 * Groups all events by sessionId; events without sessionId go to an
 * "Unknown session" bucket. Sorted by earliest event ts ascending.
 * Most-recent session emits <details open> at build time.
 *
 * Per session emits:
 *   - ## Session {short-id} heading
 *   - Stats badges: events, decisions, errors, lessons, duration
 *   - <details> block with pre-rendered event list
 *   - Mermaid timeline fence when group size > 3
 *
 * ADR-23: <details> content is passed as raw HTML through the export pipeline.
 * The placeholder mechanism in markdown-to-html.ts handles it.
 *
 * Pure function — no I/O.
 * Deterministic: same RenderContext → same bytes.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";
import { buildHtmlTable } from "./html-table.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format ISO timestamp to YYYY-MM-DD display string. */
function formatDate(ts: string): string {
  try {
    return ts.slice(0, 10);
  } catch {
    return ts;
  }
}

/** Format ISO timestamp to display string (second precision). */
function formatTs(ts: string): string {
  try {
    return ts.slice(0, 19).replace("T", " ") + "Z";
  } catch {
    return ts;
  }
}

/** Compute session duration string from min/max event timestamps. */
function sessionDuration(events: RenderEvent[]): string {
  if (events.length < 2) return "—";
  const sorted = events.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const first = sorted[0]!.ts;
  const last = sorted[sorted.length - 1]!.ts;
  try {
    const diffMs = new Date(last).getTime() - new Date(first).getTime();
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 60) return `${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  } catch {
    return "—";
  }
}

/** Extract display summary from an event. */
function eventSummary(e: RenderEvent): string {
  if (typeof e["title"] === "string" && e["title"]) return e["title"];
  if (typeof e["description"] === "string" && e["description"])
    return e["description"];
  return `(${e.type})`;
}

/**
 * Build a short display id for a session.
 * Uses first 8 chars of sessionId, or the full id if shorter.
 */
function shortId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

const UNKNOWN_SESSION_ID = "unknown";

// ---------------------------------------------------------------------------
// buildSessionsDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/sessions.md as a Markdown string.
 *
 * @param ctx  RenderContext from readContext.
 */
export function buildSessionsDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# Sessions");
  lines.push("");

  if (ctx.all.length === 0) {
    lines.push("_No sessions recorded yet._");
    lines.push("");
    return lines.join("\n");
  }

  // Group all events by sessionId.
  const groups = new Map<string, RenderEvent[]>();
  for (const e of ctx.all) {
    const sid =
      typeof e["sessionId"] === "string" && e["sessionId"]
        ? e["sessionId"]
        : UNKNOWN_SESSION_ID;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid)!.push(e);
  }

  // Sort groups by earliest event ts ascending.
  const sortedGroups = [...groups.entries()].sort(([, aEvents], [, bEvents]) => {
    const aMin = aEvents.reduce(
      (min, e) => (e.ts < min ? e.ts : min),
      aEvents[0]?.ts ?? ""
    );
    const bMin = bEvents.reduce(
      (min, e) => (e.ts < min ? e.ts : min),
      bEvents[0]?.ts ?? ""
    );
    return aMin < bMin ? -1 : aMin > bMin ? 1 : 0;
  });

  const lastIndex = sortedGroups.length - 1;

  sortedGroups.forEach(([sid, events], idx) => {
    const isMostRecent = idx === lastIndex;
    const sorted = events.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const earliest = sorted[0]?.ts ?? "";
    const latest = sorted[sorted.length - 1]?.ts ?? "";

    const isUnknown = sid === UNKNOWN_SESSION_ID;
    const displayId = isUnknown ? "Unknown" : shortId(sid);
    const dateRange =
      earliest && latest && earliest !== latest
        ? `${formatDate(earliest)} → ${formatDate(latest)}`
        : formatDate(earliest);

    // SR-1 spec: unknown-session bucket is labeled "Unknown session — date"
    // (not "Session Unknown"). Known sessions keep "Session {id} — date".
    const heading = isUnknown
      ? `## Unknown session — ${dateRange}`
      : `## Session ${displayId} — ${dateRange}`;
    lines.push(heading);
    lines.push("");

    // Stats badges
    const decisions = events.filter((e) => e.type === "manual.decision").length;
    const errors = events.filter((e) => e.type === "manual.error").length;
    const lessons = events.filter((e) => e.type === "manual.lesson").length;
    const duration = sessionDuration(events);

    lines.push(
      `**Events:** ${events.length} · **Decisions:** ${decisions} · ` +
      `**Errors:** ${errors} · **Lessons:** ${lessons} · **Duration:** ${duration}`
    );
    lines.push("");

    // Mermaid timeline for sessions with > 3 events.
    if (sorted.length > 3) {
      lines.push("```mermaid");
      lines.push("timeline");
      lines.push(`  title ${isUnknown ? "Unknown session" : `Session ${displayId}`}`);
      // Emit at most 8 events to keep timeline readable.
      const slice = sorted.slice(0, 8);
      for (const e of slice) {
        const label = eventSummary(e).slice(0, 40).replace(/"/g, "'");
        lines.push(`  ${formatDate(e.ts)} : ${label}`);
      }
      lines.push("```");
      lines.push("");
    }

    // <details> block with event table (ADR-23).
    // Raw HTML <table> is used instead of GFM pipe-tables because remark-parse
    // is used without remark-gfm; pipe-tables would render as plain text.
    const tableRows = sorted.map((e) => [
      e.type,
      formatTs(e.ts),
      eventSummary(e),
    ]);
    const tableHtml = buildHtmlTable(
      { headers: ["Type", "Timestamp", "Summary"] },
      tableRows,
      true, // escape plain-text cell values
    );

    const detailsAttr = isMostRecent ? " open" : "";
    lines.push(`<details${detailsAttr}>`);
    lines.push("<summary>Session detail</summary>");
    lines.push('<div class="lb-session-detail">');
    lines.push(tableHtml);
    lines.push("</div>");
    lines.push("</details>");
    lines.push("");
  });

  return lines.join("\n");
}
