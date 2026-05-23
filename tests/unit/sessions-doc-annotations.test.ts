/**
 * Unit tests: annotation inline rendering in sessions-doc (W7 spec).
 *
 * Verifies:
 *   - Annotation with valid relatedEventId renders adjacent to target
 *   - Annotation with missing relatedEventId → orphan block
 *   - Annotation with ghost relatedEventId → orphan block
 */

import { describe, it, expect } from "vitest";
import { buildSessionsDoc } from "../../src/generate/sessions-doc.js";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<RenderEvent>): RenderEvent {
  return {
    id: "evt-default",
    type: "manual.decision",
    ts: "2026-05-20T10:00:00.000Z",
    sessionId: "sess-001",
    title: "Some decision",
    ...overrides,
  };
}

function makeCtx(all: RenderEvent[]): RenderContext {
  return {
    sessions: all.filter((e) => e.type === "manual.session_start"),
    phases: [],
    decisions: all.filter((e) => e.type === "manual.decision"),
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    latestSessionId: "",
    all,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("annotation inline rendering", () => {
  it("renders annotation adjacent to target event (data-event-id match)", () => {
    const targetId = "evt-target-001";
    const all: RenderEvent[] = [
      makeEvent({
        id: targetId,
        ts: "2026-05-20T10:00:00.000Z",
        type: "manual.decision",
        title: "Use JSONL",
      }),
      makeEvent({
        id: "ann-001",
        ts: "2026-05-20T10:01:00.000Z",
        type: "manual.annotation",
        relatedEventId: targetId,
        note: "Pinned because reviewers will ask.",
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));

    // The annotation text should appear in the output.
    expect(html).toContain("Pinned because reviewers will ask.");
    // The target event should be in the output.
    expect(html).toContain(targetId);
    // Orphan section should NOT appear (annotation is not orphaned).
    expect(html).not.toContain("Orphan Annotations");
  });

  it("renders annotation as orphan when relatedEventId is absent", () => {
    const all: RenderEvent[] = [
      makeEvent({
        id: "evt-001",
        ts: "2026-05-20T10:00:00.000Z",
        type: "manual.decision",
        title: "Some decision",
      }),
      makeEvent({
        id: "ann-002",
        ts: "2026-05-20T10:01:00.000Z",
        type: "manual.annotation",
        // No relatedEventId
        note: "Free-floating note",
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));

    expect(html).toContain("Free-floating note");
    expect(html).toContain("Orphan Annotations");
  });

  it("renders annotation as orphan when relatedEventId points to non-existent event", () => {
    const all: RenderEvent[] = [
      makeEvent({
        id: "evt-real",
        ts: "2026-05-20T10:00:00.000Z",
        type: "manual.decision",
        title: "Real decision",
      }),
      makeEvent({
        id: "ann-003",
        ts: "2026-05-20T10:01:00.000Z",
        type: "manual.annotation",
        relatedEventId: "evt-ghost-does-not-exist",
        note: "Ghost reference note",
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));

    expect(html).toContain("Ghost reference note");
    expect(html).toContain("Orphan Annotations");
  });

  it("does not emit Orphan Annotations section when no orphans exist", () => {
    const all: RenderEvent[] = [
      makeEvent({ id: "evt-x", ts: "2026-05-20T10:00:00.000Z", type: "manual.decision", title: "D" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    expect(html).not.toContain("Orphan Annotations");
  });
});
