/**
 * Unit tests: buildSessionsDoc (SR-1, SR-2, SR-3).
 *
 * Verifies:
 *   - groupBy sessionId correct
 *   - Unknown-session bucket populated for events without sessionId
 *   - Sorted by earliest ts
 *   - Most-recent session gets <details open>
 *   - Empty context → no crash, returns empty-state message
 */

import { describe, it, expect } from "vitest";
import { buildSessionsDoc } from "../../src/generate/sessions-doc.js";
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

function makeEvent(
  id: string,
  ts: string,
  type: string,
  sessionId?: string,
) {
  return { id, type, ts, ...(sessionId ? { sessionId } : {}) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSessionsDoc — empty context", () => {
  it("returns empty-state message when no events", () => {
    // visual-replay-redesign Phase 4 (V9) rewrote empty states to Spanish per
    // cognitive-doc-design "lead with the answer" — assert on the lb-empty-state
    // shell + the Spanish lead phrase, not the old English placeholder.
    const md = buildSessionsDoc(makeCtx());
    expect(md).toContain("# Sessions");
    expect(md).toContain("lb-empty-state");
    expect(md).toContain("Aún no hay sesiones");
  });
});

describe("buildSessionsDoc — session grouping (SR-1)", () => {
  it("groups events by sessionId", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision", "aaa-session"),
        makeEvent("e2", "2024-01-01T11:00:00Z", "manual.error", "aaa-session"),
        makeEvent("e3", "2024-01-02T09:00:00Z", "manual.lesson", "zzz-session"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    // Both sessions should appear — shortId takes first 8 chars
    expect(md).toContain("aaa-sess"); // shortId("aaa-session") = "aaa-sess"
    expect(md).toContain("zzz-sess"); // shortId("zzz-session") = "zzz-sess"
  });

  it("puts events without sessionId into unknown bucket (SR-2)", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision"), // no sessionId
      ],
    });
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("Unknown");
  });

  it("sorts groups by earliest ts ascending", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-05T10:00:00Z", "manual.decision", "zzz-later"),
        makeEvent("e2", "2024-01-01T10:00:00Z", "manual.decision", "aaa-earlier"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    // aaa-earlier has earlier event, should appear before zzz-later in output
    // shortId takes first 8 chars: "aaa-earl" vs "zzz-late"
    const idxA = md.indexOf("aaa-earl");
    const idxZ = md.indexOf("zzz-late");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxZ).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxZ);
  });
});

describe("buildSessionsDoc — most-recent session (SR-3)", () => {
  it("most-recent session emits <details open>", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision", "session-old"),
        makeEvent("e2", "2024-02-01T10:00:00Z", "manual.decision", "session-new"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("<details open>");
  });

  it("earlier sessions emit <details> without open", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision", "session-old"),
        makeEvent("e2", "2024-02-01T10:00:00Z", "manual.decision", "session-new"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    // At least one <details> without open (the earlier session)
    expect(md).toMatch(/<details(?! open)>/);
  });

  it("single session also gets <details open>", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision", "session-only"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("<details open>");
  });
});

describe("buildSessionsDoc — stats badges", () => {
  it("emits stats badges with counts", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision", "session-aaa"),
        makeEvent("e2", "2024-01-01T11:00:00Z", "manual.error", "session-aaa"),
        makeEvent("e3", "2024-01-01T12:00:00Z", "manual.lesson", "session-aaa"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("Events:");
    expect(md).toContain("Decisions:");
    expect(md).toContain("Errors:");
    expect(md).toContain("Lessons:");
  });
});

describe("buildSessionsDoc — mermaid timeline", () => {
  it("emits mermaid timeline for sessions with > 3 events", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision", "sess"),
        makeEvent("e2", "2024-01-01T11:00:00Z", "manual.error", "sess"),
        makeEvent("e3", "2024-01-01T12:00:00Z", "manual.lesson", "sess"),
        makeEvent("e4", "2024-01-01T13:00:00Z", "manual.decision", "sess"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    expect(md).toContain("```mermaid");
    expect(md).toContain("timeline");
  });

  it("does NOT emit mermaid timeline for sessions with ≤ 3 events", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision", "sess"),
        makeEvent("e2", "2024-01-01T11:00:00Z", "manual.error", "sess"),
      ],
    });
    const md = buildSessionsDoc(ctx);
    expect(md).not.toContain("```mermaid");
  });
});

describe("buildSessionsDoc — unknown session label (SUGGESTION-3, SR-1)", () => {
  it("labels the unknown bucket as 'Unknown session' (not 'Session Unknown')", () => {
    const ctx = makeCtx({
      all: [
        makeEvent("e1", "2024-01-01T10:00:00Z", "manual.decision"), // no sessionId
      ],
    });
    const md = buildSessionsDoc(ctx);
    // Must contain "Unknown session" as the heading text.
    expect(md).toContain("## Unknown session");
    // Must NOT contain "Session Unknown" (the old broken format).
    expect(md).not.toContain("## Session Unknown");
  });
});
