/**
 * Unit tests for SlidingWindowLimiter.
 *
 * Policy under test:
 *  - max 20 calls per toolName within a 1000ms window
 *  - each toolName tracks its own independent window
 *  - window slides: calls older than windowMs are pruned on each allow() invocation
 *  - boundary: a call whose timestamp is EXACTLY windowMs ago is pruned (>= age check),
 *    so the 21st call at exactly windowMs after the first is ALLOWED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlidingWindowLimiter } from "../../src/mcp/rate-limit.js";

describe("SlidingWindowLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first 20 calls within the window", () => {
    const limiter = new SlidingWindowLimiter(20, 1000);
    for (let i = 0; i < 20; i++) {
      expect(limiter.allow("tool_a"), `call ${i + 1} should be allowed`).toBe(
        true,
      );
    }
  });

  it("rejects the 21st call within the same 1000ms window", () => {
    const limiter = new SlidingWindowLimiter(20, 1000);
    for (let i = 0; i < 20; i++) {
      limiter.allow("tool_a");
    }
    expect(limiter.allow("tool_a")).toBe(false);
  });

  it("allows calls again after the window slides past the first batch", () => {
    const limiter = new SlidingWindowLimiter(20, 1000);
    const start = Date.now();

    // Fill the window.
    for (let i = 0; i < 20; i++) {
      limiter.allow("tool_a");
    }

    // Advance exactly 1000ms — the earliest timestamps are now exactly windowMs old
    // and should be pruned (boundary: pruned when age >= windowMs).
    vi.setSystemTime(start + 1000);

    // All 20 prior calls are pruned; window is now empty — next 20 allowed.
    for (let i = 0; i < 20; i++) {
      expect(
        limiter.allow("tool_a"),
        `post-slide call ${i + 1} should be allowed`,
      ).toBe(true);
    }
  });

  it("tracks each tool name independently", () => {
    const limiter = new SlidingWindowLimiter(20, 1000);

    // Exhaust tool_a.
    for (let i = 0; i < 20; i++) {
      limiter.allow("tool_a");
    }

    // tool_b should still have its full quota — 20 independent calls allowed.
    for (let i = 0; i < 20; i++) {
      expect(
        limiter.allow("tool_b"),
        `tool_b call ${i + 1} should be allowed`,
      ).toBe(true);
    }

    // tool_a is still exhausted.
    expect(limiter.allow("tool_a")).toBe(false);
    // tool_b 21st is rejected.
    expect(limiter.allow("tool_b")).toBe(false);
  });

  it("allows a never-called tool name on first invocation", () => {
    const limiter = new SlidingWindowLimiter(20, 1000);
    expect(limiter.allow("brand_new_tool")).toBe(true);
  });

  it("boundary: exactly at windowMs the call is allowed (pruned on equal age)", () => {
    const limiter = new SlidingWindowLimiter(1, 1000);
    const start = Date.now();

    // Use up the single slot.
    limiter.allow("t");
    // Rejected at t+1ms.
    vi.setSystemTime(start + 1);
    expect(limiter.allow("t")).toBe(false);

    // At exactly t+1000ms the original call is exactly 1000ms old → pruned.
    vi.setSystemTime(start + 1000);
    expect(limiter.allow("t")).toBe(true);
  });

  it("partial slide: only expired entries are pruned, not all", () => {
    const limiter = new SlidingWindowLimiter(3, 1000);
    const start = Date.now();

    // t=0: call 1 and 2
    limiter.allow("t");
    limiter.allow("t");

    // t=500ms: call 3
    vi.setSystemTime(start + 500);
    limiter.allow("t");
    // Window full at t=500: calls 1,2 (age 500ms), call 3 (age 0ms) → 3 total → reject.
    expect(limiter.allow("t")).toBe(false);

    // t=1000ms: calls 1,2 are exactly 1000ms old → pruned. Call 3 is 500ms old → kept.
    vi.setSystemTime(start + 1000);
    // 1 slot used (call 3), 2 free.
    expect(limiter.allow("t")).toBe(true); // 2 slots now used
    expect(limiter.allow("t")).toBe(true); // 3 slots used
    expect(limiter.allow("t")).toBe(false); // full again
  });
});
