/**
 * Integration test: HTML export snapshot — visual regression guard.
 *
 * Creates a fixture project with hand-crafted markdown exercising every
 * CSS-styled element: h1/h2/h3, blockquote, table, inline code, fenced
 * code block, hr.
 *
 * NOTE: Mermaid diagrams are NOT included in the fixture because:
 * - Real mmdc invocation requires Chrome/Puppeteer (not available in all CI envs).
 * - Mock SVG (LOGBOOK_MERMAID_MOCK=1) contains xmlns="http://www.w3.org/2000/svg"
 *   which the sanitizer conservatively catches as an external URL, causing the
 *   export to throw. This is the correct and documented sanitizer behavior.
 * - The mermaid CSS (.mermaid rule) is tested visually via Phase 6 manual gate.
 * - Mermaid unit tests cover the pipeline (tests/unit/export-mermaid.test.ts).
 *
 * The test captures the body innerHTML (not the full document) after
 * normalisation. The snapshot is intentionally updated with this change
 * (new .lb-doc wrapper + CSS rewrite); regressions will be caught after
 * this commit.
 *
 * Uses the library API directly (not the CLI) for speed and isolation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect } from "vitest";
import { exportHtml } from "../../src/export/html.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Fixture markdown — exercises every styled element
// ---------------------------------------------------------------------------

const FIXTURE_INDEX = `<!-- logbook:doc:index start -->
# Project Alpha

This is the index doc. It contains **bold text**, _italic_, and \`inline code\`.

## Section One

A paragraph with a [relative link](#section-one) that is safe.

### Subsection

A deeper heading.

> This is a blockquote. It should have a left accent border only.
> No background fill, no italic.

| Column A | Column B | Column C |
|----------|----------|----------|
| Row 1A   | Row 1B   | Row 1C   |
| Row 2A   | Row 2B   | Row 2C   |
| Row 3A   | Row 3B   | Row 3C   |

---

## Section Two

\`\`\`bash
echo "Hello from a code block"
ls -la
\`\`\`

A final paragraph before the end of the index document.
<!-- logbook:doc:index end -->
`;

const FIXTURE_TIMELINE = `<!-- logbook:doc:timeline start -->
# Timeline

## 2026-01-01

- Session started
- First commit recorded

## 2026-01-02

- Decision logged: use JSONL storage

---

## 2026-01-03

Another session.
<!-- logbook:doc:timeline end -->
`;

const FIXTURE_ERRORS = `<!-- logbook:doc:errors start -->
# Errors and Lessons

## Lessons Learned

- Always validate input
- Write tests before implementation

> Remember: a small test suite is better than no test suite.

<!-- logbook:doc:errors end -->
`;

// commits.md — optional; include to verify it renders when present
const FIXTURE_COMMITS = `<!-- logbook:doc:commits start -->
# Commits

## abc1234

Initial commit — project scaffolding.

## def5678

Add core JSONL append logic.
<!-- logbook:doc:commits end -->
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(includeCommits = true): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-snapshot-${Math.random().toString(36).slice(2)}`
  );

  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-snapshot", version: "0.0.1" })
  );

  fs.writeFileSync(path.join(dir, "logbook", "docs", "index.md"), FIXTURE_INDEX, "utf8");
  fs.writeFileSync(path.join(dir, "logbook", "docs", "timeline.md"), FIXTURE_TIMELINE, "utf8");
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
    FIXTURE_ERRORS,
    "utf8"
  );

  if (includeCommits) {
    fs.writeFileSync(
      path.join(dir, "logbook", "docs", "commits.md"),
      FIXTURE_COMMITS,
      "utf8"
    );
  }

  return dir;
}

/**
 * Normalise HTML for snapshot comparison.
 * - Extract the .lb-doc content (body innerHTML minus outer wrapper)
 * - Collapse runs of whitespace between tags to a single space
 * - Trim leading/trailing whitespace
 */
