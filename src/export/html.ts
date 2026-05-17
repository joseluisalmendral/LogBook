/**
 * HTML export pipeline (T12).
 *
 * Reads the 3 generated docs from logbook/docs/, converts Markdown to HTML
 * via remark/rehype, inlines the CSS, asserts zero external refs, writes
 * the result atomically to logbook/exports/index.html.
 *
 * Design §7 — HTML export section.
 * Hard contract: assertNoExternalRefs throws if any external ref slips through.
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "pathe";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { INLINE_CSS } from "./inline-css.js";
import { assertNoExternalRefs } from "./sanitize-links.js";
import { sanitizeForSafeExport } from "./safe.js";
import type { ProjectPaths } from "../core/paths.js";
import type { ExportReport } from "../types/reports.js";

export interface ExportOptions {
  paths: ProjectPaths;
  /** Output path. Default: <projectRoot>/logbook/exports/index.html */
  outFile?: string;
  /**
   * Enable safe-export redaction before the markdown is passed to the
   * rehype pipeline. Redacts absolute paths, usernames, and email addresses.
   * Default: false (original behaviour unchanged).
   */
  safe?: boolean;
}

/** Names of the 3 source doc files under logbook/docs/. */
const SOURCE_DOCS = [
  "index.md",
  "timeline.md",
  "errors-and-lessons.md",
] as const;

/** Section labels used when concatenating the docs. */
const SECTION_LABELS: Record<string, string> = {
  "index.md": "Project Index",
  "timeline.md": "Timeline",
  "errors-and-lessons.md": "Errors and Lessons",
};

/**
 * Build a full self-contained HTML document from a Markdown body string.
 * Inlines the CSS. Returns the complete HTML string (not yet sanitized).
 */
async function markdownToHtml(markdown: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeStringify);

  const file = await processor.process(markdown);
  return String(file);
}

/**
 * Wrap an HTML body fragment in a complete HTML document with inlined CSS.
 */
function buildHtmlDocument(htmlBody: string, title: string): string {
  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `  <meta charset="utf-8">\n` +
    `  <title>${title}</title>\n` +
    `  <style>${INLINE_CSS}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    htmlBody +
    `\n</body>\n` +
    `</html>\n`
  );
}

/**
 * Export all 3 generated docs to a single self-contained HTML file.
 *
 * Algorithm:
 * 1. Read logbook/docs/{index,timeline,errors-and-lessons}.md. Throw if missing.
 * 2. Concatenate with section dividers.
 * 3. Render Markdown → HTML via unified (remark-parse → remark-rehype → rehype-stringify).
 * 4. Build full HTML document with inlined CSS.
 * 5. assertNoExternalRefs — throws if any external ref slipped in.
 * 6. Write atomically (temp file + rename). Ensure parent dir exists.
 * 7. Return ExportReport.
 */
export async function exportHtml(opts: ExportOptions): Promise<ExportReport> {
  const start = Date.now();
  const { paths } = opts;

  const docsDir = join(paths.dataDir, "docs");
  const outFile =
    opts.outFile ?? join(paths.dataDir, "exports", "index.html");

  // 1. Read source docs — fail fast if any are missing.
  const markdownParts: string[] = [];
  for (const docName of SOURCE_DOCS) {
    const docPath = join(docsDir, docName);
    if (!existsSync(docPath)) {
      throw new Error(
        `Missing generated doc: ${docPath}\n` +
          `Run \`logbook build\` first to generate the docs before exporting.`
      );
    }
    let content = await readFile(docPath, "utf8");

    // Safe-export pass: redact BEFORE markdown reaches the rehype pipeline.
    // Order: safe sanitize → markdown concat → rehype → inline CSS → sanitize-links.
    if (opts.safe) {
      content = sanitizeForSafeExport(content);
    }

    const label = SECTION_LABELS[docName] ?? docName;
    // Add a section header + content + divider
    markdownParts.push(`## ${label}\n\n${content.trim()}`);
  }

  // 2. Concatenate with horizontal rules as section dividers.
  const combinedMarkdown = markdownParts.join("\n\n---\n\n");

  // 3 & 4. Convert to HTML and build the full document.
  const htmlBody = await markdownToHtml(combinedMarkdown);
  const fullHtml = buildHtmlDocument(htmlBody, "LogBook");

  // 5. Sanitize — throws if any external ref is detected.
  assertNoExternalRefs(fullHtml);

  // 6. Write atomically (temp file + rename).
  const outDir = dirname(outFile);
  await mkdir(outDir, { recursive: true });

  const tmpFile = `${outFile}.tmp`;
  await writeFile(tmpFile, fullHtml, "utf8");
  await rename(tmpFile, outFile);

  const bytes = Buffer.byteLength(fullHtml, "utf8");
  const durationMs = Date.now() - start;

  // 7. Return ExportReport.
  return {
    outFile,
    bytes,
    externalRefs: 0,
    durationMs,
  };
}
