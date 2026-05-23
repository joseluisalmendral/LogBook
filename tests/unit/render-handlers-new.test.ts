/**
 * Unit tests: HTML render handlers for 5 new event kinds (HE spec).
 *
 * Tests cover:
 *   - buildSessionsDoc with langfuse_trace event → data-lb-layer="technical" (B1-R7)
 *   - buildSessionsDoc with gh_agent_run event → data-lb-layer="conversation" (B2-R6)
 *   - buildSessionsDoc with skill_invoked event → data-lb-layer="conversation" (B3-R6)
 *   - buildSessionsDoc with visual_direction event → data-lb-layer="decisions" (B4-R6)
 *   - buildSessionsDoc with qa_finding event → data-lb-layer="decisions" (B5-R5)
 *   - qa_finding fix absent → renders "—" (B5-R5)
 *   - Unknown event type → no crash (HE-S2)
 *
 * Covers HE-S1, HE-S2.
 */

import { describe, it, expect } from "vitest";
import { buildSessionsDoc } from "../../src/generate/sessions-doc.js";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";

// ---------------------------------------------------------------------------
// Helper: minimal RenderContext from raw event array
// ---------------------------------------------------------------------------

function makeCtx(rawEvents: Partial<RenderEvent>[]): RenderContext {
  const events = rawEvents.map((e) => ({
    ts: "2026-01-01T10:00:00.000Z",
    sessionId: "sess-render-test",
    kind: "hook_event",
    type: "hook_event",
    ...e,
  }));
  return {
    all: events as unknown as RenderEvent[],
    sessions: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    phases: [],
    latestSessionId: "",
  };
}

// ---------------------------------------------------------------------------
// langfuse_trace render handler (B1-R7)
// ---------------------------------------------------------------------------

describe("langfuse_trace render handler", () => {
  it("renders langfuse_trace with data-lb-layer=\"technical\"", () => {
    const ctx = makeCtx([
      {
        id: "lt-1",
        type: "langfuse_trace",
        model: "claude-3-5-sonnet",
        totalTokens: 1650,
        costUsd: 0.0042,
        traceId: "trace-abc",
      },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain('data-lb-layer="technical"');
  });

  it("renders model name in langfuse_trace output", () => {
    const ctx = makeCtx([
      { id: "lt-2", type: "langfuse_trace", model: "claude-3-opus-20240229", totalTokens: 500 },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("claude-3-opus-20240229");
  });
});

// ---------------------------------------------------------------------------
// gh_agent_run render handler (B2-R6)
// ---------------------------------------------------------------------------

describe("gh_agent_run render handler", () => {
  it("renders gh_agent_run with data-lb-layer=\"conversation\"", () => {
    const ctx = makeCtx([
      {
        id: "gar-1",
        type: "gh_agent_run",
        prUrl: "https://github.com/owner/repo/pull/42",
        filesChanged: 3,
      },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain('data-lb-layer="conversation"');
  });

  it("renders PR URL in gh_agent_run output", () => {
    const ctx = makeCtx([
      { id: "gar-2", type: "gh_agent_run", prUrl: "https://github.com/org/proj/pull/99" },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("github.com/org/proj/pull/99");
  });
});

// ---------------------------------------------------------------------------
// skill_invoked render handler (B3-R6)
// ---------------------------------------------------------------------------

describe("skill_invoked render handler", () => {
  it("renders skill_invoked with data-lb-layer=\"conversation\"", () => {
    const ctx = makeCtx([
      { id: "si-1", type: "skill_invoked", skillName: "sdd-apply" },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain('data-lb-layer="conversation"');
  });

  it("renders skill name in output", () => {
    const ctx = makeCtx([
      { id: "si-2", type: "skill_invoked", skillName: "my-custom-skill" },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("my-custom-skill");
  });
});

// ---------------------------------------------------------------------------
// visual_direction render handler (B4-R6)
// ---------------------------------------------------------------------------

describe("visual_direction render handler", () => {
  it("renders visual_direction with data-lb-layer=\"decisions\"", () => {
    const ctx = makeCtx([
      {
        id: "vd-1",
        type: "visual_direction",
        chosen: "dark-minimal",
        candidates: ["dark-minimal", "light-colorful"],
        rationale: "Brand alignment",
      },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain('data-lb-layer="decisions"');
  });

  it("renders chosen direction in output", () => {
    const ctx = makeCtx([
      { id: "vd-2", type: "visual_direction", chosen: "ultra-minimal", candidates: ["a", "b"] },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("ultra-minimal");
  });
});

// ---------------------------------------------------------------------------
// qa_finding render handler (B5-R5)
// ---------------------------------------------------------------------------

describe("qa_finding render handler", () => {
  it("renders qa_finding with data-lb-layer=\"decisions\"", () => {
    const ctx = makeCtx([
      {
        id: "qf-1",
        type: "qa_finding",
        severity: "critical",
        layer: "seo",
        description: "Missing canonical URLs",
      },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain('data-lb-layer="decisions"');
  });

  it("renders severity in qa_finding output", () => {
    const ctx = makeCtx([
      { id: "qf-2", type: "qa_finding", severity: "high", layer: "a11y", description: "ARIA labels" },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("high");
  });

  it("renders '—' when fix is absent (B5-R5)", () => {
    const ctx = makeCtx([
      {
        id: "qf-3",
        type: "qa_finding",
        severity: "medium",
        layer: "perf",
        description: "No fix provided",
        // fix is intentionally absent
      },
    ]);
    const md = buildSessionsDoc(ctx);
    // The detail section should show "—" for absent fix.
    expect(md).toContain("Fix: —");
  });
});

// ---------------------------------------------------------------------------
// Unknown event type fallback (HE-S2)
// ---------------------------------------------------------------------------

describe("unknown event type fallback", () => {
  it("does not crash on unknown event type", () => {
    const ctx = makeCtx([
      { id: "unk-1", type: "totally_unknown_future_kind", title: "Future event" },
    ]);
    expect(() => buildSessionsDoc(ctx)).not.toThrow();
  });

  it("renders something for unknown event type (no empty output)", () => {
    const ctx = makeCtx([
      { id: "unk-2", type: "another_unknown_kind_xyz" },
    ]);
    const md = buildSessionsDoc(ctx);
    expect(md.length).toBeGreaterThan(50);
  });
});
