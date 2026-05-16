/**
 * Unit tests: generate/timeline-doc.ts — buildTimelineDoc (T11).
 *
 * Tests:
 *  - Mock context with events across 2 phases → phase headers + correct order
 *  - Events sorted by ts ascending
 *  - Phase header appears when phase name changes
 *  - Deterministic output
 */

import { describe, it, expect } from "vitest";
import { buildTimelineDoc } from "../../src/generate/timeline-doc.js";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";

function makeContext(all: RenderEvent[]): RenderContext {
  return {
    sessions: [],
    phases: [],
    decisions: all.filter((e) => e.type === "manual.decision"),
    errors: all.filter((e) => e.type === "manual.error"),
    fixes: all.filter((e) => e.type === "manual.fix"),
    lessons: all.filter((e) => e.type === "manual.lesson"),
    resources: all.filter((e) => e.type === "manual.resource"),
    visuals: all.filter((e) => e.type === "manual.visual"),
    milestones: all.filter((e) => e.type === "manual.milestone"),
    all,
  };
}

function makeEvent(overrides: { id: string; type: string; ts: string; title?: string; phase?: string }): RenderEvent {
  const e: RenderEvent = {
    id: overrides.id,
    type: overrides.type,
    ts: overrides.ts,
  };
  if (overrides.title !== undefined) e["title"] = overrides.title;
  if (overrides.phase !== undefined) e["phase"] = overrides.phase;
  return e;
}

describe("buildTimelineDoc", () => {
  it("returns a string with # Timeline heading", () => {
    const doc = buildTimelineDoc(makeContext([]));
    expect(doc).toContain("# Timeline");
  });

  it("empty context produces valid minimal document", () => {
    const doc = buildTimelineDoc(makeContext([]));
    expect(typeof doc).toBe("string");
    expect(doc.length).toBeGreaterThan(0);
  });

  it("events sorted by ts ascending appear in chronological order", () => {
    const events: RenderEvent[] = [
      makeEvent({ id: "e3", type: "manual.decision", ts: "2026-01-03T00:00:00.000Z", title: "C" }),
      makeEvent({ id: "e1", type: "manual.error", ts: "2026-01-01T00:00:00.000Z", title: "A" }),
      makeEvent({ id: "e2", type: "manual.lesson", ts: "2026-01-02T00:00:00.000Z", title: "B" }),
    ];
    const ctx = makeContext(events.sort(() => 0)); // unsorted input
    const doc = buildTimelineDoc(ctx);
    const posA = doc.indexOf("A");
    const posB = doc.indexOf("B");
    const posC = doc.indexOf("C");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
  });

  it("phase headers are inserted when phase name changes", () => {
    const events: RenderEvent[] = [
      makeEvent({ id: "e1", type: "manual.decision", ts: "2026-01-01T00:00:00.000Z", title: "D1", phase: "Phase 1" }),
      makeEvent({ id: "e2", type: "manual.error", ts: "2026-01-02T00:00:00.000Z", title: "E1", phase: "Phase 1" }),
      makeEvent({ id: "e3", type: "manual.lesson", ts: "2026-01-03T00:00:00.000Z", title: "L1", phase: "Phase 2" }),
    ];
    const ctx = makeContext(events);
    const doc = buildTimelineDoc(ctx);
    expect(doc).toContain("Phase 1");
    expect(doc).toContain("Phase 2");
    // Phase 1 header appears before Phase 2 header
    expect(doc.indexOf("Phase 1")).toBeLessThan(doc.indexOf("Phase 2"));
  });

  it("each event is represented with its timestamp and title or type", () => {
    const events: RenderEvent[] = [
      makeEvent({ id: "e1", type: "manual.decision", ts: "2026-01-01T00:00:00.000Z", title: "Use ESM" }),
    ];
    const ctx = makeContext(events);
    const doc = buildTimelineDoc(ctx);
    expect(doc).toContain("2026-01-01");
    expect(doc).toContain("Use ESM");
  });

  it("is deterministic — same input twice → identical output bytes", () => {
    const events: RenderEvent[] = [
      makeEvent({ id: "e1", type: "manual.decision", ts: "2026-01-01T00:00:00.000Z", title: "D1" }),
      makeEvent({ id: "e2", type: "manual.error", ts: "2026-01-02T00:00:00.000Z", title: "E1" }),
    ];
    const ctx = makeContext(events);
    const doc1 = buildTimelineDoc(ctx);
    const doc2 = buildTimelineDoc(ctx);
    expect(doc1).toBe(doc2);
  });
});
