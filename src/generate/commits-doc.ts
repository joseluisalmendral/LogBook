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

  if (withSha.length === 0) {
    lines.push("_No git-tagged events recorded yet._");
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
