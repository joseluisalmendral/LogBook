/**
 * generate/errors-doc.ts — Build logbook/docs/errors-and-lessons.md (T11).
 *
 * Two sections:
 *  - "## Errors and fixes": for each error, show title/kind + linked fix
 *    descriptions (look up fixes where fixEvent.errorId === error.id).
 *  - "## Lessons": sort by promotable desc, then ts ascending. Show title + body + tags.
 *
 * Deterministic: same RenderContext → same bytes.
 * Pure function — no I/O.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventTitle(e: RenderEvent): string {
  if (typeof e["title"] === "string" && e["title"]) return e["title"];
  if (typeof e["description"] === "string" && e["description"])
    return e["description"];
  return e.id;
}

function fixesForError(fixes: RenderEvent[], errorId: string): RenderEvent[] {
  return fixes.filter(
    (f) => typeof f["errorId"] === "string" && f["errorId"] === errorId
  );
}

// ---------------------------------------------------------------------------
// buildErrorsDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/errors-and-lessons.md as a string.
 * Pure function — no I/O.
 */
export function buildErrorsDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  // --- Errors and fixes section ---
  lines.push("## Errors and fixes");
  lines.push("");

  if (ctx.errors.length === 0) {
    lines.push("_No errors recorded yet._");
  } else {
    // Errors are sorted by ts ascending (by readContext)
    for (const e of ctx.errors) {
      const title = eventTitle(e);
      const kind = typeof e["kind"] === "string" ? ` (${e["kind"]})` : "";
      lines.push(`### ${title}${kind}`);
      lines.push("");
      if (typeof e["description"] === "string" && e["description"]) {
        lines.push(e["description"]);
        lines.push("");
      }

      const linked = fixesForError(ctx.fixes, e.id);
      if (linked.length > 0) {
        lines.push("**Fixes:**");
        lines.push("");
        for (const f of linked) {
          const fixTitle = eventTitle(f);
          const fixDesc =
            typeof f["description"] === "string" && f["description"]
              ? ` — ${f["description"]}`
              : "";
          lines.push(`- ${fixTitle}${fixDesc}`);
        }
        lines.push("");
      }
    }
  }

  lines.push("");

  // --- Lessons section ---
  lines.push("## Lessons");
  lines.push("");

  if (ctx.lessons.length === 0) {
    lines.push("_No lessons recorded yet._");
  } else {
    // Sort: promotable=true first, then by ts ascending
    const sorted = [...ctx.lessons].sort((a, b) => {
      const pa = a["promotable"] === true ? 1 : 0;
      const pb = b["promotable"] === true ? 1 : 0;
      if (pa !== pb) return pb - pa; // descending (promotable first)
      // Secondary sort by ts ascending
      if (a.ts < b.ts) return -1;
      if (a.ts > b.ts) return 1;
      return 0;
    });

    for (const l of sorted) {
      const title = eventTitle(l);
      const isPromotable = l["promotable"] === true;
      const promotableTag = isPromotable ? " _(promotable)_" : "";
      lines.push(`### ${title}${promotableTag}`);
      lines.push("");

      // body / text field
      if (typeof l["body"] === "string" && l["body"]) {
        lines.push(l["body"]);
        lines.push("");
      } else if (typeof l["text"] === "string" && l["text"]) {
        lines.push(l["text"]);
        lines.push("");
      }

      // tags
      const tags = l["tags"];
      if (Array.isArray(tags) && tags.length > 0) {
        lines.push(`Tags: ${(tags as string[]).join(", ")}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
