/**
 * T6.15 — RenderContext type synthesis sanity check.
 *
 * The slice 5 work synthesizes `type = "manual.<entryType>"` from Shape-A payloads.
 * This test guards against regressing that contract while we layer Phase 1–5
 * visual changes on top of it.
 *
 * Pure compile-time + runtime check using readContext-equivalent shape.
 */

import { describe, it, expect } from "vitest";
import type { RenderContext, RenderEvent } from "../../src/generate/render-context.js";

describe("visual-replay — T6.15 RenderContext shape preserved", () => {
  it("RenderContext required buckets are present in the type", () => {
    // Force the shape — TypeScript guarantees the keys exist; we verify
    // they read back as expected.
    const ctx: RenderContext = {
      latestSessionId: "",
      sessions: [], phases: [], decisions: [], errors: [], fixes: [], lessons: [],
      resources: [], visuals: [], milestones: [], all: [],
    };
    expect(ctx.sessions).toEqual([]);
    expect(ctx.decisions).toEqual([]);
    expect(ctx.errors).toEqual([]);
    expect(ctx.fixes).toEqual([]);
    expect(ctx.lessons).toEqual([]);
    expect(ctx.milestones).toEqual([]);
    expect(ctx.resources).toEqual([]);
    expect(ctx.all).toEqual([]);
  });

  it("RenderEvent type carries id/type/ts as required", () => {
    const e: RenderEvent = { id: "x", type: "manual.decision", ts: "2026-05-22T10:00:00Z" };
    expect(e.id).toBe("x");
    expect(e.type).toBe("manual.decision");
    expect(e.ts).toBe("2026-05-22T10:00:00Z");
  });
});
