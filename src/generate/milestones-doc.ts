/**
 * generate/milestones-doc.ts — Build logbook/docs/milestones.md (ADR-22).
 *
 * Orders ctx.milestones by ts ascending.
 * Emits a mermaid `timeline` chart at top.
 * Then a sectioned list per milestone with phase rollups
 * (events between this milestone and the next, grouped by type).
 *
 * Pure function — no I/O.
 * Deterministic: same RenderContext → same bytes.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";

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

/** Extract display title from a milestone event. */
function getTitle(e: RenderEvent): string {
  if (typeof e["title"] === "string" && e["title"]) return e["title"];
  if (typeof e["description"] === "string" && e["description"])
    return e["description"].slice(0, 80);
  return `Milestone (${e.id.slice(0, 8)})`;
}

/**
 * Get all events from `all` that fall between `fromTs` (exclusive) and
 * `toTs` (inclusive), or from `fromTs` to end of time if `toTs` is undefined.
 */
function eventsBetween(
  all: RenderEvent[],
  fromTs: string,
  toTs: string | undefined,
): RenderEvent[] {
  return all.filter((e) => {
    if (e.ts <= fromTs) return false;
    if (toTs !== undefined && e.ts > toTs) return false;
    return true;
  });
}

/**
 * Group events by their simplified type (strip "manual." prefix).
 */
function groupByType(events: RenderEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    const t = e.type.replace(/^manual\./, "");
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// buildMilestonesDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/milestones.md as a Markdown string.
 *
 * @param ctx  RenderContext from readContext.
 */
export function buildMilestonesDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# Milestones");
  lines.push("");

  if (ctx.milestones.length === 0) {
    lines.push("_No milestones recorded yet._");
    lines.push("");
    return lines.join("\n");
  }

  // Sort milestones by ts ascending.
  const sorted = ctx.milestones.slice().sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0
  );

  // Mermaid timeline chart at top.
  lines.push("```mermaid");
  lines.push("timeline");
  lines.push("  title Project Milestones");
  for (const m of sorted) {
    const title = getTitle(m).slice(0, 50).replace(/"/g, "'");
    lines.push(`  ${formatDate(m.ts)} : ${title}`);
  }
  lines.push("```");
  lines.push("");

  // Per-milestone sections with phase rollups.
  sorted.forEach((milestone, idx) => {
    const title = getTitle(milestone);
    const nextMilestone = sorted[idx + 1];
    const nextTs = nextMilestone?.ts;

    lines.push(`## ${title}`);
    lines.push("");
    lines.push(`**Reached:** ${formatTs(milestone.ts)}`);
    lines.push("");

    if (typeof milestone["description"] === "string" && milestone["description"]) {
      lines.push(milestone["description"]);
      lines.push("");
    }

    // Phase rollup: events between this milestone and the next.
    // For the first milestone, include events from the very beginning.
    const prevTs = idx === 0 ? "" : sorted[idx - 1]!.ts;
    const phaseEvents = eventsBetween(ctx.all, prevTs, milestone.ts);

    if (phaseEvents.length > 0) {
      const grouped = groupByType(phaseEvents);
      const summary = [...grouped.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`)
        .join(", ");
      lines.push(`**Phase activity:** ${summary}`);
      lines.push("");
    }
  });

  return lines.join("\n");
}