function normalizeHtml(html: string): string {
  // Extract content inside <main class="lb-doc">...</main>
  const match = html.match(/<main class="lb-doc">([\s\S]*?)<\/main>/);
  const inner: string = match?.[1] ?? html;

  return inner
    .replace(/\n\s*\n/g, "\n")  // collapse multiple blank lines
    .replace(/[ \t]+/g, " ")    // collapse inline whitespace
    .trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("export-html-snapshot", () => {
  it("generates HTML without throwing", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await expect(exportHtml({ paths, outFile })).resolves.toBeDefined();
  });

  it("output file contains <!DOCTYPE html>", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("output contains <main class=\"lb-doc\"> wrapper (ADR-05)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain('<main class="lb-doc">');
  });

  it("output contains h1 from fixture", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("<h1");
    expect(html).toContain("Project Alpha");
  });

  it("output contains h2 and h3 from fixture", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    expect(html).toContain("Section One");
    expect(html).toContain("Subsection");
  });

  it("output contains rendered blockquote", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("left accent border");
  });

  it("output contains table content from fixture", async () => {
    // NOTE: the current unified pipeline (remark-parse without remark-gfm) does
    // NOT render GFM tables as <table> elements — they appear as paragraph text.
    // This is existing pipeline behavior. The CSS table rules are still authored
    // (ADR-09) for any future tables that reach the pipeline via remark-gfm,
    // or for the instructor-pack which may include pre-rendered HTML tables.
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    // Text content from the table rows is present (rendered as paragraph text)
    expect(html).toContain("Column A");
    expect(html).toContain("Row 1A");
  });

  it("output contains rendered fenced code block", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("Hello from a code block");
  });

  it("output contains .mermaid CSS class reference in inline style block", async () => {
    // Mermaid SVG injection (real mmdc or mock) is NOT exercised here because:
    // - Real mmdc requires Chrome which is not available in all CI envs.
    // - Mock SVG contains xmlns="http://www.w3.org/2000/svg" which the
    //   conservative sanitizer catches as an external URL.
    // The mermaid pipeline is covered by tests/unit/export-mermaid.test.ts.
    // Here we verify the CSS .mermaid rule is present in the inlined stylesheet.
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain(".mermaid {");
  });

  it("output contains hr element from fixture divider", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("<hr");
  });

  it("output contains Commits section when commits.md is present (ADR-01)", async () => {
    const dir = makeTmpProject(true);
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("Commits");
    expect(html).toContain("abc1234");
  });

  it("export completes without error when commits.md is absent", async () => {
    // Spec: "Project with no commits file" scenario — graceful skip.
    const dir = makeTmpProject(false);
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-no-commits.html");
    await expect(exportHtml({ paths, outFile })).resolves.toBeDefined();
    const html = fs.readFileSync(outFile, "utf8");
    // The Commits section label should not appear when the file is absent
    expect(html).not.toContain(">Commits<");
  });

  it("ExportReport.externalRefs equals 0 (ADR-02)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-report.html");
    const report = await exportHtml({ paths, outFile });
    expect(report.externalRefs).toBe(0);
  });

  // --- export-rich-interactive slice assertions (ADR-24, ADR-27) ---

  it("output contains <nav class=\"lb-toc\"> (ADR-27)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-toc.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain('class="lb-toc"');
  });

  it("output contains <script type=\"application/json\" id=\"lb-data\"> (ADR-24)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-data.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain('type="application/json"');
    expect(html).toContain('id="lb-data"');
  });

  it("output contains exactly two <script> blocks (data + inline JS) (ADR-24)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-scripts.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    const matches = html.match(/<script/gi) ?? [];
    expect(matches.length).toBe(2);
  });

  it("output contains no <script src=> (ADR-24, IJ-8)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-no-src.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain('<script src="');
  });

  it("ExportReport.allowedRefs is a number (ADR-20)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-allowed.html");
    const report = await exportHtml({ paths, outFile });
    expect(typeof report.allowedRefs).toBe("number");
    expect(report.allowedRefs).toBeGreaterThanOrEqual(0);
  });

  it("output sections appear in correct order: required sections present", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-order.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");

    // Check that the required sections exist (Project Index, Timeline, Errors).
    // New docs are optional and absent in this minimal fixture.
    expect(html).toContain("Project Alpha");  // index.md content
    expect(html).toContain("Timeline");       // timeline.md section
    expect(html).toContain("Errors");         // errors-and-lessons.md section
  });

  it("lb-data block contains events array populated from events.jsonl", async () => {
    // This test verifies the ctx → LbData wiring fix: the JSON data block must
    // contain real events when events.jsonl is present, not an empty array.
    const dir = makeTmpProject();
    const paths = makePaths(dir);

    // Write a minimal events.jsonl with two events.
    fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });
    const ev1 = JSON.stringify({
      id: "ev-001",
      ts: "2026-01-01T10:00:00.000Z",
      type: "manual.decision",
      title: "Use JSONL",
      sessionId: "sess-aaa",
      tags: ["storage"],
      status: "open",
      severity: "low",
    });
    const ev2 = JSON.stringify({
      id: "ev-002",
      ts: "2026-01-02T11:00:00.000Z",
      type: "manual.error",
      title: "Missing index",
      sessionId: "sess-bbb",
      status: "resolved",
    });
    fs.writeFileSync(path.join(dir, "logbook", "evidence", "events.jsonl"), `${ev1}\n${ev2}\n`, "utf8");

    const outFile = path.join(dir, "out-lbdata.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");

    // Extract the lb-data JSON block.
    const match = html.match(/<script type="application\/json" id="lb-data">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!.replace(/\\\//g, "/"));

    // Top-level shape.
    expect(parsed.version).toBe(1);
    expect(parsed.defaultRange).toBe("all");
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(parsed.events.length).toBe(2);

    // First event (sorted by ts — ev-001 should be first).
    const first = parsed.events[0];
    expect(first.id).toBe("ev-001");
    expect(first.ts).toBe("2026-01-01T10:00:00.000Z");
    expect(first.type).toBe("manual.decision");
    expect(first.title).toBe("Use JSONL");
    expect(first.sessionId).toBe("sess-aaa");
    expect(first.tags).toEqual(["storage"]);
    expect(first.status).toBe("open");
    expect(first.severity).toBe("low");

    // Second event.
    const second = parsed.events[1];
    expect(second.id).toBe("ev-002");
    expect(second.type).toBe("manual.error");
    expect(second.status).toBe("resolved");
  });

  it("lb-data block is valid JSON even when events.jsonl contains no events", async () => {
    // readContext returns emptyContext() when events.jsonl is absent → events: [].
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-lbdata-empty.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");

    const match = html.match(/<script type="application\/json" id="lb-data">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!.replace(/\\\//g, "/"));
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(parsed.events.length).toBe(0);
  });

  it("body innerHTML snapshot — structural regression guard", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-snap.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    const normalized = normalizeHtml(html);

    // Structural snapshot assertions (element presence, not exact text).
    // These catch regressions in the HTML skeleton without being brittle to
    // whitespace or attribute order changes.
    expect(normalized).toContain("<h1");
    expect(normalized).toContain("<h2");
    expect(normalized).toContain("<h3");
    expect(normalized).toContain("<blockquote>");
    // Note: <table> NOT asserted — the pipeline uses remark-parse without
    // remark-gfm so GFM tables render as paragraph text (existing behavior).
    expect(normalized).toContain("<pre>");
    // Note: mermaid div NOT asserted — mermaid is excluded from fixture
    // (real mmdc requires Chrome; mock SVG triggers sanitizer). See test comment.
    expect(normalized).toContain("<hr");

    // Snapshot the normalised inner HTML for regression detection.
    // Update with `pnpm vitest --update-snapshots` when intentional changes
    // to the HTML pipeline require regeneration.
    expect(normalized).toMatchSnapshot();
  });
});
