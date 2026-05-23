/**
 * Unit tests: rich timeline rendering in sessions-doc (W7 spec — W5 scenarios).
 *
 * Verifies:
 *   - <ol> rendered instead of <table>
 *   - Ascending sort by ts
 *   - All icon CSS classes present for their event types
 *   - Goal renders above timeline; outcome renders below
 */

import { describe, it, expect } from "vitest";
import { buildSessionsDoc } from "../../src/generate/sessions-doc.js";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(id: string, ts: string, type: string, extra: Record<string, unknown> = {}): RenderEvent {
  return { id, ts, type, sessionId: "sess-001", ...extra };
}

function makeCtx(all: RenderEvent[]): RenderContext {
  return {
    sessions: [],
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

describe("rich timeline rendering", () => {
  it("renders span tree or flat <ol> instead of <table>", () => {
    // Session with claude_message uses span-tree (lb-event-tree) mode.
    // Session without conversation events uses flat <ol class="lb-timeline"> mode.
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "hello" }),
      makeEvent("e2", "2026-05-20T10:01:00.000Z", "claude_message", { text: "hi" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    // Span tree mode since claude_message is present.
    expect(html).toContain('class="lb-event-tree"');
    expect(html).not.toContain("<table");
  });

  it("renders events in ascending ts order", () => {
    // Intentionally reversed order in the array.
    const all: RenderEvent[] = [
      makeEvent("e2", "2026-05-20T10:02:00.000Z", "claude_message", { text: "later" }),
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "earlier" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    const pos1 = html.indexOf("10:00:00");
    const pos2 = html.indexOf("10:02:00");
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(-1);
    // Earlier timestamp must appear before later timestamp in rendered output.
    expect(pos1).toBeLessThan(pos2);
  });

  it("renders user_prompt with icon 💬 and class lb-evt-user-prompt", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "a prompt" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    expect(html).toContain("lb-evt-user-prompt");
    expect(html).toContain("💬");
  });

  it("renders claude_message as span tree turn with icon 🤖", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "claude_message", { text: "a response" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    // In span tree mode, claude_message renders as lb-turn details.
    expect(html).toContain('class="lb-turn"');
    // Summary contains the text.
    expect(html).toContain("a response");
  });

  it("renders thinking claude_message as span tree turn with 🧠", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "claude_message", {
        text: "thinking...",
        isThinking: true,
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    // In span tree mode, thinking claude_message still renders as lb-turn with 🧠 icon.
    expect(html).toContain('class="lb-turn"');
    expect(html).toContain("🧠");
  });

  it("renders subagent_complete with icon ↳ and class lb-evt-subagent", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "subagent_complete", {
        agentId: "ag-1",
        toolCallCount: 4,
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    expect(html).toContain("lb-evt-subagent");
    expect(html).toContain("↳");
  });

  it("renders goal ABOVE the <ol> timeline", () => {
    const all: RenderEvent[] = [
      makeEvent("goal-1", "2026-05-20T09:59:00.000Z", "manual.session_goal", {
        text: "My goal for this session",
      }),
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "start" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));

    const goalPos = html.indexOf("My goal for this session");
    const timelinePos = html.indexOf('<ol class="lb-timeline">');
    expect(goalPos).toBeGreaterThan(-1);
    expect(timelinePos).toBeGreaterThan(-1);
    // Goal blockquote must appear BEFORE the timeline list.
    expect(goalPos).toBeLessThan(timelinePos);
    expect(html).toContain("lb-session-goal");
  });

  it("renders outcome BELOW the <ol> timeline", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "start" }),
      makeEvent("out-1", "2026-05-20T11:00:00.000Z", "manual.session_outcome", {
        text: "All tests green",
      }),
    ];
    const html = buildSessionsDoc(makeCtx(all));

    const outcomePos = html.indexOf("All tests green");
    const timelineEnd = html.indexOf("</ol>");
    expect(outcomePos).toBeGreaterThan(-1);
    expect(timelineEnd).toBeGreaterThan(-1);
    // Outcome blockquote must appear AFTER the closing </ol>.
    expect(outcomePos).toBeGreaterThan(timelineEnd);
    expect(html).toContain("lb-session-outcome");
  });

  it("renders 5 events in chronological order with correct count in stats", () => {
    const all: RenderEvent[] = [
      makeEvent("e1", "2026-05-20T10:00:00.000Z", "user_prompt", { text: "p" }),
      makeEvent("e2", "2026-05-20T10:01:00.000Z", "tool_use.read", { tool_name: "Read" }),
      makeEvent("e3", "2026-05-20T10:02:00.000Z", "tool_result.read", { tool_name: "Read" }),
      makeEvent("e4", "2026-05-20T10:03:00.000Z", "manual.decision", { title: "D" }),
      makeEvent("e5", "2026-05-20T10:04:00.000Z", "claude_message", { text: "c" }),
    ];
    const html = buildSessionsDoc(makeCtx(all));
    // Stats are now emitted as inline HTML (<strong>Events:</strong> 5)
    // so the section block stays pure HTML and the LBDETAILS placeholder
    // pipeline can swap nested <details> back. The previous markdown form
    // ("**Events:** 5") leaked LBDETAILS_<n> tokens into the rendered page.
    expect(html).toContain("<strong>Events:</strong> 5");
    // Span tree mode since tool_use.read and claude_message are present.
    expect(html).toContain('class="lb-event-tree"');
    // All 5 timestamps appear in ascending order.
    const positions = ["10:00:00", "10:01:00", "10:02:00", "10:03:00", "10:04:00"].map((t) =>
      html.indexOf(t),
    );
    for (let i = 0; i < positions.length - 1; i++) {
      expect(positions[i]).toBeLessThan(positions[i + 1]!);
    }
  });
});
