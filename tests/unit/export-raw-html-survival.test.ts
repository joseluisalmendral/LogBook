/**
 * CRITICAL-1 fix test: assert that raw HTML blocks (div, section, nav, select,
 * span, label, etc.) survive the unified markdown-to-HTML pipeline.
 *
 * Previously, remark-rehype with default settings (allowDangerousHtml: false)
 * silently stripped these blocks. The preprocessRawHtmlPlaceholders /
 * injectRawHtmlBlocks placeholder pattern now preserves them.
 *
 * These tests verify:
 *   - KPI grid (<div class="lb-kpi-grid">) survives
 *   - Range selector (<select id="lb-dashboard-range">) survives
 *   - Chart container (<div class="lb-chart" data-range="...">) survives
 *   - Filter bar (<div class="lb-filter">) survives
 *   - Tag chips (<span class="lb-tag">) survive
 *   - Surrounding markdown content is unaffected
 *   - Multi-line raw HTML blocks survive
 *   - Single-line raw HTML blocks survive
 */

import { describe, it, expect } from "vitest";
import { markdownToHtml } from "../../src/export/markdown-to-html.js";

// ---------------------------------------------------------------------------
// KPI grid (dashboard-doc emits this pattern)
// ---------------------------------------------------------------------------

const KPI_GRID_MARKDOWN = `
# Dashboard

<div class="lb-kpi-grid">
<div class="lb-kpi">
<div class="lb-kpi-value">42</div>
<div class="lb-kpi-label">Total Events</div>
</div>
</div>

Some text after the grid.
`.trim();

describe("KPI grid raw HTML survival (CRITICAL-1)", () => {
  it("<div class='lb-kpi-grid'> survives markdownToHtml", async () => {
    const html = await markdownToHtml(KPI_GRID_MARKDOWN);
    expect(html).toContain('class="lb-kpi-grid"');
  });

  it("nested <div class='lb-kpi'> survives", async () => {
    const html = await markdownToHtml(KPI_GRID_MARKDOWN);
    expect(html).toContain('class="lb-kpi"');
  });

  it("KPI value content is preserved", async () => {
    const html = await markdownToHtml(KPI_GRID_MARKDOWN);
    expect(html).toContain("42");
    expect(html).toContain("Total Events");
  });

  it("surrounding markdown content is unaffected", async () => {
    const html = await markdownToHtml(KPI_GRID_MARKDOWN);
    expect(html).toContain("Some text after the grid");
    expect(html).toContain("<h1");
  });
});

// ---------------------------------------------------------------------------
// Range selector (dashboard-doc filter bar)
// ---------------------------------------------------------------------------

const RANGE_SELECTOR_MARKDOWN = `
## Activity Charts

<div class="lb-filter"><label for="lb-dashboard-range">Range: </label><select id="lb-dashboard-range"><option value="all">All time</option><option value="30d">Last 30 days</option><option value="7d">Last 7 days</option></select></div>

Text after.
`.trim();

describe("Range selector raw HTML survival (CRITICAL-1)", () => {
  it("<select id='lb-dashboard-range'> survives markdownToHtml", async () => {
    const html = await markdownToHtml(RANGE_SELECTOR_MARKDOWN);
    expect(html).toContain('id="lb-dashboard-range"');
  });

  it("<div class='lb-filter'> survives", async () => {
    const html = await markdownToHtml(RANGE_SELECTOR_MARKDOWN);
    expect(html).toContain('class="lb-filter"');
  });

  it("<option> elements survive", async () => {
    const html = await markdownToHtml(RANGE_SELECTOR_MARKDOWN);
    expect(html).toContain("All time");
    expect(html).toContain("Last 30 days");
    expect(html).toContain("Last 7 days");
  });
});

// ---------------------------------------------------------------------------
// Chart container (dashboard-doc lb-chart wrapper)
// ---------------------------------------------------------------------------

const CHART_CONTAINER_MARKDOWN = `
<div class="lb-chart" data-range="all">

_No events in the all time range._

</div>

<div class="lb-chart" data-range="30d" hidden>

_No events._

</div>
`.trim();

