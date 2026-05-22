/**
 * HTML export pipeline (T12).
 *
 * Reads the source docs from logbook/docs/, converts Markdown to HTML
 * via remark/rehype, inlines the CSS, asserts zero external refs, writes
 * the result atomically to logbook/exports/index.html.
 *
 * Design §7 — HTML export section.
 * Hard contract: assertNoExternalRefs throws if any external ref slips through.
 *
 * export-rich-interactive slice:
 *   - SOURCE_DOCS extended from 4 to 9 entries (ADR-29).
 *   - OPTIONAL_DOCS set extended to cover all 5 new docs.
 *   - markdownToHtml extracted to shared module (ADR-23).
 *   - buildHtmlDocument extracted to shared module (ADR-27).
 *   - Inline JS + JSON data block injected (ADR-24).
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "pathe";
import { INLINE_CSS } from "./inline-css.js";
import { INLINE_JS } from "./inline-js.js";
import { assertNoExternalRefs } from "./sanitize-links.js";
import { sanitizeForSafeExport, sanitizeCss } from "./safe.js";
import { markdownToHtml } from "./markdown-to-html.js";
import { buildHtmlDocument } from "./build-html-document.js";
import {
  stripSpeakerBlocks,
  preprocessSpeakerPlaceholders,
  type SpeakerBlock,
} from "../generate/speaker-blocks.js";
import { readContext } from "../generate/render-context.js";
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
  /**
   * Absolute or relative path to a custom CSS theme file (S2.4).
   * When set, the file is read (UTF-8), run through sanitizeCss(), and used
   * INSTEAD of INLINE_CSS. Throws if the file cannot be read.
   */
  themePath?: string;
  /**
   * Speaker mode (S6.2).
   * When true, <!-- logbook:speaker start --> ... <!-- logbook:speaker end --> blocks
   * are rendered as <div class="speaker-note">...</div> in the output HTML.
   * When false (default), speaker blocks are stripped entirely.
   */
  speakerMode?: boolean;
}

/**
 * Names of the 9 source doc files under logbook/docs/.
 * ADR-01: explicit manifest — export order is authoritative here, not derived
 * from runAllGenerators.
 * ADR-29: all 5 new docs are in OPTIONAL_DOCS (graceful upgrade path).
 *
 * Section order (EH-1 spec):
 *   Dashboard → Sessions → Decisions → Resources → Milestones
 *   → Project Index → Commits → Errors and Lessons
 *
 * Note: "Timeline" is a pre-existing section (index.md adjacent) not mentioned
 * in spec EH-1. It is placed after Project Index as an additive section.
 * "Errors and Lessons" is the combined file serving both the Errors and Lessons
 * spec sections; kept combined as a single file at the end per EH-1.
 */
const SOURCE_DOCS = [
  "dashboard.md",
  "sessions.md",
  "decisions.md",
  "resources.md",
  "milestones.md",
  "index.md",
  "timeline.md",
  "commits.md",
  "errors-and-lessons.md",
] as const;

/** Section labels used when concatenating the docs. */
const SECTION_LABELS: Record<string, string> = {
  "dashboard.md": "Dashboard",
  "sessions.md": "Sessions",
  "decisions.md": "Decisions",
  "resources.md": "Resources",
  "milestones.md": "Milestones",
  "index.md": "Project Index",
  "timeline.md": "Timeline",
  "commits.md": "Commits",
  "errors-and-lessons.md": "Errors and Lessons",
};

/**
 * Export all source docs to a single self-contained HTML file.
 *
 * Algorithm:
 * 1. Read logbook/docs/*.md (9 entries). Required docs throw if missing;
 *    optional docs (ADR-29) are gracefully skipped.
 * 2. Concatenate with section dividers.
 * 3. Render Markdown → HTML via shared markdownToHtml (ADR-23).
 * 4. Build full HTML document with inlined CSS, TOC nav, JSON data block,
 *    and inline JS (buildHtmlDocument — ADR-24, ADR-27).
 * 5. assertNoExternalRefs — throws if any non-allowlisted external ref slipped in.
 * 6. Write atomically (temp file + rename). Ensure parent dir exists.
 * 7. Return ExportReport.
 */
