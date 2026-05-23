/**
 * Unit tests: buildDecisionsDoc (EH-2).
 *
 * Verifies:
 *   - Empty-state message when no decisions
 *   - HTML table format (EH-2: Phase | Title | Date | Status | Summary | Link)
 *   - Phase column included
 *   - Rationale / summary extraction
 *   - Status field extraction
 *   - Link column when filePath present
 *   - HTML special-char escaping (pipe chars rendered safely in HTML cells)
 *
 * NOTE: The table is now raw HTML <table> instead of GFM pipe-tables.
 * remark-parse is used without remark-gfm; pipe-tables would render as plain
 * text in the export. All table assertions test against the HTML output.
 */

import { describe, it, expect } from "vitest";
import { buildDecisionsDoc } from "../../src/generate/decisions-doc.js";
import type { RenderContext } from "../../src/generate/render-context.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    sessions: [],
    phases: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    all: [],
    latestSessionId: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDecisionsDoc — empty context", () => {
  it("returns empty-state message when no decisions", () => {
    // visual-replay-redesign Phase 4 (V9) rewrote empty states to Spanish per
    // cognitive-doc-design "lead with the answer" — assert on the lb-empty-state
    // shell + the Spanish lead phrase, not the old English placeholder.
    const md = buildDecisionsDoc(makeCtx());
    expect(md).toContain("# Decisions");
    expect(md).toContain("lb-empty-state");
    expect(md).toContain("Aún no hay decisiones");
    // No table emitted for empty state.
    expect(md).not.toContain("<table>");
  });
});

describe("buildDecisionsDoc — table format (EH-2)", () => {
  it("emits an HTML table with expected columns", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
          phase: "Architecture",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    // HTML table with all 6 column headers.
    expect(md).toContain("<table>");
    expect(md).toContain("<th");
    expect(md).toContain("Phase");
    expect(md).toContain("Title");
    expect(md).toContain("Date");
    expect(md).toContain("Status");
    expect(md).toContain("Summary");
    expect(md).toContain("Link");
    // Row data present.
    expect(md).toContain("Architecture");
    expect(md).toContain("Use TypeScript");
    expect(md).toContain("2024-01-01");
  });

  it("includes a row per decision", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
          phase: "Architecture",
        },
        {
          id: "d2",
          type: "manual.decision",
          ts: "2024-01-02T10:00:00Z",
          title: "Use Vitest",
          phase: "Testing",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    expect(md).toContain("Use TypeScript");
    expect(md).toContain("Use Vitest");
    // Both phases appear in the single table.
    expect(md).toContain("Architecture");
    expect(md).toContain("Testing");
  });

  it("includes date in YYYY-MM-DD format", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-15T10:00:00Z",
          title: "Decision A",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    expect(md).toContain("2024-01-15");
  });

  it("uses 'proposed' as default status when status field absent", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    expect(md).toContain("proposed");
  });

  it("uses status field when present", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
          status: "accepted",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    expect(md).toContain("accepted");
  });

  it("extracts summary from rationale (first sentence, truncated to ~120 chars)", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
          rationale: "Type safety reduces runtime errors. This is a longer explanation.",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    // First sentence used as summary.
    expect(md).toContain("Type safety reduces runtime errors.");
  });

  it("uses description as summary fallback when rationale absent", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
          description: "Fallback description for summary.",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    expect(md).toContain("Fallback description");
  });

  it("emits link column as HTML anchor when filePath present", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
          filePath: "docs/adr/001-typescript.md",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    // HTML <a> link instead of markdown link syntax.
    expect(md).toContain('<a href="docs/adr/001-typescript.md"');
    expect(md).toContain("adr</a>");
  });

  it("emits '—' in link column when no file path present", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use TypeScript",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    // The link column should contain "—" (em dash) in a <td>.
    expect(md).toContain("Use TypeScript");
    // No <a> link emitted when no filePath.
    expect(md).not.toContain('<a href=');
    // Em dash appears as cell content.
    const tdLines = md.split("\n").filter((l) => l.includes("<td") && l.includes("—"));
    expect(tdLines.length).toBeGreaterThan(0);
  });

  it("uses 'General' phase when phase field absent", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Decision without phase",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    expect(md).toContain("General");
  });

  it("renders pipe characters safely in HTML cells (no escaping needed in HTML)", () => {
    const ctx = makeCtx({
      decisions: [
        {
          id: "d1",
          type: "manual.decision",
          ts: "2024-01-01T10:00:00Z",
          title: "Use A|B options",
        },
      ],
    });
    const md = buildDecisionsDoc(ctx);
    // In HTML tables, pipe chars are rendered as-is (no \| escape needed).
    // The title appears verbatim in the cell.
    expect(md).toContain("Use A|B options");
    // No markdown pipe-escape in HTML output.
    expect(md).not.toContain("A\\|B");
  });
});