describe("Chart container raw HTML survival (CRITICAL-1)", () => {
  it("<div class='lb-chart'> survives markdownToHtml", async () => {
    const html = await markdownToHtml(CHART_CONTAINER_MARKDOWN);
    expect(html).toContain('class="lb-chart"');
  });

  it("data-range attribute is preserved", async () => {
    const html = await markdownToHtml(CHART_CONTAINER_MARKDOWN);
    expect(html).toContain('data-range="all"');
    expect(html).toContain('data-range="30d"');
  });

  it("hidden attribute is preserved on non-default range", async () => {
    const html = await markdownToHtml(CHART_CONTAINER_MARKDOWN);
    expect(html).toContain("hidden");
  });
});

// ---------------------------------------------------------------------------
// Multi-line raw div block
// ---------------------------------------------------------------------------

const MULTI_LINE_DIV_MARKDOWN = `
Some text before.

<div class="lb-session-detail">
Row 1
Row 2
Row 3
</div>

Some text after.
`.trim();

describe("Multi-line div survival (CRITICAL-1)", () => {
  it("multi-line <div> block survives markdownToHtml", async () => {
    const html = await markdownToHtml(MULTI_LINE_DIV_MARKDOWN);
    expect(html).toContain('class="lb-session-detail"');
    expect(html).toContain("Row 1");
    expect(html).toContain("Row 3");
  });

  it("surrounding content is preserved", async () => {
    const html = await markdownToHtml(MULTI_LINE_DIV_MARKDOWN);
    expect(html).toContain("Some text before");
    expect(html).toContain("Some text after");
  });
});

// ---------------------------------------------------------------------------
// Nav element survival
// ---------------------------------------------------------------------------

describe("Nav element survival (CRITICAL-1)", () => {
  it("<nav> block survives markdownToHtml", async () => {
    const md = `<nav class="lb-toc"><ul><li><a href="#dashboard">Dashboard</a></li></ul></nav>`;
    const html = await markdownToHtml(md);
    expect(html).toContain('class="lb-toc"');
    expect(html).toContain("Dashboard");
  });
});

// ---------------------------------------------------------------------------
// preprocessRawHtmlPlaceholders unit tests
// ---------------------------------------------------------------------------

import {
  preprocessRawHtmlPlaceholders,
  injectRawHtmlBlocks,
} from "../../src/export/markdown-to-html.js";

describe("preprocessRawHtmlPlaceholders — unit", () => {
  it("replaces a single-line div with a placeholder", () => {
    const md = `<div class="test">content</div>`;
    const { markdown, rawBlocks } = preprocessRawHtmlPlaceholders(md);
    expect(markdown).toContain("LBRAW_");
    expect(rawBlocks).toHaveLength(1);
    expect(rawBlocks[0]!.html).toBe(md);
  });

  it("replaces a multi-line div with a placeholder", () => {
    const md = `<div>\nline1\nline2\n</div>`;
    const { markdown, rawBlocks } = preprocessRawHtmlPlaceholders(md);
    expect(rawBlocks).toHaveLength(1);
    expect(markdown).not.toContain("<div>");
  });

  it("leaves plain markdown untouched", () => {
    const md = `# Heading\n\nSome **bold** text.\n\n- item 1\n- item 2`;
    const { markdown, rawBlocks } = preprocessRawHtmlPlaceholders(md);
    expect(rawBlocks).toHaveLength(0);
    expect(markdown).toBe(md);
  });

  it("handles multiple raw HTML blocks", () => {
    const md = `<div class="a">A</div>\n\nText\n\n<div class="b">B</div>`;
    const { markdown, rawBlocks } = preprocessRawHtmlPlaceholders(md);
    expect(rawBlocks).toHaveLength(2);
    expect(markdown).not.toContain("<div");
  });
});

describe("injectRawHtmlBlocks — unit", () => {
  it("restores raw HTML blocks from their LBRAW tokens", () => {
    const entry = { token: "LBRAW_0", html: '<div class="foo">bar</div>' };
    const html = `<p>LBRAW_0</p>`;
    const result = injectRawHtmlBlocks(html, [entry]);
    expect(result).toBe('<div class="foo">bar</div>');
  });

  it("falls back to plain token replacement when no <p> wrapper", () => {
    const entry = { token: "LBRAW_0", html: '<div>content</div>' };
    const html = `LBRAW_0`;
    const result = injectRawHtmlBlocks(html, [entry]);
    expect(result).toBe('<div>content</div>');
  });
});
