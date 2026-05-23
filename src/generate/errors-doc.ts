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

  // T7.2: pedagogical page hero (ADR-D6, cognitive-doc-design).
  const errorCount = ctx.errors.length;
  const resolvedCount = ctx.errors.filter(
    (e) => typeof e["status"] === "string" && e["status"] === "resolved"
  ).length;
  lines.push("# Errors");
  lines.push("");
  lines.push('<header class="lb-page-hero">');
  // Phase 4 T4.1 — cognitive-doc-design: lead with the count, then the triage signpost.
  // Errors render as red-bordered cards; linked fixes (green) live inside <details>.
  const openCount = errorCount - resolvedCount;
  const triageLine = errorCount === 0
    ? 'No errors yet captured.'
    : `${openCount} open, ${resolvedCount} resolved. Red-bordered cards are unresolved; expand a card to see its linked fixes.`;
  lines.push(`<p class="lb-page-intro">${errorCount} error${errorCount !== 1 ? 's' : ''} on file. ${triageLine}</p>`);
  lines.push('</header>');
  lines.push('');

  // legends-and-pedagogical-decode — "How to read this" collapsible.
  lines.push('<details class="lb-how-to-read">');
  lines.push('<summary>¿Cómo leer esta página?</summary>');
  lines.push('<div class="lb-how-to-read-body">');
  lines.push('<p>Cada card es un error registrado con <code>logbook error</code>. Si después marcaste un fix con <code>logbook fix</code>, aparece adentro del card al expandirlo.</p>');
  lines.push('<h4>Color del borde izquierdo</h4>');
  lines.push('<ul>');
  lines.push('<li><span class="lb-legend-strip" style="background:#dc2626"></span> <strong>Rojo</strong> — error sin fix linkeado (abierto)</li>');
  lines.push('<li><span class="lb-legend-strip" style="background:#16a34a"></span> <strong>Verde</strong> — el fix también aparece dentro del card, también con borde verde</li>');
  lines.push('<li><span class="lb-legend-strip" style="background:#d4a72c"></span> <strong>Ámbar</strong> — lección capturada (lesson), no es un error sino un aprendizaje</li>');
  lines.push('</ul>');
  lines.push('<h4>Estados</h4>');
  lines.push('<ul>');
  lines.push('<li><strong>open</strong> — el error sigue sin resolverse</li>');
  lines.push('<li><strong>resolved</strong> — hay al menos un fix asociado</li>');
  lines.push('</ul>');
  lines.push('<h4>Iconos</h4>');
  lines.push('<ul>');
  lines.push('<li><span class="lb-legend-icon">🐛</span> error registrado</li>');
  lines.push('<li><span class="lb-legend-icon">🛠️</span> fix vinculado al error de arriba</li>');
  lines.push('<li><span class="lb-legend-icon">💡</span> lesson — aprendizaje sin error asociado</li>');
  lines.push('</ul>');
  lines.push('</div>');
  lines.push('</details>');
  lines.push('');

  // --- Errors and fixes section ---
  lines.push("## Errors and fixes");
  lines.push("");

  // Helper: escape HTML special chars for safe attribute / inner-text emission.
  const esc = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  if (ctx.errors.length === 0) {
    // visual-replay-redesign V9 — pedagogical empty state.
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay errores registrados.</strong></p>');
    lines.push('<p>Cuando algo falle, usá <code>logbook error "descripción"</code> para dejar constancia. Cada error documentado es una lección futura.</p>');
    lines.push('</div>');
  } else {
    // visual-replay-redesign V7 — event-card audit. Errors render as
    // `<li class="lb-event lb-evt-error">` cards rather than plain headings
    // so the per-kind left border + icon contract holds across all pages.
    lines.push('<ul class="lb-event-list">');
    for (const e of ctx.errors) {
      const title = esc(eventTitle(e));
      const kind = typeof e["kind"] === "string" ? ` (${esc(String(e["kind"]))})` : "";
      const desc =
        typeof e["description"] === "string" && e["description"]
          ? `<div class="lb-event-body">${esc(e["description"])}</div>`
          : "";
      const linked = fixesForError(ctx.fixes, e.id);
      let fixesHtml = "";
      if (linked.length > 0) {
        const items = linked
          .map((f) => {
            const fixTitle = esc(eventTitle(f));
            const fixDesc =
              typeof f["description"] === "string" && f["description"]
                ? ` &mdash; ${esc(f["description"])}`
                : "";
            return `<li class="lb-event lb-evt-fix"><span class="lb-event-icon" aria-hidden="true">&#x1F528;</span> <span class="lb-event-summary">${fixTitle}${fixDesc}</span></li>`;
          })
          .join("");
        fixesHtml = `<details class="lb-event-detail"><summary>Linked fixes (${linked.length})</summary><ul class="lb-event-list lb-event-list-nested">${items}</ul></details>`;
      }
      lines.push(
        `<li class="lb-event lb-evt-error" data-event-id="${esc(e.id)}">` +
        `<span class="lb-event-icon" aria-hidden="true">&#x1F41B;</span> ` +
        `<span class="lb-event-summary"><strong>${title}</strong>${kind}</span>` +
        desc +
        fixesHtml +
        `</li>`,
      );
    }
    lines.push('</ul>');
  }

  lines.push("");

  // --- Lessons section ---
  lines.push("## Lessons");
  lines.push("");

  if (ctx.lessons.length === 0) {
    // visual-replay-redesign V9 — pedagogical empty state.
    lines.push('<div class="lb-empty-state" role="status">');
    lines.push('<p><strong>Aún no hay lecciones promovibles.</strong></p>');
    lines.push('<p>Una vez que cierres un error, usá <code>logbook lesson "lo que aprendiste"</code> para dejarla acá. Las lecciones promovibles se vuelven semillas para futuros proyectos.</p>');
    lines.push('</div>');
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

    // visual-replay-redesign V7 — event-card pattern across all event lists.
    lines.push('<ul class="lb-event-list">');
    for (const l of sorted) {
      const title = esc(eventTitle(l));
      const isPromotable = l["promotable"] === true;
      const promotableTag = isPromotable
        ? ' <span class="lb-badge lb-badge--promotable">promotable</span>'
        : "";
      const bodyText =
        typeof l["body"] === "string" && l["body"]
          ? l["body"]
          : typeof l["text"] === "string"
            ? l["text"]
            : "";
      const body = bodyText
        ? `<div class="lb-event-body">${esc(bodyText)}</div>`
        : "";

      const tags = l["tags"];
      let tagsHtml = "";
      if (Array.isArray(tags) && tags.length > 0) {
        const chips = (tags as unknown[])
          .filter((t): t is string => typeof t === "string" && t.length > 0)
          .map((t) => `<span class="lb-tag">${esc(t)}</span>`)
          .join(" ");
        tagsHtml = `<div class="lb-event-tags">${chips}</div>`;
      }

      lines.push(
        `<li class="lb-event lb-evt-lesson" data-event-id="${esc(l.id)}">` +
        `<span class="lb-event-icon" aria-hidden="true">&#x1F4A1;</span> ` +
        `<span class="lb-event-summary"><strong>${title}</strong>${promotableTag}</span>` +
        body +
        tagsHtml +
        `</li>`,
      );
    }
    lines.push('</ul>');
  }

  return lines.join("\n");
}
