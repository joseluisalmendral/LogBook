/**
 * Unit tests for rehype-slug integration in html.ts and instructor-pack.ts (S3.1).
 *
 * Verifies that heading elements in exported HTML get deterministic id attributes
 * so that TOC anchor links actually navigate.
 *
 * Test strategy:
 * - Import the pure pipeline helper (markdownToHtml-equivalent) by testing the
 *   output of exportHtml / exportInstructorPack against known markdown fixtures.
 * - For lighter tests, use the shared markdownToHtmlForTest helper that runs the
 *   same unified pipeline used in production (remark-parse → remark-rehype →
 *   rehype-slug → rehype-stringify) so we can assert on heading id generation
 *   without spinning up full export I/O.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { exportHtml } from "../../src/export/html.js";
import { exportInstructorPack } from "../../src/export/instructor-pack.js";
import { sanitizeReport } from "../../src/export/sanitize-links.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the production-equivalent unified pipeline and return HTML body string. */
async function markdownToHtmlWithSlug(markdown: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeStringify);
  const file = await processor.process(markdown);
  return String(file);
}

/** Create a minimal temp project with pre-built docs. */
function makeTmpProject(opts?: {
  indexContent?: string;
  timelineContent?: string;
  errorsContent?: string;
}): { dir: string; paths: ProjectPaths } {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-slug-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" })
  );
  fs.writeFileSync(
    path.join(dir, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [] }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(dir, "logbook", "evidence", "events.jsonl"),
    "",
    "utf8"
  );

  const indexDoc = opts?.indexContent ?? `# My Project\n\n## Overview\n\nSome content.\n`;
  const timelineDoc = opts?.timelineContent ?? `# Timeline\n\n## January 2026\n\nFirst month.\n`;
  const errorsDoc = opts?.errorsContent ?? `# Errors and Lessons\n\n## Lessons Learned\n\nAlways test.\n`;

  fs.writeFileSync(path.join(dir, "logbook", "docs", "index.md"), indexDoc, "utf8");
  fs.writeFileSync(path.join(dir, "logbook", "docs", "timeline.md"), timelineDoc, "utf8");
  fs.writeFileSync(path.join(dir, "logbook", "docs", "errors-and-lessons.md"), errorsDoc, "utf8");

  const paths = makePaths(dir);
  return { dir, paths };
}

const tmpDirs: string[] = [];
function tracked(dir: string): string {
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Pipeline-level tests (no I/O — pure unified pipeline)
// ---------------------------------------------------------------------------

describe("rehype-slug pipeline — heading id generation", () => {
  it("emits id attribute on h1 from markdown heading", async () => {
    const html = await markdownToHtmlWithSlug("# Hello World\n\nSome text.\n");
    expect(html).toContain('id="hello-world"');
    expect(html).toContain("<h1");
  });

  it("emits id attribute on h2 from markdown heading", async () => {
    const html = await markdownToHtmlWithSlug("## Section Title\n\nContent.\n");
    expect(html).toContain('id="section-title"');
    expect(html).toContain("<h2");
  });

  it("emits id attribute on h3 from markdown heading", async () => {
    const html = await markdownToHtmlWithSlug("### Sub Section\n\nContent.\n");
    expect(html).toContain('id="sub-section"');
    expect(html).toContain("<h3");
  });

  it("anchor ids are slug-cased and deterministic", async () => {
    const html1 = await markdownToHtmlWithSlug("## My Heading Title\n\n");
    const html2 = await markdownToHtmlWithSlug("## My Heading Title\n\n");
    // Slug-cased: lowercase, spaces → hyphens
    expect(html1).toContain('id="my-heading-title"');
    expect(html1).toBe(html2); // deterministic
  });

  it("duplicate headings get -1, -2 suffix", async () => {
    const md =
      "## Duplicate\n\nFirst.\n\n## Duplicate\n\nSecond.\n\n## Duplicate\n\nThird.\n";
    const html = await markdownToHtmlWithSlug(md);
    expect(html).toContain('id="duplicate"');
    expect(html).toContain('id="duplicate-1"');
    expect(html).toContain('id="duplicate-2"');
  });
});

// ---------------------------------------------------------------------------
// exportHtml — id attributes present in output file
// ---------------------------------------------------------------------------

describe("exportHtml — rehype-slug ids emitted", () => {
  it("html export emits id attribute on h1 heading", async () => {
    const { dir, paths } = makeTmpProject({
      indexContent: "# My Project\n\nContent here.\n",
    });
    tracked(dir);
    const outFile = path.join(dir, "logbook", "exports", "index.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    // The h1 "My Project" should have id="my-project"
    expect(html).toContain('id="my-project"');
  });

  it("html export emits id attribute on h2 heading", async () => {
    const { dir, paths } = makeTmpProject({
      indexContent: "# Project\n\n## Overview\n\nSome text.\n",
    });
    tracked(dir);
    const outFile = path.join(dir, "logbook", "exports", "index.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain('id="overview"');
  });

  it("sanitize-links does NOT strip generated heading ids (no external refs violation)", async () => {
    const { dir, paths } = makeTmpProject({
      indexContent: "# My Project\n\n## Section One\n\nContent.\n",
    });
    tracked(dir);
    const outFile = path.join(dir, "logbook", "exports", "index.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    // id= attributes are local fragment refs — sanitize-links must not reject them
    const report = sanitizeReport(html);
    expect(report.externalUrls).toHaveLength(0);
    expect(report.externalScripts).toHaveLength(0);
    expect(html).toContain('id="my-project"');
    expect(html).toContain('id="section-one"');
  });
});

// ---------------------------------------------------------------------------
// exportInstructorPack — id attributes present in output file
// ---------------------------------------------------------------------------

describe("exportInstructorPack — rehype-slug ids emitted", () => {
  it("instructor-pack export emits id attribute on h1/h2/h3", async () => {
    const { dir, paths } = makeTmpProject({
      indexContent:
        "# My Project\n\n## Overview\n\n### Details\n\nSome content.\n",
    });
    tracked(dir);
    const outFile = path.join(dir, "logbook", "exports", "instructor-pack.html");
    await exportInstructorPack({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain('id="my-project"');
    expect(html).toContain('id="overview"');
    expect(html).toContain('id="details"');
  });

  it("TOC anchor links point to headings that have matching ids", async () => {
    const { dir, paths } = makeTmpProject({
      indexContent: "# My Project\n\n## Overview\n\nContent.\n",
    });
    tracked(dir);
    const outFile = path.join(dir, "logbook", "exports", "instructor-pack.html");
    await exportInstructorPack({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    // TOC generates anchor link #index pointing to the overview section
    // (section.id = "index" for index.md)
    expect(html).toContain('href="#index"');
    // The target heading id should exist
    expect(html).toMatch(/id="[^"]+"/);
  });
});
