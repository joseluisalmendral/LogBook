/**
 * generate/resources-doc.ts — Build logbook/docs/resources.md (ADR-22).
 *
 * Groups ctx.resources by `kind` field, then by tags.
 * Per-kind subsection with icon prefix (ADR-22: link→🔗, doc→📄, ref→🔖, fallback→▸).
 * Tag chips use deterministic HSL hue via tagHue() (ADR-30).
 *
 * Emojis here are inline Unicode — safe (not URLs or images), per project style note.
 * They are content data, not UI elements.
 *
 * Pure function — no I/O.
 * Deterministic: same RenderContext → same bytes.
 */

import type { RenderContext, RenderEvent } from "./render-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format ISO timestamp to display string. */
function formatTs(ts: string): string {
  try {
    return ts.slice(0, 10);
  } catch {
    return ts;
  }
}

/** Icon prefix per resource kind. */
function kindIcon(kind: string): string {
  switch (kind.toLowerCase()) {
    case "link": return "🔗";
    case "doc": return "📄";
    case "ref": return "🔖";
    default: return "▸";
  }
}

/**
 * Deterministic HSL hue for a tag string (ADR-30).
 * Uses a simple polynomial hash (h = h * 31 + charCode) mod 360.
 */
export function tagHue(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/** Build a tag chip HTML span with deterministic color. */
function tagChip(tag: string): string {
  const hue = tagHue(tag);
  return (
    `<span class="lb-tag" style="--lb-tag-h: ${hue}">` +
    tag +
    `</span>`
  );
}

/** Extract display title from a resource event. */
function getTitle(e: RenderEvent): string {
  if (typeof e["title"] === "string" && e["title"]) return e["title"];
  if (typeof e["url"] === "string" && e["url"]) return e["url"];
  if (typeof e["description"] === "string" && e["description"])
    return e["description"].slice(0, 80);
  return `Resource (${e.id.slice(0, 8)})`;
}

/** Extract URL from a resource event. */
function getUrl(e: RenderEvent): string | undefined {
  if (typeof e["url"] === "string" && e["url"]) return e["url"];
  return undefined;
}

/** Extract kind from a resource event. */
function getKind(e: RenderEvent): string {
  if (typeof e["kind"] === "string" && e["kind"]) return e["kind"];
  if (typeof e["resourceKind"] === "string" && e["resourceKind"]) return e["resourceKind"];
  return "other";
}

/** Extract tags from a resource event. */
function getTags(e: RenderEvent): string[] {
  const tags = e["tags"];
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string" && t.length > 0);
}

// ---------------------------------------------------------------------------
// buildResourcesDoc
// ---------------------------------------------------------------------------

/**
 * Produce the full body for logbook/docs/resources.md as a Markdown string.
 *
 * @param ctx  RenderContext from readContext.
 */
export function buildResourcesDoc(ctx: RenderContext): string {
  const lines: string[] = [];

  lines.push("# Resources");
  lines.push("");

  // T7.2: pedagogical page hero (ADR-D6, cognitive-doc-design).
  const resourceCount = ctx.resources.length;
  lines.push('<header class="lb-page-hero">');
  // Phase 4 T4.1 — cognitive-doc-design: tell the reader the shape (grouped by kind)
  // before they parse the list. Kinds are docs, repos, posts, threads, decisions.
  lines.push(`<p class="lb-page-intro">${resourceCount} link${resourceCount !== 1 ? 's' : ''} the project relied on. Grouped by kind so you can scan one source at a time: docs, repos, posts, threads.</p>`);
  lines.push('</header>');
  lines.push('');

  // legends-and-pedagogical-decode — "How to read this" collapsible.
  lines.push('<details class="lb-how-to-read">');
  lines.push('<summary>¿Cómo leer esta página?</summary>');
  lines.push('<div class="lb-how-to-read-body">');
  lines.push('<p>Las referencias son los links que el proyecto usó: docs externas, snippets guardados, posts, threads. Las agrupamos por <em>kind</em> para que puedas escanear una fuente a la vez.</p>');
  lines.push('<h4>Tipos (<code>kind</code>)</h4>');
  lines.push('<ul>');
  lines.push('<li><span class="lb-legend-icon">🔗</span> <strong>link / url</strong> — link externo</li>');
  lines.push('<li><span class="lb-legend-icon">📄</span> <strong>doc</strong> — documentación oficial o guía</li>');
  lines.push('<li><span class="lb-legend-icon">🔖</span> <strong>ref</strong> — referencia recurrente (cheatsheet, RFC)</li>');
  lines.push('<li><span class="lb-legend-icon">▸</span> <strong>otros</strong> — snippets, threads o tipos sin clasificar</li>');
  lines.push('</ul>');
  lines.push('<h4>Tags coloreados</h4>');
  lines.push('<p>Cada tag tiene un color determinístico calculado por hash: el mismo tag siempre se ve del mismo color en cualquier página. Sirve para reconocer visualmente sin leer.</p>');
  lines.push('</div>');
  lines.push('</details>');
  lines.push('');

  if (ctx.resources.length === 0) {
    // visual-replay-redesign V9 — pedagogical empty state.
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay referencias guardadas.</strong></p>');
    lines.push('<p>Usá <code>logbook resource --url "https://..." --kind doc</code> para guardar la primera referencia. Acá se acumulan los links útiles del proyecto.</p>');
    lines.push('</div>');
    lines.push("");
    return lines.join("\n");
  }

  // Group by kind.
  const byKind = new Map<string, RenderEvent[]>();
  for (const e of ctx.resources) {
    const kind = getKind(e);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)!.push(e);
  }

  // Emit per-kind sections.
  for (const [kind, resources] of byKind) {
    const icon = kindIcon(kind);
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    lines.push(`## ${icon} ${label}`);
    lines.push("");

    for (const e of resources) {
      const title = getTitle(e);
      const url = getUrl(e);
      const tags = getTags(e);
      const date = formatTs(e.ts);

      // Title as link if URL available.
      const titleLine = url ? `[${title}](${url})` : title;

      lines.push(`### ${titleLine}`);
      lines.push("");
      lines.push(`Added: ${date}`);

      if (typeof e["description"] === "string" && e["description"]) {
        lines.push("");
        lines.push(e["description"]);
      }

      if (tags.length > 0) {
        const chips = tags.map(tagChip).join(" ");
        lines.push("");
        lines.push(chips);
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}
