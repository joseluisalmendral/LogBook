/**
 * Unit tests for the Mermaid diagram pipeline (S2.1).
 *
 * Verifies:
 * - Detection of ```mermaid fenced code blocks in markdown
 * - Mock mode (LOGBOOK_MERMAID_MOCK=1) returns mock SVG without subprocess
 * - Mock SVG is sanitized and inlined as <div class="mermaid">...</div>
 * - Multiple diagrams in one document are all processed
 * - 0 diagrams (no mermaid blocks) → returns markdown unchanged (no-op)
 * - Injected SVG has no external refs (assertNoExternalRefs-safe)
 *
 * NOTE: mmdc subprocess invocation is tested via mock mode ONLY in unit tests.
 * Real subprocess is exercised in manual/integration builds (never in CI).
 *
 * RED phase: written before implementation (strict TDD S2.1).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import {
  renderMermaidFences,
  preprocessMermaidPlaceholders,
  injectMermaidSvgs,
} from "../../src/export/mermaid.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLOWCHART = `graph LR\n  A --> B`;
const SEQ_DIAGRAM = `sequenceDiagram\n  Alice->>Bob: Hello`;

function mermaidFence(body: string): string {
  return "```mermaid\n" + body + "\n```";
}

describe("renderMermaidFences — mock mode (S2.1)", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["LOGBOOK_MERMAID_MOCK"];
    process.env["LOGBOOK_MERMAID_MOCK"] = "1";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["LOGBOOK_MERMAID_MOCK"];
    } else {
      process.env["LOGBOOK_MERMAID_MOCK"] = originalEnv;
    }
  });

  it("detects a single ```mermaid block in markdown", async () => {
    const md = `# Title\n\n${mermaidFence(FLOWCHART)}\n\nSome text.`;
    const result = await renderMermaidFences(md);
    // The fence block should be replaced with a div
    expect(result).not.toContain("```mermaid");
    expect(result).toContain('<div class="mermaid">');
    expect(result).toContain("Some text.");
  });

  it("uses mock SVG when LOGBOOK_MERMAID_MOCK=1 (no subprocess invoked)", async () => {
    const md = mermaidFence(FLOWCHART);
    const result = await renderMermaidFences(md);
    // Mock SVG has data-mermaid-mock attribute
    expect(result).toContain('data-mermaid-mock="1"');
    expect(result).toContain("<svg");
  });

  it("opts.mock=true overrides env (explicit mock mode)", async () => {
    // Even if env is not set, opts.mock=true should use mock
    delete process.env["LOGBOOK_MERMAID_MOCK"];
    const md = mermaidFence(FLOWCHART);
    const result = await renderMermaidFences(md, { mock: true });
    expect(result).toContain('data-mermaid-mock="1"');
  });

  it("injects SVG inline in a div (no dangerous external URLs in output)", async () => {
    const md = mermaidFence(FLOWCHART);
    const result = await renderMermaidFences(md);
    // Should not contain external resources (scripts, images, iframes, stylesheets)
    // Note: xmlns="http://www.w3.org/2000/svg" is a namespace URI, not a network request.
    // We check for absence of <script>, <iframe>, href to external (not xmlns).
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<iframe");
    // It should contain the mermaid wrapper div
    expect(result).toContain('<div class="mermaid">');
    // The SVG namespace URI is expected and safe
    expect(result).toContain("http://www.w3.org/2000/svg");
  });

  it("handles multiple diagrams in one document (all replaced)", async () => {
    const md = [
      "# Doc",
      "",
      mermaidFence(FLOWCHART),
      "",
      "Some prose between diagrams.",
      "",
      mermaidFence(SEQ_DIAGRAM),
      "",
      "End of doc.",
    ].join("\n");

    const result = await renderMermaidFences(md);

    // No mermaid fences should remain
    expect(result).not.toContain("```mermaid");
    // Both replaced with divs — count occurrences
    const divCount = (result.match(/<div class="mermaid">/g) ?? []).length;
    expect(divCount).toBe(2);
    // Prose preserved
    expect(result).toContain("Some prose between diagrams.");
    expect(result).toContain("End of doc.");
  });

  it("handles 0 diagrams (no-op — returns markdown unchanged)", async () => {
    const md = "# Title\n\nJust regular markdown with a code block:\n\n```ts\nconst x = 1;\n```\n";
    const result = await renderMermaidFences(md);
    expect(result).toBe(md);
  });

  it("inline SVG contains no script elements after sanitization", async () => {
    // Mock SVG itself is clean; this verifies sanitizeSvg is applied in the pipeline
    const md = mermaidFence(FLOWCHART);
    const result = await renderMermaidFences(md);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<foreignObject");
  });
});

describe("renderMermaidFences — production mode detection (S2.1)", () => {
  it("does NOT invoke subprocess when LOGBOOK_MERMAID_MOCK=1 is set", async () => {
    // This test verifies the mock seam isolates CI from the mmdc binary.
    // We cannot import mmdc in CI, but we CAN verify mock is returned.
    const saved = process.env["LOGBOOK_MERMAID_MOCK"];
    try {
      process.env["LOGBOOK_MERMAID_MOCK"] = "1";
      const md = mermaidFence(FLOWCHART);
      // If this resolves without ENOENT from mmdc, the mock seam works.
      const result = await renderMermaidFences(md);
      expect(result).toContain('data-mermaid-mock="1"');
    } finally {
      if (saved === undefined) {
        delete process.env["LOGBOOK_MERMAID_MOCK"];
      } else {
        process.env["LOGBOOK_MERMAID_MOCK"] = saved;
      }
    }
  });
});

describe("preprocessMermaidPlaceholders + injectMermaidSvgs — end-to-end through real unified pipeline (regression for placeholder survival)", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["LOGBOOK_MERMAID_MOCK"];
    process.env["LOGBOOK_MERMAID_MOCK"] = "1";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["LOGBOOK_MERMAID_MOCK"];
    } else {
      process.env["LOGBOOK_MERMAID_MOCK"] = originalEnv;
    }
  });

  async function runPipeline(md: string): Promise<string> {
    const result = await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeStringify)
      .process(md);
    return String(result);
  }

  it("placeholder survives remark-parse → remark-rehype → rehype-stringify (no rehype-raw, no allowDangerousHtml)", async () => {
    const md = `# Title\n\n${mermaidFence(FLOWCHART)}\n\nSome text.`;
    const { markdown, svgs } = await preprocessMermaidPlaceholders(md);

    // Placeholder is bare text wrapped in newlines — survives as <p>LBMERMAID_N</p>.
    expect(markdown).toContain("LBMERMAID_0");

    const html = await runPipeline(markdown);
    expect(html).toContain("<p>LBMERMAID_0</p>");

    const final = injectMermaidSvgs(html, svgs);
    expect(final).not.toContain("LBMERMAID_0");
    expect(final).toContain('<div class="mermaid">');
    expect(final).toContain('data-mermaid-mock="1"');
  });

  it("multiple placeholders all survive and are replaced in order", async () => {
    const md = `# Title\n\n${mermaidFence(FLOWCHART)}\n\nMiddle.\n\n${mermaidFence(SEQ_DIAGRAM)}\n\nEnd.`;
    const { markdown, svgs } = await preprocessMermaidPlaceholders(md);
    expect(svgs).toHaveLength(2);

    const html = await runPipeline(markdown);
    expect(html).toContain("<p>LBMERMAID_0</p>");
    expect(html).toContain("<p>LBMERMAID_1</p>");

    const final = injectMermaidSvgs(html, svgs);
    expect(final.match(/<div class="mermaid">/g)).toHaveLength(2);
    expect(final).not.toContain("LBMERMAID_");
  });

  it("no mermaid fences → no placeholders, html unchanged by inject step", async () => {
    const md = `# Title\n\nPlain markdown only.`;
    const { markdown, svgs } = await preprocessMermaidPlaceholders(md);
    expect(svgs).toHaveLength(0);
    expect(markdown).toBe(md);

    const html = await runPipeline(markdown);
    const final = injectMermaidSvgs(html, svgs);
    expect(final).toBe(html);
  });
});
