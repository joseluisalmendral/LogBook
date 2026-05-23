/**
 * Unit tests: goal/outcome latest-write-wins and absent-renders-nothing (W6 spec).
 */

import { describe, it, expect } from "vitest";
import { buildSessionsDoc } from "../../src/generate/sessions-doc.js";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";

function makeEvent(id: string, ts: string, type: string, extra: Record<string, unknown> = {}): RenderEvent {
  return { id, ts, type, sessionId: "sess-001", ...extra };
}

function makeCtx(all: RenderEvent[]): RenderContext {
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
    latestSessionId: "",
    all,
  };
}

describe("goal latest-write-wins", () => {
  it("displays only the latest goal text when multiple goals exist", () => {
    const all: RenderEvent[] = [
      makeEvent("g1", "2026-05-20T10:00:00.000Z", "manual.session_goal", {
        text: "first goal — should not appear",
      }),
      makeEvent("e1", "2026-05-20T10:01:00.000Z", "user_prompt", { text: "prompt" }),
      makeEvent("g2", "2026-05-20T10:05:00.000Z", "manual.session_goal", {
        text: "updated goal — latest wins",
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));

    // The latest goal text appears.
    expect(html).toContain("updated goal — latest wins");
    // The first goal text should NOT appear (superseded by latest).
    expect(html).not.toContain("first goal — should not appear");
  });

  it("renders nothing for goal when no goal event exists", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "prompt" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    // No goal blockquote.
    expect(html).not.toContain("lb-session-goal");
    expect(html).not.toContain("Goal:");
  });
});

describe("outcome latest-write-wins", () => {
  it("displays only the latest outcome text when multiple outcomes exist", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "start" }),
      makeEvent("o1", "2026-05-20T10:05:00.000Z", "manual.session_outcome", {
        text: "partial outcome — superseded",
      }),
      makeEvent("o2", "2026-05-20T10:10:00.000Z", "manual.session_outcome", {
        text: "final outcome — latest",
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));

    expect(html).toContain("final outcome — latest");
    expect(html).not.toContain("partial outcome — superseded");
  });

  it("renders nothing for outcome when no outcome event exists", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "prompt" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    expect(html).not.toContain("lb-session-outcome");
    expect(html).not.toContain("Outcome:");
  });
});