export async function exportHtml(opts: ExportOptions): Promise<ExportReport> {
  const start = Date.now();
  const { paths } = opts;

  // S2.4 — load and sanitize custom theme if provided; otherwise use default.
  let inlineCss = INLINE_CSS;
  if (opts.themePath) {
    let rawTheme: string;
    try {
      rawTheme = await readFile(opts.themePath, "utf8");
    } catch (err) {
      throw new Error(
        `theme file could not be read: ${opts.themePath} — ${err instanceof Error ? err.message : String(err)}`
      );
    }
    inlineCss = sanitizeCss(rawTheme);
  }

  const docsDir = join(paths.dataDir, "docs");
  const outFile =
    opts.outFile ?? join(paths.dataDir, "exports", "index.html");

  /**
   * Docs that may be absent without aborting the export. ADR-29.
   * commits.md: generated only when git history is present.
   * New generator docs: may be absent on legacy projects that haven't run
   * `logbook build` since the export-rich-interactive slice was added.
   */
  const OPTIONAL_DOCS = new Set([
    "commits.md",
    "sessions.md",
    "dashboard.md",
    "decisions.md",
    "resources.md",
    "milestones.md",
  ]);

  // 1. Read source docs — fail fast if required docs are missing; skip optional ones.
  const markdownParts: string[] = [];
  for (const docName of SOURCE_DOCS) {
    const docPath = join(docsDir, docName);
    if (!existsSync(docPath)) {
      if (OPTIONAL_DOCS.has(docName)) {
        // Graceful skip: commits.md may not exist if no sessions have been recorded
        // or the project has no git history. Export continues without a Commits section.
        continue;
      }
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
  let combinedMarkdown = markdownParts.join("\n\n---\n\n");

  // S6.2 — apply speaker block transformation before the unified pipeline.
  let speakerBlocks: SpeakerBlock[] | undefined;
  if (opts.speakerMode) {
    const result = preprocessSpeakerPlaceholders(combinedMarkdown);
    combinedMarkdown = result.markdown;
    speakerBlocks = result.blocks;
  } else {
    combinedMarkdown = stripSpeakerBlocks(combinedMarkdown);
  }

  // 3. Convert markdown to HTML body fragment.
  const htmlBody = await markdownToHtml(combinedMarkdown, speakerBlocks);

  // 4. Build data payload for inline JS (ADR-24).
  // Read all events from JSONL, map to the narrow LbData shape (only fields
  // needed for client-side filtering/searching — no raw blobs, no secrets).
  const ctx = await readContext(paths);
  const lbData = {
    version: 1 as const,
    defaultRange: "all" as const,
    events: ctx.all.map((e) => {
      // Build a narrowly-typed object; omit undefined fields to keep JSON small.
      const entry: {
        id: string;
        ts: string;
        type: string;
        title?: string;
        description?: string;
        sessionId?: string;
        phase?: string;
        tags?: string[];
        fileRefs?: string[];
        severity?: string;
        status?: string;
      } = {
        id: e.id,
        ts: e.ts,
        type: e.type,
      };
      if (typeof e["title"] === "string") entry.title = e["title"];
      if (typeof e["description"] === "string") entry.description = e["description"];
      if (typeof e["sessionId"] === "string") entry.sessionId = e["sessionId"];
      if (typeof e["phase"] === "string") entry.phase = e["phase"];
      if (Array.isArray(e["tags"])) entry.tags = e["tags"] as string[];
      if (Array.isArray(e["fileRefs"])) entry.fileRefs = e["fileRefs"] as string[];
      if (typeof e["severity"] === "string") entry.severity = e["severity"];
      if (typeof e["status"] === "string") entry.status = e["status"];
      return entry;
    }),
  };

  // 5. Build the full HTML document with TOC nav, data block, and inline JS.
  const fullHtml = buildHtmlDocument(htmlBody, "LogBook", inlineCss, INLINE_JS, lbData);

  // 6. Sanitize — throws if any external ref is detected outside allowlist.
  const sanitizeResult = assertNoExternalRefs(fullHtml);

  // 7. Write atomically (temp file + rename).
  const outDir = dirname(outFile);
  await mkdir(outDir, { recursive: true });

  const tmpFile = `${outFile}.tmp`;
  await writeFile(tmpFile, fullHtml, "utf8");
  await rename(tmpFile, outFile);

  const bytes = Buffer.byteLength(fullHtml, "utf8");
  const durationMs = Date.now() - start;

  // 8. Return ExportReport.
  return {
    outFile,
    bytes,
    externalRefs: sanitizeResult.externalRefs,
    allowedRefs: sanitizeResult.allowedRefs,
    durationMs,
  };
}
