/**
 * Unit tests: SlidingWindowLimiter clock injection (S4.2).
 *
 * TDD Cycle:
 *   RED  → fail: constructor does not accept clock argument
 *   GREEN → add `clock?: () => number` to SlidingWindowLimiter
 *
 * Strategy:
 *   - Inject a mutable mock clock to avoid any sleep() in tests
 *   - Verify the limiter uses the injected clock for both allow() timestamps
 *     and window eviction (cutoff = now - windowMs)
 *   - Tests run in < 1ms (no wall-clock waits)
 */

import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "../../src/mcp/rate-limit.js";

describe("SlidingWindowLimiter — clock injection", () => {
  it("respects injected clock: capacity refreshes when clock advances past window", () => {
    // Arrange: mock clock starts at t=1000
    let now = 1000;
    const clock = () => now;

    // windowMs=1000, maxCallsPerWindow=3 — small limit for quick exhaustion
    const limiter = new SlidingWindowLimiter(3, 1000, { clock });

    // Exhaust the window at t=1000
    expect(limiter.allow("tool")).toBe(true);
    expect(limiter.allow("tool")).toBe(true);
    expect(limiter.allow("tool")).toBe(true);

    // 4th call at same time → rejected
    expect(limiter.allow("tool")).toBe(false);

    // Advance clock past window (t=1000+1001=2001, cutoff=2001-1000=1001 > all timestamps)
    now = 2001;

    // Capacity refreshed — should succeed again
    expect(limiter.allow("tool")).toBe(true);
  });

  it("uses injected clock for allow() timestamps (timestamps recorded = clock value)", () => {
    // Arrange: frozen clock at t=5000
    let now = 5000;
    const clock = () => now;

    const limiter = new SlidingWindowLimiter(2, 1000, { clock });

    // Record 2 calls at t=5000
    expect(limiter.allow("x")).toBe(true);
    expect(limiter.allow("x")).toBe(true);
    expect(limiter.allow("x")).toBe(false); // window full

    // Advance clock by exactly windowMs (not past it): cutoff = 6000 - 1000 = 5000
    // Timestamps at 5000 are evicted (ts <= cutoff), so window clears
    now = 6000;
    expect(limiter.allow("x")).toBe(true);
  });

  it("defaults to Date.now when no clock option provided", () => {
    // No clock injected — verify it still works (uses Date.now internally)
    const limiter = new SlidingWindowLimiter(2, 1000);
    expect(limiter.allow("y")).toBe(true);
    expect(limiter.allow("y")).toBe(true);
    expect(limiter.allow("y")).toBe(false);
  });

  it("per-tool isolation preserved with injected clock", () => {
    let now = 100;
    const clock = () => now;
    const limiter = new SlidingWindowLimiter(2, 1000, { clock });

    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true); // separate window
    expect(limiter.allow("b")).toBe(true); // separate window
    expect(limiter.allow("a")).toBe(false); // a exhausted
    expect(limiter.allow("b")).toBe(false); // b exhausted
  });
});
