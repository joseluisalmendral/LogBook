/**
 * generate/timeline-doc.ts — Build logbook/docs/timeline.md (T11).
 *
 * Content: chronological list of all events with phase markers.
 * - Group events by phase (insert "## Phase: <name>" headers when phase changes).
 * - Each event: "- <ts> [<type>] <title or description>"
 * - Sort by ts ascending.
 * - Deterministic: same RenderContext → same bytes.
 *
 * Pure function — no I/O.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO timestamp for display in event lines. */
function formatTs(ts: string): string {
  // Trim to second precision for readability
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
  // Fall back to type-derived label
  return `(${e.type})`;
}

/** Derive display phase from an event. Returns undefined if no phase info. */
function eventPhase(e: RenderEvent): string | undefined {
  // CLI phase events set e.phase (top-level) or e.currentPhase
  if (typeof e["phase"] === "string") return e["phase"];
  if (typeof e["currentPhase"] === "string") return e["currentPhase"];
  return undefined;
}

// ---------------------------------------------------------------------------
// buildTimelineDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/timeline.md as a string.
 * Pure function — no I/O.
 */
export function buildTimelineDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# Timeline");
  lines.push("");

  // Sort defensively — callers may not have gone through readContext
  const events = [...ctx.all].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0
  );

  if (events.length === 0) {
    lines.push("_No events recorded yet._");
    lines.push("");
    return lines.join("\n");
  }

  let currentPhase: string | undefined = undefined;

  for (const e of events) {
    const phase = eventPhase(e);

    // Insert phase header when phase changes
    if (phase !== undefined && phase !== currentPhase) {
      currentPhase = phase;
      lines.push(`## Phase: ${phase}`);
      lines.push("");
    }

    const ts = formatTs(e.ts);
    const type = e.type;
    const title = eventTitle(e);
    lines.push(`- ${ts} [${type}] ${title}`);
  }

  lines.push("");

  return lines.join("\n");
}
