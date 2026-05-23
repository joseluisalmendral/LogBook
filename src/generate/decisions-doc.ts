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
// visual-replay-redesign V3 — decision-graph (Mermaid graph TD).
// Pre-rendered by the slice-7 mmdc pipeline into inline SVG at build time.
// Spec V3 requirements: at least 2 decisions AND at least one supersedes or
// relatesTo relation; otherwise render a flat ordered list (graceful
// degradation); never emit a broken Mermaid block.
// ---------------------------------------------------------------------------

/**
 * Strip Mermaid-hostile characters and cap label length to 40 chars
 * (matches slice-7 `mermaidEsc` policy in sessions-doc.ts).
 */
function mermaidLabelEsc(s: string): string {
  return s
    // eslint-disable-next-line no-useless-escape
    .replace(/[\[\]\{\}\(\)\:\;\"\'`<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** Collect (sourceId, targetId) relation tuples from a single decision event. */
function collectRelations(e: RenderEvent): Array<{ to: string; kind: "supersedes" | "relatesTo" }> {
  const out: Array<{ to: string; kind: "supersedes" | "relatesTo" }> = [];
  const sup = e["supersedes"];
  if (typeof sup === "string" && sup) out.push({ to: sup, kind: "supersedes" });
  else if (Array.isArray(sup)) {
    for (const s of sup) if (typeof s === "string" && s) out.push({ to: s, kind: "supersedes" });
  }
  const rel = e["relatesTo"];
  if (typeof rel === "string" && rel) out.push({ to: rel, kind: "relatesTo" });
  else if (Array.isArray(rel)) {
    for (const r of rel) if (typeof r === "string" && r) out.push({ to: r, kind: "relatesTo" });
  }
  return out;
}

/**
 * Build a Mermaid `graph TD` source for the decisions graph, or return
 * undefined when graceful degradation should fire (no relations).
 *
 * Returns the full ```mermaid fence wrapped in a block; the mmdc pre-render
 * pipeline picks it up and inlines an SVG at build time.
 */
function buildDecisionGraphSrc(decisions: RenderEvent[]): string | undefined {
  if (decisions.length < 2) return undefined;
  // Collect all relations first; if zero, fall back to flat list.
  let hasRelation = false;
  for (const d of decisions) {
    if (collectRelations(d).length > 0) {
      hasRelation = true;
      break;
    }
  }
  if (!hasRelation) return undefined;

  // Cap at 60 nodes; the oldest collapse into a single subgraph node.
  const MAX_NODES = 60;
  const sorted = decisions.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const visible = sorted.slice(-MAX_NODES);
  const visibleIds = new Set(visible.map((d) => d.id));

  const lines: string[] = ["```mermaid", "graph TD"];

  // Node declarations.
  for (const d of visible) {
    const label = mermaidLabelEsc(
      typeof d["title"] === "string" && d["title"]
        ? d["title"]
        : typeof d["description"] === "string" && d["description"]
          ? d["description"]
          : `Decision ${d.id.slice(0, 8)}`,
    );
    lines.push(`  ${d.id}["${label || d.id.slice(0, 8)}"]`);
  }

  // Edges (only between visible nodes; references to collapsed/earlier nodes are skipped).
  for (const d of visible) {
    const rels = collectRelations(d);
    for (const { to, kind } of rels) {
      if (!visibleIds.has(to)) continue;
      // supersedes uses thick arrow, relatesTo uses dashed.
      const arrow = kind === "supersedes" ? "-->" : "-.->";
      lines.push(`  ${d.id} ${arrow}|${kind}| ${to}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/** Build a flat date-ordered list of decisions (graceful degradation for V3). */
function buildDecisionsFlatList(decisions: RenderEvent[]): string {
  const sorted = decisions.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const items: string[] = [];
  items.push('<ol class="lb-decisions-flat">');
  for (const d of sorted) {
    const title =
      typeof d["title"] === "string" && d["title"]
        ? d["title"]
        : `Decision ${d.id.slice(0, 8)}`;
    const dateStr = d.ts.slice(0, 10);
    const safe = title
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    items.push(`  <li><span class="lb-decisions-flat-date">${dateStr}</span> &mdash; ${safe}</li>`);
  }
  items.push("</ol>");
  return items.join("\n");
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

  // T7.2 + Phase 4 T4.1: pedagogical page hero (ADR-D6, cognitive-doc-design).
  // Lead with the answer (count + shape), then signpost the navigation pattern.
  const decisionCount = ctx.decisions.length;
  const hasGraphRelations = ctx.decisions.some((d) =>
    Boolean(d["supersedes"]) || Boolean(d["relatesTo"])
  );
  const navHint = hasGraphRelations
    ? "Above the table, the graph traces which decisions supersede or relate to others — follow the arrows to see how thinking evolved."
    : "Listed in date order below. As decisions start to supersede or reference each other, a graph will appear here automatically.";
  lines.push('<header class="lb-page-hero">');
  lines.push(`<p class="lb-page-intro">${decisionCount} architectural decision${decisionCount !== 1 ? 's' : ''}. ${navHint}</p>`);
  lines.push('</header>');
  lines.push('');

  // legends-and-pedagogical-decode — "How to read this" collapsible.
  lines.push('<details class="lb-how-to-read">');
  lines.push('<summary>¿Cómo leer esta página?</summary>');
  lines.push('<div class="lb-how-to-read-body">');
  lines.push('<p>Una decisión arquitectónica es un acuerdo deliberado sobre cómo se hace algo en el proyecto. Quedan acá registradas con su fecha y su estado actual.</p>');
  lines.push('<h4>Fases (columna Phase)</h4>');
  lines.push('<p>Las decisiones se agrupan por fase del proyecto: <strong>Architecture</strong>, <strong>Persistence</strong>, <strong>Security</strong>, <strong>UI</strong>, <strong>Tooling</strong>, etc. Sirve para leer en bloque las decisiones que comparten contexto.</p>');
  lines.push('<h4>Estados (columna Status)</h4>');
  lines.push('<ul>');
  lines.push('<li><strong>accepted</strong> — vigente, así se hace hoy</li>');
  lines.push('<li><strong>superseded</strong> — reemplazada por una decisión posterior</li>');
  lines.push('<li><strong>proposed</strong> — todavía en discusión</li>');
  lines.push('</ul>');
  lines.push('<h4>Grafo arriba de la tabla</h4>');
  lines.push('<p>Cuando una decisión <em>supersedes</em> o se relaciona con otra, aparece un grafo que traza esas flechas. Si todavía no hay relaciones registradas, se muestra una lista plana — el grafo aparece solo cuando vale la pena.</p>');
  lines.push('</div>');
  lines.push('</details>');
  lines.push('');

  if (ctx.decisions.length === 0) {
    // visual-replay-redesign V9 — pedagogical empty state.
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay decisiones registradas.</strong></p>');
    lines.push('<p>Usá <code>logbook decision "tu decisión"</code> para registrar la primera. Mientras tanto: explorá los eventos recientes en el Dashboard.</p>');
    lines.push('</div>');
    lines.push("");
    return lines.join("\n");
  }

  // visual-replay-redesign V3 — decision graph (Mermaid graph TD) or flat
  // degraded list, emitted ABOVE the existing decisions table.
  const graphSrc = buildDecisionGraphSrc(ctx.decisions);
  if (graphSrc) {
    lines.push('<div class="lb-decision-graph">');
    lines.push(graphSrc);
    lines.push('</div>');
    lines.push('');
  } else {
    lines.push('<div class="lb-decisions-degraded">');
    lines.push(buildDecisionsFlatList(ctx.decisions));
    lines.push('</div>');
    lines.push('');
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
