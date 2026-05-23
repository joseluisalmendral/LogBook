/**
 * Unit tests: buildMilestonesDoc (MJ-1, ADR-22).
 *
 * Verifies:
 *   - Mermaid timeline fence present when milestones exist
 *   - Per-milestone section emitted
 *   - Empty-state message when no milestones
 *   - Milestones sorted by ts ascending
 *   - Phase activity rollup present
 */

import { describe, it, expect } from "vitest";
import { buildMilestonesDoc } from "../../src/generate/milestones-doc.js";
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

describe("buildMilestonesDoc — empty context", () => {
  it("returns empty-state message when no milestones", () => {
    // visual-replay-redesign Phase 4 (V9) rewrote empty states to Spanish per
    // cognitive-doc-design "lead with the answer" — assert on the lb-empty-state
    // shell + the Spanish lead phrase, not the old English placeholder.
    const md = buildMilestonesDoc(makeCtx());
    expect(md).toContain("# Milestones");
    expect(md).toContain("lb-empty-state");
    expect(md).toContain("Aún no hay milestones");
  });

  it("does not crash on empty context", () => {
    expect(() => buildMilestonesDoc(makeCtx())).not.toThrow();
  });
});

describe("buildMilestonesDoc — mermaid timeline (MJ-1)", () => {
  it("emits mermaid timeline fence at top", () => {
    const ctx = makeCtx({
      milestones: [
        {
          id: "m1",
          type: "manual.milestone",
          ts: "2024-01-15T10:00:00Z",
          title: "Alpha Release",
        },
      ],
    });
    const md = buildMilestonesDoc(ctx);
    expect(md).toContain("```mermaid");
    expect(md).toContain("timeline");
    expect(md).toContain("Project Milestones");
  });

  it("milestone title appears in mermaid chart", () => {
    const ctx = makeCtx({
      milestones: [
        {
          id: "m1",
          type: "manual.milestone",
          ts: "2024-01-15T10:00:00Z",
          title: "Alpha Release",
        },
      ],
    });
    const md = buildMilestonesDoc(ctx);
    expect(md).toContain("Alpha Release");
  });

  it("milestone date appears in mermaid chart", () => {
    const ctx = makeCtx({
      milestones: [
        {
          id: "m1",
          type: "manual.milestone",
          ts: "2024-03-20T10:00:00Z",
          title: "Beta",
        },
      ],
    });
    const md = buildMilestonesDoc(ctx);
    expect(md).toContain("2024-03-20");
  });
});

describe("buildMilestonesDoc — per-milestone sections", () => {
  it("emits a section heading for each milestone", () => {
    const ctx = makeCtx({
      milestones: [
        {
          id: "m1",
          type: "manual.milestone",
          ts: "2024-01-15T10:00:00Z",
          title: "Alpha Release",
        },
        {
          id: "m2",
          type: "manual.milestone",
          ts: "2024-03-01T10:00:00Z",
          title: "Beta Release",
        },
      ],
    });
    const md = buildMilestonesDoc(ctx);
    expect(md).toContain("## Alpha Release");
    expect(md).toContain("## Beta Release");
  });

  it("emits reached timestamp for each milestone", () => {
    const ctx = makeCtx({
      milestones: [
        {
          id: "m1",
          type: "manual.milestone",
          ts: "2024-02-14T10:00:00Z",
          title: "Valentine Milestone",
        },
      ],
    });
    const md = buildMilestonesDoc(ctx);
    expect(md).toContain("Reached:");
    expect(md).toContain("2024-02-14");
  });

  it("sorts milestones by ts ascending", () => {
    const ctx = makeCtx({
      milestones: [
        {
          id: "m2",
          type: "manual.milestone",
          ts: "2024-06-01T10:00:00Z",
          title: "Later Milestone",
        },
        {
          id: "m1",
          type: "manual.milestone",
          ts: "2024-01-01T10:00:00Z",
          title: "Earlier Milestone",
        },
      ],
    });
    const md = buildMilestonesDoc(ctx);
    const idxEarlier = md.indexOf("Earlier Milestone");
    const idxLater = md.indexOf("Later Milestone");
    expect(idxEarlier).toBeLessThan(idxLater);
  });
});

describe("buildMilestonesDoc — phase activity rollup", () => {
  it("emits phase activity summary when events exist between milestones", () => {
    const ctx = makeCtx({
      milestones: [
        {
          id: "m1",
          type: "manual.milestone",
          ts: "2024-01-15T12:00:00Z",
          title: "Milestone One",
        },
      ],
      all: [
        {
          id: "e1",
          type: "manual.decision",
          ts: "2024-01-10T10:00:00Z",
          title: "Some decision",
        },
        {
          id: "e2",
          type: "manual.error",
          ts: "2024-01-12T10:00:00Z",
          title: "A bug",
        },
      ],
    });
    const md = buildMilestonesDoc(ctx);
    expect(md).toContain("Phase activity:");
  });
});
