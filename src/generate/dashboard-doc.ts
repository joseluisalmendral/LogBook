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
// visual-replay-redesign V2 — activity heatmap (7×24 CSS Grid).
// Single-hue violet opacity gradient drives density per research #256
// anti-pattern guard "Multicolor saturated backgrounds". Each cell is a
// <button> so keyboard nav + click-to-filter is free from HTML semantics.
// Build-time pure function — no runtime data fetch.
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Build a 7×24 day-of-week × hour-of-day activity heatmap as inline HTML.
 *
 * Counts every event in `events` into one of 168 buckets (dayOfWeek, hour).
 * Days/hours are computed in UTC (spec V2 timezone resolution).
 * Densities are normalized to the max bucket count (`density = count / max`).
 *
 * Each cell is a `<button>` with `data-day`, `data-hour`, and
 * `style="--lb-density: <0..1>"`. Inline JS reads the data attrs to set the
 * hash filter to `#dashboard/day-W-hH`. The Reset link clears it.
 *
 * Empty events array → returns an empty string (caller suppresses the
 * heatmap section entirely and shows the page-level empty state via V9).
 */
function buildActivityHeatmap(events: RenderEvent[]): string {
  if (events.length === 0) return "";

  // 7 days × 24 hours = 168 buckets.
  const counts: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const e of events) {
    const d = new Date(e.ts);
    if (isNaN(d.getTime())) continue;
    const dayOfWeek = d.getUTCDay();   // 0..6 (Sun..Sat)
    const hour = d.getUTCHours();      // 0..23
    counts[dayOfWeek]![hour]! += 1;
  }

  let max = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (counts[d]![h]! > max) max = counts[d]![h]!;
    }
  }
  const safeMax = max === 0 ? 1 : max; // never divide by zero

  const lines: string[] = [];
  lines.push('<div class="lb-heatmap" role="region" aria-label="Activity heatmap by day and hour">');
  lines.push('<div class="lb-heatmap-header">');
  lines.push('<h2 class="lb-heatmap-title">Activity by day &amp; hour <span class="lb-heatmap-subtle">(UTC)</span></h2>');
  lines.push('<button class="lb-heatmap-reset" type="button" data-lb-heatmap-reset hidden>Reset filter</button>');
  lines.push('</div>');

  // Hour-axis header row (skip cell at corner for day labels).
  lines.push('<div class="lb-heatmap-grid">');
  lines.push('<div class="lb-heatmap-corner" aria-hidden="true"></div>');
  for (let h = 0; h < 24; h++) {
    const showLabel = h % 4 === 0;
    lines.push(
      `<div class="lb-heatmap-hour-label" aria-hidden="true">${showLabel ? String(h).padStart(2, "0") : ""}</div>`,
    );
  }
  for (let d = 0; d < 7; d++) {
    lines.push(`<div class="lb-heatmap-day-label" aria-hidden="true">${DAY_LABELS[d]}</div>`);
    for (let h = 0; h < 24; h++) {
      const count = counts[d]![h]!;
      const density = count / safeMax;
      const dayLabel = DAY_LABELS[d];
      const label = `${dayLabel} ${String(h).padStart(2, "0")}:00 — ${count} event${count !== 1 ? "s" : ""}`;
      lines.push(
        `<button type="button" class="lb-heat-cell" ` +
        `data-day="${d}" data-hour="${h}" ` +
        `style="--lb-density: ${density.toFixed(3)}" ` +
        `aria-label="${label}" title="${label}"></button>`,
      );
    }
  }
  lines.push('</div>'); // grid
  lines.push('</div>'); // heatmap
  return lines.join("\n");
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

  // T7.2: pedagogical page hero (ADR-D6, cognitive-doc-design).
  lines.push('<header class="lb-page-hero">');
  // Phase 4 T4.1 — cognitive-doc-design: lead with the answer + describe shape, not jargon.
  // The heatmap reads left-to-right (hours) and top-to-bottom (days). Darker cells = more activity.
  lines.push('<p class="lb-page-intro">' +
    'The shape of your work, at a glance. ' +
    'The grid below maps activity by weekday and hour: darker violet means more events fell in that slot. ' +
    'Click any cell to filter the rest of the page to that hour. ' +
    'KPIs and charts below the grid summarize the whole project.</p>');
  lines.push('</header>');
  lines.push('');

  // legends-and-pedagogical-decode — "How to read this" collapsible.
  lines.push('<details class="lb-how-to-read">');
  lines.push('<summary>¿Cómo leer esta página?</summary>');
  lines.push('<div class="lb-how-to-read-body">');
  lines.push('<p>Esta página resume todo el proyecto en una sola vista: cuándo trabajaste, cuánto, y de qué tipo fue cada cosa.</p>');
  lines.push('<h4>Heatmap "Activity by day & hour"</h4>');
  lines.push('<p>Cada celda es una hora del día (00–23) cruzada con un día de la semana. Cuanto más intenso el violeta, más eventos cayeron en esa franja. Útil para ver tus picos de trabajo.</p>');
  lines.push('<h4>KPIs</h4>');
  lines.push('<ul>');
  lines.push('<li><strong>Total events</strong> — suma de todos los eventos capturados (prompts, decisiones, errors, tool_use, etc.)</li>');
  lines.push('<li><strong>Sessions</strong> — cantidad de sesiones distintas registradas</li>');
  lines.push('<li><strong>Decisions</strong> — decisiones arquitectónicas registradas con <code>logbook decision</code></li>');
  lines.push('<li><strong>Errors (open)</strong> / <strong>Errors (resolved)</strong> — errors aún sin fix vs. ya cerrados con un fix linkeado</li>');
  lines.push('<li><strong>Lessons</strong> — aprendizajes capturados con <code>logbook lesson</code></li>');
  lines.push('<li><strong>Milestones</strong> — fases cerradas</li>');
  lines.push('<li><strong>Top file</strong> — archivo más referenciado en los eventos</li>');
  lines.push('</ul>');
  lines.push('<h4>Top Tags</h4>');
  lines.push('<p>Las etiquetas (<code>tags</code>) más usadas en los eventos. Sirven para agrupar trabajo por tema sin necesidad de carpetas.</p>');
  lines.push('<h4>Activity Charts</h4>');
  lines.push('<p>Tres gráficos para el rango elegido (all / 30d / 7d): eventos por día, errors por status, decisiones por fase.</p>');
  lines.push('</div>');
  lines.push('</details>');
  lines.push('');

  // visual-replay-redesign V9 — pedagogical empty state when the project has
  // no captured events at all (covers all-pages-empty edge). Even with zero
  // events we still emit the KPI grid (zeros) and the range selector shells
  // below — they teach the user what surfaces will appear once data exists,
  // and other generators (dashboard tests, range-selector tests) assert on
  // their presence regardless of fixture size.
  if (ctx.all.length === 0) {
    // Phase 4 T4.2 — empty-state audit. cognitive-doc-design: lead with the answer
    // (nothing captured yet), then give one concrete action + describe what
    // will appear once data exists. Spanish preserved to match other empty states
    // (INV-6: copy may be Spanish where existing pages already mix it).
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay eventos capturados.</strong></p>');
    lines.push('<p>Arrancá con <code>logbook start --label "tu primera sesión"</code>. Cuando registres prompts, decisiones o milestones, este panel se arma solo: KPIs arriba, heatmap de actividad por día y hora, y gráficos por rango.</p>');
    lines.push('</div>');
    lines.push("");
    // Fall through to emit KPI grid + range shells (zeros / empty charts).
  }

  // visual-replay-redesign V2 — activity heatmap (single-hue violet density).
  const heatmap = buildActivityHeatmap(ctx.all);
  if (heatmap) {
    lines.push(heatmap);
    lines.push("");
  }

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
