/**
 * Unit tests: buildDashboardDoc (DB-1, DB-2, DB-3).
 *
 * Verifies:
 *   - KPI values match fixture context
 *   - 3 range variants emitted (all, 30d, 7d)
 *   - Mermaid fences present for non-empty ranges
 *   - `hidden` attr on non-default ranges
 *   - Empty context → "0" values in KPI grid, no crash
 */

import { describe, it, expect } from "vitest";
import { buildDashboardDoc } from "../../src/generate/dashboard-doc.js";
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

describe("buildDashboardDoc — empty context", () => {
  it("does not crash on empty context", () => {
    expect(() => buildDashboardDoc(makeCtx())).not.toThrow();
  });

  it("emits Dashboard heading", () => {
    const md = buildDashboardDoc(makeCtx());
    expect(md).toContain("# Dashboard");
  });

  it("KPI grid shows 0 values for all metrics", () => {
    const md = buildDashboardDoc(makeCtx());
    // KPI cards should show 0 for totals
    expect(md).toContain("lb-kpi-grid");
    expect(md).toContain(">0<");
  });
});

describe("buildDashboardDoc — KPI computation (DB-1)", () => {
  it("total events count matches ctx.all.length", () => {
    const ctx = makeCtx({
      all: [
        { id: "e1", type: "manual.decision", ts: "2024-01-01T10:00:00Z" },
        { id: "e2", type: "manual.error", ts: "2024-01-02T10:00:00Z" },
        { id: "e3", type: "manual.lesson", ts: "2024-01-03T10:00:00Z" },
      ],
      decisions: [{ id: "e1", type: "manual.decision", ts: "2024-01-01T10:00:00Z" }],
      errors: [{ id: "e2", type: "manual.error", ts: "2024-01-02T10:00:00Z" }],
      lessons: [{ id: "e3", type: "manual.lesson", ts: "2024-01-03T10:00:00Z" }],
    });
    const md = buildDashboardDoc(ctx);
    // Should contain the total (3)
    expect(md).toContain(">3<");
    // Should mention decisions (1)
    expect(md).toContain(">1<");
  });
});

describe("buildDashboardDoc — range variants (DB-2, ADR-25)", () => {
  it("emits 3 chart div wrappers with data-range", () => {
    const md = buildDashboardDoc(makeCtx());
    expect(md).toContain('data-range="all"');
    expect(md).toContain('data-range="30d"');
    expect(md).toContain('data-range="7d"');
  });

  it("default range (all) does NOT have hidden attribute", () => {
    const md = buildDashboardDoc(makeCtx());
    // The "all" div should not have hidden
    expect(md).not.toMatch(/data-range="all"[^>]* hidden/);
  });

  it("non-default ranges (30d, 7d) have hidden attribute", () => {
    const md = buildDashboardDoc(makeCtx());
    expect(md).toMatch(/data-range="30d"[^>]* hidden/);
    expect(md).toMatch(/data-range="7d"[^>]* hidden/);
  });
});

describe("buildDashboardDoc — range selector (DB-3)", () => {
  it("emits <select id=\"lb-dashboard-range\"> element", () => {
    const md = buildDashboardDoc(makeCtx());
    expect(md).toContain('id="lb-dashboard-range"');
    expect(md).toContain("<select");
    expect(md).toContain("</select>");
  });

  it("select has options for all three ranges", () => {
    const md = buildDashboardDoc(makeCtx());
    expect(md).toContain('value="all"');
    expect(md).toContain('value="30d"');
    expect(md).toContain('value="7d"');
  });
});

describe("buildDashboardDoc — mermaid charts (DB-2)", () => {
  it("emits mermaid pie chart fences when events exist", () => {
    const ctx = makeCtx({
      all: [
        { id: "e1", type: "manual.decision", ts: "2024-01-01T10:00:00Z" },
        { id: "e2", type: "manual.error", ts: "2024-01-02T10:00:00Z" },
      ],
      decisions: [{ id: "e1", type: "manual.decision", ts: "2024-01-01T10:00:00Z" }],
      errors: [{ id: "e2", type: "manual.error", ts: "2024-01-02T10:00:00Z" }],
    });
    const md = buildDashboardDoc(ctx);
    expect(md).toContain("```mermaid");
    expect(md).toContain("pie");
  });
});
