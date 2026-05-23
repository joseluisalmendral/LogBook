/**
 * generate/commits-doc.ts — Build logbook/docs/commits.md (v1.1 S2.3).
 *
 * Cross-index of events grouped by gitSha. For each SHA that appears in at
 * least one event, emits a section with:
 *   - SHA heading (7-char abbrev), optionally linked to the remote commit page.
 *   - Date of the earliest event under that SHA.
 *   - Table of events: type, timestamp, summary.
 *
 * Pure function — no I/O.
 * Deterministic: same RenderContext + remoteUrl → same bytes.
 *
 * ADR-21 (supersedes slice-3 ADR-04): commit SHAs are now clickable links
 * when (a) origin remote URL is detected and (b) the host is allowlisted by
 * src/export/sanitize-links.ts (github.com, gitlab.com, bitbucket.org).
 * Unknown hosts → buildCommitLink returns undefined → plain SHA fallback.
 *
 * buildCommitLink already handles host detection and link construction;
 * this doc simply calls it and falls back to plain text when it returns undefined.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";
import { buildCommitLink } from "../connectors/git.js";
import { buildHtmlTable } from "./html-table.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format ISO timestamp to display string (second precision). */
function formatTs(ts: string): string {
  try {
    return ts.slice(0, 19).replace("T", " ") + "Z";
  } catch {
    return ts;
  }
}

/** Extract display summary from an event. */
function eventSummary(e: RenderEvent): string {
  if (typeof e["title"] === "string" && e["title"]) return e["title"];
  if (typeof e["description"] === "string" && e["description"])
    return e["description"];
  return `(${e.type})`;
}

// ---------------------------------------------------------------------------
// buildCommitsDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/commits.md as a string.
 *
 * @param ctx       - RenderContext from readContext.
 * @param remoteUrl - Optional git remote URL (from state or getRemoteUrl).
 *                    When provided and the host is recognized, SHA headings
 *                    become hyperlinks.
 */
export function buildCommitsDoc(
  ctx: RenderContext,
  remoteUrl: string | undefined,
): string {
  const lines: string[] = [];

  lines.push("# Commits");
  lines.push("");

  // Collect all events that carry a gitSha field.
  const withSha = ctx.all.filter(
    (e) => typeof e["gitSha"] === "string" && (e["gitSha"] as string).length > 0,
  );

  // T7.2: pedagogical page hero (ADR-D6, cognitive-doc-design).
  // Count unique SHAs for the intro.
  const uniqueShas = new Set(
    withSha.map((e) => String(e["gitSha"]))
  );
  const commitCount = uniqueShas.size;
  lines.push('<header class="lb-page-hero">');
  // Phase 4 T4.1 — cognitive-doc-design: lead with the count, then explain
  // the coupling between commits and captured events, then the SHA affordance.
  lines.push(`<p class="lb-page-intro">${commitCount} commit${commitCount !== 1 ? 's' : ''} cross-referenced with the events captured around them. Click a SHA to open the diff on the remote in a new tab.</p>`);
  lines.push('</header>');
  lines.push('');

  // legends-and-pedagogical-decode — "How to read this" collapsible.
  lines.push('<details class="lb-how-to-read">');
  lines.push('<summary>¿Cómo leer esta página?</summary>');
  lines.push('<div class="lb-how-to-read-body">');
  lines.push('<p>Cada bloque arranca con el SHA corto del commit y abajo aparecen los eventos de logbook que cayeron alrededor del mismo. Sirve para reconstruir qué se decidió, qué falló y qué se aprendió en torno a cada commit.</p>');
  lines.push('<h4>SHA del commit</h4>');
  lines.push('<p>Si el remote del repo está en la <em>allowlist</em> (GitHub, GitLab, Bitbucket), el SHA es un link clickeable que abre el diff en una pestaña nueva. Si no, queda como texto.</p>');
  lines.push('<h4>Correlación con eventos</h4>');
  lines.push('<p>Cuando hacés <code>git commit</code> después de registrar un evento, LogBook asocia los eventos recientes con el SHA. No es un mapeo perfecto — es una ventana temporal — pero ayuda a leer la historia del proyecto en orden cronológico.</p>');
  lines.push('</div>');
  lines.push('</details>');
  lines.push('');

  if (withSha.length === 0) {
    // visual-replay-redesign V9 — pedagogical empty state.
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay commits asociados a eventos.</strong></p>');
    lines.push('<p>Cada vez que hagas <code>git commit</code> después de registrar un evento, LogBook lo correlaciona automáticamente. Empezá registrando una decisión y commiteando el cambio.</p>');
    lines.push('</div>');
    lines.push("");
    return lines.join("\n");
  }

  // Group by gitSha, preserving insertion order (sorted by earliest event ts).
  const groups = new Map<string, RenderEvent[]>();
  for (const e of withSha.sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  )) {
    const sha = e["gitSha"] as string;
    if (!groups.has(sha)) groups.set(sha, []);
    groups.get(sha)!.push(e);
  }

  for (const [sha, events] of groups) {
    const abbrev = sha.slice(0, 7);
    const commitLink = buildCommitLink(remoteUrl, sha);

    // SHA heading — link if remote recognized, plain text otherwise.
    const shaHeading = commitLink
      ? `## [\`${abbrev}\`](${commitLink})`
      : `## \`${abbrev}\``;
    lines.push(shaHeading);
    lines.push("");

    // Date: earliest event timestamp (already sorted ascending).
    const earliestTs = events[0]!.ts;
    lines.push(`Date: ${formatTs(earliestTs)}`);
    lines.push("");

    // Events table — raw HTML instead of GFM pipe-tables (remark-gfm not installed).
    const tableRows = events.map((e) => [
      e.type,
      formatTs(e.ts),
      eventSummary(e),
    ]);
    lines.push(buildHtmlTable(
      { headers: ["Type", "Timestamp", "Summary"] },
      tableRows,
      true, // escape plain-text cell values
    ));
    lines.push("");
  }

  return lines.join("\n");
}
