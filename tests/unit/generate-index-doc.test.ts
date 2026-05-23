/**
 * Unit tests: generate/index-doc.ts — buildIndexDoc (T11).
 *
 * Tests:
 *  - Mock context → expected Markdown sections present
 *  - Determinism: same input → same output bytes
 *  - Sessions sorted by ts ascending
 *  - Decisions sorted by counter ascending (then adrCounter field)
 *  - Empty context produces valid minimal document
 */

import { describe, it, expect } from "vitest";
import { buildIndexDoc } from "../../src/generate/index-doc.js";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";

function makeContext(overrides: Partial<RenderContext> = {}): RenderContext {
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

function makeEvent(overrides: Partial<RenderEvent> & { type: string }): RenderEvent {
  return {
    id: "01AAAA",
    ts: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildIndexDoc", () => {
  it("returns a string containing # LogBook heading", () => {
    const doc = buildIndexDoc(makeContext());
    expect(doc).toContain("# LogBook");
  });

  it("empty context produces valid minimal document without errors", () => {
    const doc = buildIndexDoc(makeContext());
    expect(typeof doc).toBe("string");
    expect(doc.length).toBeGreaterThan(0);
  });

  it("sessions section lists sessions with id and label sorted by ts", () => {
    const ctx = makeContext({
      sessions: [
        makeEvent({ id: "S2", type: "manual.session_start", ts: "2026-01-02T00:00:00.000Z", title: "Session Beta" }),
        makeEvent({ id: "S1", type: "manual.session_start", ts: "2026-01-01T00:00:00.000Z", title: "Session Alpha" }),
      ],
    });
    const doc = buildIndexDoc(ctx);
    // Should contain both sessions; Alpha before Beta
    const alphaPos = doc.indexOf("Session Alpha");
    const betaPos = doc.indexOf("Session Beta");
    expect(alphaPos).toBeGreaterThan(-1);
    expect(betaPos).toBeGreaterThan(-1);
    expect(alphaPos).toBeLessThan(betaPos);
  });

  it("milestones section lists milestones sorted by ts", () => {
    const ctx = makeContext({
      milestones: [
        makeEvent({ id: "M2", type: "manual.milestone", ts: "2026-01-02T00:00:00.000Z", title: "Milestone B" }),
        makeEvent({ id: "M1", type: "manual.milestone", ts: "2026-01-01T00:00:00.000Z", title: "Milestone A" }),
      ],
    });
    const doc = buildIndexDoc(ctx);
    const posA = doc.indexOf("Milestone A");
    const posB = doc.indexOf("Milestone B");
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(-1);
    expect(posA).toBeLessThan(posB);
  });

  it("decisions section (ADR index) shows counter, title, status", () => {
    const ctx = makeContext({
      decisions: [
        makeEvent({
          id: "D1",
          type: "manual.decision",
          ts: "2026-01-01T00:00:00.000Z",
          title: "Use Vite",
          adrCounter: 1,
          status: "Accepted",
        }),
        makeEvent({
          id: "D2",
          type: "manual.decision",
          ts: "2026-01-02T00:00:00.000Z",
          title: "Use ESM",
          adrCounter: 2,
          status: "Proposed",
        }),
      ],
    });
    const doc = buildIndexDoc(ctx);
    expect(doc).toContain("Use Vite");
    expect(doc).toContain("Use ESM");
    expect(doc).toContain("Accepted");
    expect(doc).toContain("Proposed");
  });

  it("is deterministic — same input produces identical output", () => {
    const ctx = makeContext({
      sessions: [
        makeEvent({ id: "S1", type: "manual.session_start", ts: "2026-01-01T00:00:00.000Z", title: "S1" }),
      ],
      decisions: [
        makeEvent({ id: "D1", type: "manual.decision", ts: "2026-01-01T00:00:00.000Z", title: "D1", adrCounter: 1 }),
      ],
      milestones: [
        makeEvent({ id: "M1", type: "manual.milestone", ts: "2026-01-01T00:00:00.000Z", title: "M1" }),
      ],
    });
    const doc1 = buildIndexDoc(ctx);
    const doc2 = buildIndexDoc(ctx);
    expect(doc1).toBe(doc2);
  });

  it("decisions section sorted by adrCounter ascending (not ts)", () => {
    const ctx = makeContext({
      decisions: [
        makeEvent({
          id: "D3",
          type: "manual.decision",
          ts: "2026-01-01T00:00:00.000Z",
          title: "Counter 3",
          adrCounter: 3,
        }),
        makeEvent({
          id: "D1",
          type: "manual.decision",
          ts: "2026-01-02T00:00:00.000Z",
          title: "Counter 1",
          adrCounter: 1,
        }),
        makeEvent({
          id: "D2",
          type: "manual.decision",
          ts: "2026-01-03T00:00:00.000Z",
          title: "Counter 2",
          adrCounter: 2,
        }),
      ],
    });
    const doc = buildIndexDoc(ctx);
    const pos1 = doc.indexOf("Counter 1");
    const pos2 = doc.indexOf("Counter 2");
    const pos3 = doc.indexOf("Counter 3");
    expect(pos1).toBeLessThan(pos2);
    expect(pos2).toBeLessThan(pos3);
  });
});
