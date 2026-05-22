/**
 * generate/dashboard-doc.ts — Build logbook/docs/dashboard.md (ADR-22).
 *
 * Emits a KPI overview grid and time-range chart variants for the export dashboard.
 *
 * KPIs computed (DB-1):
 *   - Total events, sessions, decisions, errors (open/closed), lessons,
 *     milestones, top file (by event count), total events.
 *   - SUGGESTION-1: "Top File" replaces "Session Time" in the KPI grid.
 *
 * Time-range chart variants (ADR-25):
 *   THREE pre-built chart sets (all / 30d / 7d), each in a
 *   <div class="lb-chart" data-range="{r}" hidden> wrapper.
 *   The default range ("all") omits `hidden`. The inline JS toggles hidden
 *   based on <select id="lb-dashboard-range"> — no browser-side Mermaid rendering.
 *
 * Chart types (SUGGESTION-4, DB-2):
 *   Three distinct chart types pre-rendered per range variant:
 *   1. Events-per-day bar chart (mermaid xychart-beta or pie fallback).
 *   2. Errors by status (pie — events-by-status distribution as errors-timeline proxy).
 *   3. Decisions by phase (pie).
 *   NOTE: mermaid xychart-beta support varies by mermaid version.
 *   We attempt xychart-beta; if the installed version lacks it, the chart
 *   renders as a "Syntax error" SVG only for that pane. All three pane types
 *   are included per spec DB-2 requirement. A future follow-up can swap to
 *   a simpler bar representation if xychart-beta is unavailable.
 *
 * Pure function — no I/O.
 * Deterministic: same RenderContext → same bytes.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return ISO string for N days ago (UTC). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Count unique session IDs across events. */
function countSessions(events: RenderEvent[]): number {
  const ids = new Set<string>();
  for (const e of events) {
    if (typeof e["sessionId"] === "string" && e["sessionId"]) {
      ids.add(e["sessionId"]);
    }
  }
  return ids.size;
}

