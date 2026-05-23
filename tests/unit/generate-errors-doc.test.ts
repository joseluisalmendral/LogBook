/**
 * Unit tests: generate/errors-doc.ts — buildErrorsDoc (T11).
 *
 * Tests:
 *  - 2 errors (one resolved with fix, one not) → sections correct
 *  - 2 lessons (one promotable) → promotable sorts first
 *  - Empty context → valid document
 *  - Deterministic output
 */

import { describe, it, expect } from "vitest";
import { buildErrorsDoc } from "../../src/generate/errors-doc.js";
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

describe("buildErrorsDoc", () => {
  it("returns a string with Errors and fixes heading", () => {
    const doc = buildErrorsDoc(makeContext());
    expect(doc).toContain("## Errors and fixes");
  });

  it("returns a string with Lessons heading", () => {
    const doc = buildErrorsDoc(makeContext());
    expect(doc).toContain("## Lessons");
  });

  it("empty context produces valid minimal document", () => {
    const doc = buildErrorsDoc(makeContext());
    expect(typeof doc).toBe("string");
    expect(doc.length).toBeGreaterThan(0);
  });

  it("error with linked fix shows both error and fix description", () => {
    const error = makeEvent({
      id: "ERR1",
      type: "manual.error",
      ts: "2026-01-01T00:00:00.000Z",
      title: "Null pointer crash",
      kind: "NullPointer",
    });
    const fix = makeEvent({
      id: "FIX1",
      type: "manual.fix",
      ts: "2026-01-02T00:00:00.000Z",
      title: "Fixed null check",
      errorId: "ERR1",
      description: "Added null guard before access",
    });
    const ctx = makeContext({ errors: [error], fixes: [fix] });
    const doc = buildErrorsDoc(ctx);
    expect(doc).toContain("Null pointer crash");
    expect(doc).toContain("Fixed null check");
  });

  it("error without fix shows error but no fix details", () => {
    const error = makeEvent({
      id: "ERR2",
      type: "manual.error",
      ts: "2026-01-01T00:00:00.000Z",
      title: "Timeout error",
    });
    const ctx = makeContext({ errors: [error] });
    const doc = buildErrorsDoc(ctx);
    expect(doc).toContain("Timeout error");
  });

  it("promotable lesson sorts before non-promotable lesson", () => {
    const nonPromotable = makeEvent({
      id: "L1",
      type: "manual.lesson",
      ts: "2026-01-01T00:00:00.000Z",
      title: "Regular lesson",
      promotable: false,
    });
    const promotable = makeEvent({
      id: "L2",
      type: "manual.lesson",
      ts: "2026-01-02T00:00:00.000Z",
      title: "Promotable lesson",
      promotable: true,
    });
    const ctx = makeContext({ lessons: [nonPromotable, promotable] });
    const doc = buildErrorsDoc(ctx);
    const posPromotable = doc.indexOf("Promotable lesson");
    const posRegular = doc.indexOf("Regular lesson");
    expect(posPromotable).toBeLessThan(posRegular);
  });

  it("two lessons both non-promotable sorted by ts ascending", () => {
    const lessons: RenderEvent[] = [
      makeEvent({ id: "L2", type: "manual.lesson", ts: "2026-01-02T00:00:00.000Z", title: "B lesson", promotable: false }),
      makeEvent({ id: "L1", type: "manual.lesson", ts: "2026-01-01T00:00:00.000Z", title: "A lesson", promotable: false }),
    ];
    const ctx = makeContext({ lessons });
    const doc = buildErrorsDoc(ctx);
    const posA = doc.indexOf("A lesson");
    const posB = doc.indexOf("B lesson");
    expect(posA).toBeLessThan(posB);
  });

  it("is deterministic — same input twice → identical output bytes", () => {
    const error = makeEvent({ id: "E1", type: "manual.error", ts: "2026-01-01T00:00:00.000Z", title: "E1" });
    const lesson = makeEvent({ id: "L1", type: "manual.lesson", ts: "2026-01-01T00:00:00.000Z", title: "L1", promotable: true });
    const ctx = makeContext({ errors: [error], lessons: [lesson] });
    const doc1 = buildErrorsDoc(ctx);
    const doc2 = buildErrorsDoc(ctx);
    expect(doc1).toBe(doc2);
  });
});
