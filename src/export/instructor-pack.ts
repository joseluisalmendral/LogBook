/**
 * instructor-pack export module (iter5).
 *
 * Orchestrates collecting docs/ADRs/teaching-scripts from disk, generating
 * a TOC, rewriting cross-doc links, optionally redacting sensitive content,
 * and producing a single self-contained HTML file.
 *
 * Three pure helper functions (collectBundle, generateToc, rewriteDocLinks)
 * compose into the orchestrator exportInstructorPack.
 *
 * Design decisions:
 * - TOC generation uses remark-parse AST walking (mdast) — zero new deps.
 * - Link rewriting is a pure regex pass before concatenation.
 * - assertNoExternalRefs is the final gate (same as html.ts).
 * - Atomic write via temp file + rename.
 */

import { readFile, writeFile, rename, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, dirname } from "pathe";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { INLINE_CSS } from "./inline-css.js";
import { assertNoExternalRefs } from "./sanitize-links.js";
import { sanitizeForSafeExport, sanitizeCss } from "./safe.js";
import { preprocessMermaidPlaceholders, injectMermaidSvgs } from "./mermaid.js";
import {
  stripSpeakerBlocks,
  preprocessSpeakerPlaceholders,
  injectSpeakerDivs,
  type SpeakerBlock,
} from "../generate/speaker-blocks.js";
import type { ProjectPaths } from "../core/paths.js";
import type { ExportReport } from "../types/reports.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InstructorPackOptions {
  paths: ProjectPaths;
  /** Output path. Default: <dataDir>/exports/instructor-pack.html */
  outFile?: string;
  /** Redact paths/users/emails before rendering. Default: false. */
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

/** A single section in the bundle (one source file). */
export interface BundleSection {
  /** Anchor-safe identifier derived from filename stem (e.g. "0001-use-vite"). */
  id: string;
  /** Human-readable title (from first H1 heading or filename stem). */
  title: string;
  /** Raw markdown body (with doc-links already rewritten). */
  content: string;
}