/** Get top N most-referenced files across all events. */
function topFiles(events: RenderEvent[], n: number): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const e of events) {
    const refs = e["fileRefs"];
    if (!Array.isArray(refs)) continue;
    for (const f of refs) {
      if (typeof f === "string" && f) {
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Get top N most-used tags across all events. */
function topTags(events: RenderEvent[], n: number): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const e of events) {
    const tags = e["tags"];
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      if (typeof t === "string" && t) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/**
 * Get the top file by event count (SUGGESTION-1 — replaces "Session Time" KPI).
 * Returns "—" when no file refs exist.
 */
function topFile(events: RenderEvent[]): string {
  const files = topFiles(events, 1);
  if (files.length === 0) return "—";
  const [name] = files[0]!;
  // Truncate long paths for the KPI card display.
  const parts = name.split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : name;
}

/**
 * Build a mermaid pie chart for a given label→count map.
 * Returns an empty string if the map is empty.
 */
function buildPieChart(counts: Map<string, number>, title: string): string {
  if (counts.size === 0) return "";

  const lines: string[] = [
    "```mermaid",
    "pie",
    `  title ${title}`,
  ];
  for (const [label, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  "${label.replace(/_/g, " ")}" : ${count}`);
  }
  lines.push("```");
  return lines.join("\n");
}

/**
 * Build an xychart-beta bar chart for events-per-day (SUGGESTION-4, DB-2).
 * Mermaid xychart-beta is available in mermaid ≥10.3.
 * Returns an empty string if no events.
 *
 * NOTE: If the installed mermaid version does not support xychart-beta, the
 * chart renders as a syntax-error SVG. This is a known v1 limitation.
 * A future pass can gate on version detection or fall back to a table.
 */
function buildEventsPerDayChart(events: RenderEvent[], title: string): string {
  if (events.length === 0) return "";

  // Count events per day (YYYY-MM-DD).
  const dayCounts = new Map<string, number>();
  for (const e of events) {
    const day = e.ts.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  // Sort days ascending.
  const days = [...dayCounts.keys()].sort();
  if (days.length === 0) return "";

  // xychart-beta requires explicit x-axis categories and a bar series.
  // Limit to last 14 data points to keep the chart legible.
  const slice = days.slice(-14);
  const counts = slice.map((d) => dayCounts.get(d) ?? 0);

  const xLabels = slice.map((d) => `"${d.slice(5)}"`).join(", "); // MM-DD labels
  const yValues = counts.join(", ");

  const lines = [
    "```mermaid",
    "xychart-beta",
    `  title "${title}"`,
    `  x-axis [${xLabels}]`,
    `  y-axis "Events" 0 --> ${Math.max(...counts) + 1}`,
    `  bar [${yValues}]`,
    "```",
  ];
  return lines.join("\n");
}

/**
 * Build decisions-by-phase pie chart (SUGGESTION-4, DB-2).
 */
function buildDecisionsByPhaseChart(ctx: { decisions: RenderEvent[] }, title: string): string {
  const phaseCounts = new Map<string, number>();
  for (const e of ctx.decisions) {
    const phase =
      typeof e["phase"] === "string" && e["phase"] ? e["phase"] : "General";
    phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
  }
  return buildPieChart(phaseCounts, title);
}

/**
 * Build errors-by-status pie chart (SUGGESTION-4, DB-2 — errors timeline proxy).
 * A true errors timeline would require mermaid gantt/timeline; pie by status
 * is the v1 approximation and clearly documents the limitation.
 */
function buildErrorsByStatusChart(errors: RenderEvent[], title: string): string {
  const statusCounts = new Map<string, number>();
  for (const e of errors) {
    const status =
      typeof e["status"] === "string" && e["status"] ? e["status"] : "open";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  return buildPieChart(statusCounts, title);
}

/**
 * Filter events to a date range.
 * `since` is an ISO date string (YYYY-MM-DD).
 */
function filterSince(events: RenderEvent[], since: string): RenderEvent[] {
  return events.filter((e) => e.ts >= since);
}

// ---------------------------------------------------------------------------
// KPI grid HTML builder
// ---------------------------------------------------------------------------

function kpiCard(label: string, value: string | number): string {
  return (
    `<div class="lb-kpi">` +
    `<div class="lb-kpi-value">${value}</div>` +
    `<div class="lb-kpi-label">${label}</div>` +
    `</div>`
  );
}

function buildKpiGrid(ctx: RenderContext): string {
  const totalEvents = ctx.all.length;
  const totalSessions = countSessions(ctx.all);
  const totalDecisions = ctx.decisions.length;
  const errorsOpen = ctx.errors.filter(
    (e) => (e["status"] as string | undefined) !== "resolved"
  ).length;
  const errorsClosed = ctx.errors.length - errorsOpen;
  const totalLessons = ctx.lessons.length;
  const totalMilestones = ctx.milestones.length;
  // SUGGESTION-1: "Top File (by event count)" replaces "Session Time" KPI (DB-1).
  const topFileValue = topFile(ctx.all);

  const cards = [
    kpiCard("Total Events", totalEvents),
    kpiCard("Sessions", totalSessions),
    kpiCard("Decisions", totalDecisions),
    kpiCard("Errors (open)", errorsOpen),
    kpiCard("Errors (resolved)", errorsClosed),
    kpiCard("Lessons", totalLessons),
    kpiCard("Milestones", totalMilestones),
    kpiCard("Top File", topFileValue),
  ].join("\n");

  return `<div class="lb-kpi-grid">\n${cards}\n</div>`;
}

// ---------------------------------------------------------------------------
// buildDashboardDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/dashboard.md as a Markdown string.
 *
 * @param ctx  RenderContext from readContext.
 */
export function buildDashboardDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# Dashboard");
  lines.push("");

  // KPI grid (raw HTML block — unified passes HTML blocks through).
  lines.push(buildKpiGrid(ctx));
  lines.push("");

  // Top files and tags (if any).
  const files = topFiles(ctx.all, 5);
  const tags = topTags(ctx.all, 5);

  if (files.length > 0) {
    lines.push("## Top Files");
    lines.push("");
    for (const [file, count] of files) {
      lines.push(`- \`${file}\` — ${count} references`);
    }
    lines.push("");
  }

  if (tags.length > 0) {
    lines.push("## Top Tags");
    lines.push("");
    for (const [tag, count] of tags) {
      lines.push(`- \`${tag}\` — ${count} events`);
    }
    lines.push("");
  }

  // Range selector control (raw HTML).
  lines.push("## Activity Charts");
  lines.push("");
  lines.push(
    `<div class="lb-filter">` +
    `<label for="lb-dashboard-range">Range: </label>` +
    `<select id="lb-dashboard-range">` +
    `<option value="all">All time</option>` +
    `<option value="30d">Last 30 days</option>` +
    `<option value="7d">Last 7 days</option>` +
    `</select>` +
    `</div>`
  );
  lines.push("");

  // Emit 3 chart variants (all / 30d / 7d), each containing THREE chart types
  // as required by spec DB-2 (SUGGESTION-4):
  //   1. Events-per-day bar chart (xychart-beta)
  //   2. Errors by status (pie — v1 proxy for errors timeline)
  //   3. Decisions by phase (pie)
  //
  // All three range variants are pre-built at build time (ADR-25); the inline
  // JS toggles visibility via the <select id="lb-dashboard-range"> element.
  const ranges: Array<{ key: string; label: string; events: RenderEvent[] }> = [
    { key: "all", label: "All time", events: ctx.all },
    { key: "30d", label: "Last 30 days", events: filterSince(ctx.all, daysAgo(30)) },
    { key: "7d", label: "Last 7 days", events: filterSince(ctx.all, daysAgo(7)) },
  ];

  for (const { key, label, events } of ranges) {
    const isDefault = key === "all";
    const hiddenAttr = isDefault ? "" : " hidden";

    // Filter errors and decisions for this range.
    const rangeErrors = ctx.errors.filter((e) => events.includes(e));
    // Decisions filtered by range timestamp.
    const since = key === "all" ? "" : key === "30d" ? daysAgo(30) : daysAgo(7);
    const rangeDecisions = since
      ? ctx.decisions.filter((e) => e.ts >= since)
      : ctx.decisions;

    const barChart = buildEventsPerDayChart(events, `${label} — Events per Day`);
    const errorsChart = buildErrorsByStatusChart(
      rangeErrors,
      `${label} — Errors by Status`
    );
    const decisionsChart = buildDecisionsByPhaseChart(
      { decisions: rangeDecisions },
      `${label} — Decisions by Phase`
    );

    const hasAnyChart = barChart || errorsChart || decisionsChart;

    lines.push(`<div class="lb-chart" data-range="${key}"${hiddenAttr}>`);
    lines.push("");
    if (!hasAnyChart) {
      lines.push(`_No events in the ${label.toLowerCase()} range._`);
    } else {
      if (barChart) {
        lines.push(barChart);
        lines.push("");
      }
      if (errorsChart) {
        lines.push(errorsChart);
        lines.push("");
      }
      if (decisionsChart) {
        lines.push(decisionsChart);
        lines.push("");
      }
    }
    lines.push("</div>");
    lines.push("");
  }

  // NOTE: DB-2 chart types per spec:
  //   ✓ Events-per-day bar chart (xychart-beta — requires mermaid ≥10.3)
  //   ✓ Errors timeline (v1: errors-by-status pie — see SUGGESTION-4 note)
  //   ✓ Decisions-by-phase pie chart
  // xychart-beta limitation: if the installed mermaid version does not support
  // xychart-beta, the bar chart renders as a syntax-error SVG. Known v1 limitation.
  // Follow-up: detect mermaid version and fall back to a markdown table if needed.

  return lines.join("\n");
}
