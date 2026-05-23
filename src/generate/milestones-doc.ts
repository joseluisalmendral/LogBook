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

  // T7.2: pedagogical page hero (ADR-D6, cognitive-doc-design).
  const milestoneCount = ctx.milestones.length;
  lines.push('<header class="lb-page-hero">');
  // Phase 4 T4.1 — cognitive-doc-design: each row is a phase closure, the answer first.
  lines.push(`<p class="lb-page-intro">${milestoneCount} phase closure${milestoneCount !== 1 ? 's' : ''}. Each row marks the moment a scope finished — read top-down to follow the project's arc.</p>`);
  lines.push('</header>');
  lines.push('');

  // legends-and-pedagogical-decode — "How to read this" collapsible.
  lines.push('<details class="lb-how-to-read">');
  lines.push('<summary>¿Cómo leer esta página?</summary>');
  lines.push('<div class="lb-how-to-read-body">');
  lines.push('<p>Un milestone es un cierre de fase, no una tarea cualquiera. Se registra con <code>logbook milestone "qué cerraste"</code> cuando un scope se da por terminado.</p>');
  lines.push('<h4>Qué cuenta como milestone</h4>');
  lines.push('<ul>');
  lines.push('<li>Cierre de una fase del proyecto (architecture, persistence, security…)</li>');
  lines.push('<li>Versión liberada (v1.0, beta, release candidate)</li>');
  lines.push('<li>Auditoría pasada, sign-off externo, certificación</li>');
  lines.push('</ul>');
  lines.push('<h4>Lo que vas a ver en cada milestone</h4>');
  lines.push('<ul>');
  lines.push('<li><strong>Reached</strong> — fecha y hora exacta del cierre</li>');
  lines.push('<li><strong>Descripción</strong> — qué se cerró, en una línea</li>');
  lines.push('<li><strong>Phase activity</strong> — eventos asociados a esa fase (decisiones, errors, lessons, etc.) para que se vea cuánto trabajo costó llegar al milestone</li>');
  lines.push('</ul>');
  lines.push('</div>');
  lines.push('</details>');
  lines.push('');

  if (ctx.milestones.length === 0) {
    // visual-replay-redesign V9 — pedagogical empty state.
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay milestones alcanzados.</strong></p>');
    lines.push('<p>Cuando termines una fase clave del proyecto, usá <code>logbook milestone "qué cerraste"</code>. Cada milestone marca un cierre de scope.</p>');
    lines.push('</div>');
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