/** Structured bundle of all collected sections. */
export interface BundleContents {
  /** Core overview docs: index, timeline, errors-and-lessons. */
  overview: BundleSection[];
  /** ADR files sorted by filename. */
  adrs: BundleSection[];
  /** Teaching script files sorted by filename. */
  teachingScripts: BundleSection[];
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Required overview doc filenames under <dataDir>/docs/. */
const OVERVIEW_FILES = [
  "index.md",
  "timeline.md",
  "errors-and-lessons.md",
] as const;

// ---------------------------------------------------------------------------
// Pure helper 1: collect bundle from disk
// ---------------------------------------------------------------------------

/**
 * Collect all bundle sections from the project's logbook directories.
 *
 * Throws with a clear error if any required overview doc is missing.
 * Missing optional dirs (decisions/, teaching-scripts/) are skipped gracefully.
 *
 * @param paths  ProjectPaths (uses paths.dataDir)
 * @returns      BundleContents — structured sections ready for TOC + concat
 */
export async function collectBundle(paths: ProjectPaths): Promise<BundleContents> {
  const docsDir = join(paths.dataDir, "docs");

  // --- Overview docs (required) ---
  const overview: BundleSection[] = [];
  for (const docName of OVERVIEW_FILES) {
    const docPath = join(docsDir, docName);
    if (!existsSync(docPath)) {
      throw new Error(
        `Missing generated doc: ${docPath}\n` +
          `Run \`logbook build\` first to generate the docs before exporting.`
      );
    }
    const content = await readFile(docPath, "utf8");
    const stem = docName.replace(/\.md$/, "");
    const title = extractFirstHeading(content) ?? stem;
    overview.push({ id: stem, title, content });
  }

  // --- ADRs (optional) ---
  const adrs: BundleSection[] = await collectMarkdownDir(
    join(paths.dataDir, "decisions")
  );

  // --- Teaching scripts (optional) ---
  const teachingScripts: BundleSection[] = await collectMarkdownDir(
    join(paths.dataDir, "teaching-scripts")
  );

  return { overview, adrs, teachingScripts };
}

/**
 * Read all .md files in a directory, sorted by filename.
 * Returns an empty array if the directory doesn't exist.
 */
async function collectMarkdownDir(dir: string): Promise<BundleSection[]> {
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const mdFiles = entries
    .filter((name) => name.endsWith(".md"))
    .sort(); // lexicographic sort — NNNN- prefix ensures correct order

  const sections: BundleSection[] = [];
  for (const fileName of mdFiles) {
    const filePath = join(dir, fileName);
    const content = await readFile(filePath, "utf8");
    const stem = basename(fileName, ".md");
    const title = extractFirstHeading(content) ?? stem;
    sections.push({ id: stem, title, content });
  }

  return sections;
}

// Inline AST node shape — avoids importing from mdast (not a direct dep).
interface MdastNode {
  type: string;
  depth?: number;
  children?: MdastNode[];
  value?: string;
}

/**
 * Extract the text content of the first H1 heading from markdown.
 * Returns null if no H1 is found.
 */
function extractFirstHeading(markdown: string): string | null {
  const parser = unified().use(remarkParse);
  const tree = parser.parse(markdown) as unknown as { children: MdastNode[] };

  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 1) {
      const text = (node.children ?? [])
        .map((child: MdastNode) => {
          if (child.type === "text" || child.type === "inlineCode") {
            return child.value ?? "";
          }
          return "";
        })
        .join("");
      return text || null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure helper 2: generate TOC
// ---------------------------------------------------------------------------

/**
 * Generate a markdown Table of Contents from bundle sections.
 *
 * Algorithm:
 * 1. Walk each section's markdown via remark-parse AST.
 * 2. Extract H1 (top-level) and H2 (nested) headings.
 * 3. Produce a nested markdown bulleted list with in-bundle anchors.
 *
 * Anchor format:
 * - Top-level section: #<section-id> (always anchor-safe)
 * - H2 headings: #<section-id>--<h2-slug> (concatenation avoids collisions)
 *
 * @param bundle  BundleContents from collectBundle
 * @returns       Markdown string (bulleted list)
 */
export function generateToc(bundle: BundleContents): string {
  const lines: string[] = ["## Table of Contents", ""];

  const allGroups: Array<{ label: string; sections: BundleSection[] }> = [
    { label: "Overview", sections: bundle.overview },
    { label: "ADRs", sections: bundle.adrs },
    { label: "Teaching Scripts", sections: bundle.teachingScripts },
  ];

  for (const group of allGroups) {
    if (group.sections.length === 0) continue;

    lines.push(`- **${group.label}**`);

    for (const section of group.sections) {
      // Top-level entry for the section
      lines.push(`  - [${section.title}](#${section.id})`);

      // Nested H2 headings from the section's content
      const h2s = extractH2Headings(section.content);
      for (const h2 of h2s) {
        const anchor = `${section.id}--${slugify(h2)}`;
        lines.push(`    - [${h2}](#${anchor})`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Extract text of all H2 headings from markdown (in AST order).
 */
function extractH2Headings(markdown: string): string[] {
  const parser = unified().use(remarkParse);
  const tree = parser.parse(markdown) as unknown as { children: MdastNode[] };
  const h2s: string[] = [];

  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 2) {
      const text = (node.children ?? [])
        .map((child: MdastNode) => {
          if (child.type === "text" || child.type === "inlineCode") {
            return child.value ?? "";
          }
          return "";
        })
        .join("");
      if (text) h2s.push(text);
    }
  }

  return h2s;
}

/**
 * Convert a heading text to a URL-safe anchor slug.
 * Lowercases, replaces spaces and special chars with hyphens.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // remove special chars except word chars, spaces, hyphens
    .replace(/\s+/g, "-")    // spaces → hyphens
    .replace(/-+/g, "-")     // collapse multiple hyphens
    .replace(/^-|-$/g, "");  // trim leading/trailing hyphens
}

// ---------------------------------------------------------------------------
// Pure helper 3: rewrite cross-document .md links to in-bundle anchors
// ---------------------------------------------------------------------------

/**
 * Rewrite relative .md cross-document links to in-bundle anchors.
 *
 * Converts:
 *   [text](path/to/NNNN-slug.md)  →  [text](#NNNN-slug)
 *   [text](./0002-foo.md)         →  [text](#0002-foo)
 *   [text](../decisions/0003.md)  →  [text](#0003)
 *
 * Preserves:
 *   [text](https://example.com)   unchanged
 *   ![img](path/to/img.png)       unchanged (image links)
 *   [plain text]                  unchanged (no link target)
 *
 * @param markdown  Source markdown string
 * @returns         Markdown with .md links rewritten to #anchor form
 */
export function rewriteDocLinks(markdown: string): string {
  // Match non-image markdown links: [text](target)
  // Not preceded by ! (to exclude image links)
  // Target must end with .md (case-insensitive) and must NOT start with http(s)://
  //
  // Regex breakdown:
  //   (?<!\!)        — negative lookbehind: not an image (!)
  //   \[([^\]]+)\]   — capture link text inside [...]
  //   \(             — opening (
  //   ([^)]+\.md)    — capture href ending in .md
  //   \)             — closing )
  const RE_DOC_LINK = /(?<!!)\[([^\]]+)\]\(([^)]+\.md)\)/gi;

  return markdown.replace(RE_DOC_LINK, (_match, text: string, href: string) => {
    // Reject external URLs even if they somehow end in .md
    if (/^https?:\/\//i.test(href)) {
      return _match; // unchanged
    }

    // Extract filename stem from the href path
    // e.g. "../decisions/0001-use-vite.md" → "0001-use-vite"
    const fileWithExt = href.split("/").pop() ?? href;
    const stem = fileWithExt.replace(/\.md$/i, "");

    return `[${text}](#${stem})`;
  });
}

// ---------------------------------------------------------------------------
// Internal: markdown → HTML pipeline
// ---------------------------------------------------------------------------

/**
 * Convert a markdown string to an HTML body fragment.
 *
 * Pipeline (SG2c refactor — placeholder pattern, no rehype-raw):
 * 1. preprocessMermaidPlaceholders — replace ```mermaid fences with
 *    LBMERMAID_<n> bare-text placeholders (renders as <p>LBMERMAID_<n></p>); stash rendered SVGs.
 * 2. remark-parse — parse markdown AST
 * 3. remark-rehype — convert to hast (no allowDangerousHtml needed)
 * 4. rehype-slug — add id attributes to headings for anchor navigation
 * 5. rehype-stringify — serialize to HTML (comments preserved verbatim)
 * 6. injectMermaidSvgs — replace placeholder comments with
 *    <div class="mermaid"><svg>…</svg></div> via string-replace
 * 7. injectSpeakerDivs (if speakerBlocks provided) — replace <p>LBSPEAKER_N</p>
 *    paragraphs with <div class="speaker-note">...</div>
 */
async function markdownToHtml(
  markdown: string,
  speakerBlocks?: SpeakerBlock[],
): Promise<string> {
  // Phase 1: extract mermaid fences → placeholders + SVG array.
  const { markdown: withPlaceholders, svgs } =
    await preprocessMermaidPlaceholders(markdown);

  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeStringify);

  const file = await processor.process(withPlaceholders);

  // Phase 2: inject sanitized SVG divs in place of comment placeholders.
  let html = injectMermaidSvgs(String(file), svgs);

  // Phase 3 (speaker mode): inject speaker note divs.
  if (speakerBlocks && speakerBlocks.length > 0) {
    html = injectSpeakerDivs(html, speakerBlocks);
  }

  return html;
}

/**
 * Wrap an HTML body fragment in a complete self-contained HTML document.
 * @param css  The CSS string to inline (either INLINE_CSS or a sanitized theme).
 */
function buildHtmlDocument(htmlBody: string, title: string, css: string): string {
  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `  <meta charset="utf-8">\n` +
    `  <title>${title}</title>\n` +
    `  <style>${css}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    htmlBody +
    `\n</body>\n` +
    `</html>\n`
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Export a single self-contained instructor-pack HTML file.
 *
 * Algorithm:
 * 1. collectBundle — read docs/ADRs/teaching-scripts from disk.
 * 2. Apply rewriteDocLinks to every section content.
 * 3. generateToc — markdown TOC string.
 * 4. If opts.safe — apply sanitizeForSafeExport to combined markdown.
 * 5. Concatenate: TOC + --- + overview + --- + ## ADRs + each ADR + --- + ## Teaching Scripts + each script.
 * 6. unified (remark-parse → remark-rehype → rehype-stringify) → HTML body.
 * 7. buildHtmlDocument — wrap with inlined CSS.
 * 8. assertNoExternalRefs — throws if any external ref slipped in.
 * 9. Atomic write (temp + rename).
 * 10. Return ExportReport.
 */
export async function exportInstructorPack(
  opts: InstructorPackOptions
): Promise<ExportReport> {
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

  const outFile =
    opts.outFile ?? join(paths.dataDir, "exports", "instructor-pack.html");

  // 1. Collect bundle sections
  const bundle = await collectBundle(paths);

  // 2. Rewrite cross-doc links in every section
  function rewriteSection(section: BundleSection): BundleSection {
    return { ...section, content: rewriteDocLinks(section.content) };
  }

  const rewritten: BundleContents = {
    overview: bundle.overview.map(rewriteSection),
    adrs: bundle.adrs.map(rewriteSection),
    teachingScripts: bundle.teachingScripts.map(rewriteSection),
  };

  // 3. Generate TOC
  const toc = generateToc(rewritten);

  // 4 & 5. Concatenate markdown
  const parts: string[] = [toc, "---"];

  // Overview sections
  for (const section of rewritten.overview) {
    parts.push(`<a id="${section.id}"></a>\n\n${section.content.trim()}`);
  }

  // ADRs section
  if (rewritten.adrs.length > 0) {
    parts.push("---");
    parts.push("## ADRs");
    for (const adr of rewritten.adrs) {
      parts.push(`<a id="${adr.id}"></a>\n\n${adr.content.trim()}`);
    }
  }

  // Teaching scripts section
  if (rewritten.teachingScripts.length > 0) {
    parts.push("---");
    parts.push("## Teaching Scripts");
    for (const script of rewritten.teachingScripts) {
      parts.push(`<a id="${script.id}"></a>\n\n${script.content.trim()}`);
    }
  }

  let combinedMarkdown = parts.join("\n\n");

  // 4 (safe pass). Apply after concatenation so redaction covers everything.
  if (opts.safe) {
    combinedMarkdown = sanitizeForSafeExport(combinedMarkdown);
  }

  // S6.2 — apply speaker block transformation before the unified pipeline.
  let speakerBlocks: SpeakerBlock[] | undefined;
  if (opts.speakerMode) {
    const result = preprocessSpeakerPlaceholders(combinedMarkdown);
    combinedMarkdown = result.markdown;
    speakerBlocks = result.blocks;
  } else {
    combinedMarkdown = stripSpeakerBlocks(combinedMarkdown);
  }

  // 6. Convert to HTML
  const htmlBody = await markdownToHtml(combinedMarkdown, speakerBlocks);

  // 7. Build full document
  const fullHtml = buildHtmlDocument(htmlBody, "LogBook — Instructor Pack", inlineCss);

  // 8. Assert no external refs
  assertNoExternalRefs(fullHtml);

  // 9. Atomic write
  const outDir = dirname(outFile);
  await mkdir(outDir, { recursive: true });

  const tmpFile = `${outFile}.tmp`;
  await writeFile(tmpFile, fullHtml, "utf8");
  await rename(tmpFile, outFile);

  const bytes = Buffer.byteLength(fullHtml, "utf8");
  const durationMs = Date.now() - start;

  // 10. Return ExportReport
  return {
    outFile,
    bytes,
    externalRefs: 0,
    durationMs,
  };
}
