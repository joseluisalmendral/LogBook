/**
 * buildHtmlDocument — extract from html.ts (ADR-27).
 *
 * Assembles a complete HTML document from an HTML body fragment, inline CSS,
 * optional inline JS, and optional JSON data payload.
 *
 * Additional responsibilities (new in export-rich-interactive slice):
 *   - Builds a <nav class="lb-toc"> by scanning htmlBody for <h2 id="..."> pairs
 *     (rehype-slug already adds id attributes to all headings). ADR-27.
 *   - Injects <script type="application/json" id="lb-data"> before inline JS. ADR-24.
 *   - Injects inline JS right before </body>. ADR-24.
 *
 * Signature extended: (htmlBody, title, css, js?, dataJson?) => string.
 * The original 3-argument call from html.ts is still valid (js/dataJson default to undefined).
 */

// ---------------------------------------------------------------------------
// TOC builder (ADR-27)
// ---------------------------------------------------------------------------

interface TocEntry {
  id: string;
  text: string;
}

/**
 * Scan an HTML body string for <h2 id="...">...</h2> pairs.
 * rehype-slug guarantees id attributes on all headings, so a simple regex
 * over the serialised HTML is reliable and fast.
 *
 * Returns an array of { id, text } ordered by document position.
 */
function extractH2Entries(htmlBody: string): TocEntry[] {
  // Match <h2 id="the-id">Text content</h2>
  // The inner content may contain spans (rehype-slug wraps nothing — text is direct).
  const RE = /<h2[^>]+id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi;
  const entries: TocEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE.exec(htmlBody)) !== null) {
    const id = m[1]!;
    // Strip any nested tags from the text (e.g. <a class="lb-anchor">¶</a>)
    const rawText = m[2]!.replace(/<[^>]+>/g, "").trim();
    if (id && rawText) {
      entries.push({ id, text: rawText });
    }
  }
  return entries;
}

/**
 * Build a <nav class="lb-toc"> HTML fragment from TOC entries.
 * Renders as a sticky right-rail on large viewports (CSS handles positioning).
 * On mobile it collapses to a top bar via media query.
 */
function buildTocNav(entries: TocEntry[]): string {
  if (entries.length === 0) return "";

  const items = entries
    .map((e) => `      <li><a href="#${e.id}">${e.text}</a></li>`)
    .join("\n");

  return (
    `<nav class="lb-toc" aria-label="Sections">\n` +
    `    <ul>\n` +
    items + "\n" +
    `    </ul>\n` +
    `  </nav>\n`
  );
}

// ---------------------------------------------------------------------------
// JSON serialization helper (ADR-24)
// ---------------------------------------------------------------------------

/**
 * Serialize data to JSON and escape </script> sequences to prevent
 * script-tag injection when embedded inside a <script> block.
 *
 * Replaces `</` with `<\/` (the backslash is legal JSON and ignored by parsers).
 */
function serializeDataBlock(data: unknown): string {
  return JSON.stringify(data).replace(/<\//g, "<\\/");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap an HTML body fragment in a complete HTML document.
 *
 * @param htmlBody  Pre-rendered HTML body (from markdownToHtml).
 * @param title     Value for the <title> element.
 * @param css       Inline CSS string (INLINE_CSS or sanitised theme).
 * @param js        Optional inline JS string (INLINE_JS). Injected before </body>.
 * @param dataJson  Optional data payload object serialized to JSON and
 *                  injected as <script type="application/json" id="lb-data">.
 */
export function buildHtmlDocument(
  htmlBody: string,
  title: string,
  css: string,
  js?: string,
  dataJson?: unknown,
): string {
  const tocNav = buildTocNav(extractH2Entries(htmlBody));

  // Build the script blocks before </body>.
  let scriptBlocks = "";
  if (dataJson !== undefined) {
    scriptBlocks +=
      `<script type="application/json" id="lb-data">` +
      serializeDataBlock(dataJson) +
      `</script>\n`;
  }
  if (js) {
    scriptBlocks += `<script>${js}</script>\n`;
  }

  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `  <meta charset="utf-8">\n` +
    `  <title>${title}</title>\n` +
    `  <style>${css}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `<main class="lb-doc">\n` +
    `  ${tocNav}` +
    htmlBody +
    `\n</main>\n` +
    scriptBlocks +
    `</body>\n` +
    `</html>\n`
  );
}
