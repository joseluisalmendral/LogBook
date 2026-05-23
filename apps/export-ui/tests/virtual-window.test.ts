/*
 * Unit tests for virtual-window.ts — slice 12 P5 Bucket D part 2.
 *
 * Spec coverage: R-67 + INV-17 (≤ 80 mounted rows) + ADR-SC-D1 (manual window
 * slice, no external dep).
 *
 * The helper is PURE so all assertions live in plain `expect`s — no DOM mock.
 */

import { describe, expect, it } from "vitest";
import { computeWindow } from "../src/lib/util/virtual-window";

describe("computeWindow — degenerate cases", () => {
  it("returns an empty window when totalCount is 0", () => {
    const w = computeWindow({
      totalCount: 0,
      scrollTop: 0,
      viewportHeight: 600,
      rowHeight: 56,
    });
    expect(w).toEqual({ startIndex: 0, endIndex: 0, offsetTop: 0 });
  });

  it("returns an empty window when rowHeight is 0 (defensive)", () => {
    const w = computeWindow({
      totalCount: 100,
      scrollTop: 0,
      viewportHeight: 600,
      rowHeight: 0,
    });
    expect(w).toEqual({ startIndex: 0, endIndex: 0, offsetTop: 0 });
  });
});

describe("computeWindow — small lists (everything mounted)", () => {
  it("mounts all items when totalCount ≤ maxMounted", () => {
    const w = computeWindow({
      totalCount: 10,
      scrollTop: 0,
      viewportHeight: 600,
      rowHeight: 56,
    });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(10);
    expect(w.offsetTop).toBe(0);
  });

  it("mounts all items even when scrollTop > 0 (small list short-circuit)", () => {
    const w = computeWindow({
      totalCount: 50,
      scrollTop: 1500,
      viewportHeight: 600,
      rowHeight: 56,
    });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(50);
    expect(w.offsetTop).toBe(0);
  });
});

describe("computeWindow — large lists (windowed)", () => {
  it("centres the window on the visible viewport at mid scroll", () => {
    // 1000 rows of 56px = 56000px tall. Scroll to 5000px → firstVisible = 89.
    // viewportHeight 600 / 56 = 11 (ceil) visible rows. Overscan = 5 each side.
    // Naive: start = 84, end = 89 + 11 + 5 = 105. Mounted = 21.
    const w = computeWindow({
      totalCount: 1000,
      scrollTop: 5000,
      viewportHeight: 600,
      rowHeight: 56,
      overscan: 5,
    });
    expect(w.startIndex).toBe(84);
    expect(w.endIndex).toBe(105);
    expect(w.offsetTop).toBe(84 * 56);
    expect(w.endIndex - w.startIndex).toBeLessThanOrEqual(80);
  });

  it("clamps at the top (scrollTop 0, large list)", () => {
    const w = computeWindow({
      totalCount: 1000,
      scrollTop: 0,
      viewportHeight: 600,
      rowHeight: 56,
      overscan: 5,
    });
    expect(w.startIndex).toBe(0);
    // 0 - 5 → clamped to 0; end = 0 + 11 + 5 = 16
    expect(w.endIndex).toBe(16);
    expect(w.offsetTop).toBe(0);
  });

  it("clamps at the bottom (last items always reachable)", () => {
    // 1000 rows of 56px → 56000 total. Scroll to bottom: scrollTop ≈ 55400.
    const w = computeWindow({
      totalCount: 1000,
      scrollTop: 55400,
      viewportHeight: 600,
      rowHeight: 56,
      overscan: 5,
    });
    expect(w.endIndex).toBe(1000);
    // Mounted count ≤ overscan + visible + overscan = 21 in the worst case;
    // strictly < 80.
    expect(w.endIndex - w.startIndex).toBeLessThanOrEqual(80);
    // The last index MUST be in the mounted slice (no blank tail).
    expect(w.startIndex).toBeLessThan(1000);
  });
});

describe("computeWindow — INV-17 ceiling (≤ maxMounted rows)", () => {
  it("hard-caps mounted rows at maxMounted (80 by default) even with huge overscan", () => {
    // Pathological: 200-row overscan would mount 411 rows naively; we expect ≤ 80.
    const w = computeWindow({
      totalCount: 5000,
      scrollTop: 20000,
      viewportHeight: 600,
      rowHeight: 56,
      overscan: 200,
    });
    expect(w.endIndex - w.startIndex).toBeLessThanOrEqual(80);
  });

  it("respects an explicit lower maxMounted", () => {
    const w = computeWindow({
      totalCount: 5000,
      scrollTop: 20000,
      viewportHeight: 600,
      rowHeight: 56,
      overscan: 200,
      maxMounted: 40,
    });
    expect(w.endIndex - w.startIndex).toBeLessThanOrEqual(40);
  });

  it("never exceeds 80 with realistic phone viewport on 5000-event session", () => {
    // Smoke against the spec's worst case.
    for (const scrollTop of [0, 4000, 80000, 200000, 279944]) {
      const w = computeWindow({
        totalCount: 5000,
        scrollTop,
        viewportHeight: 800,
        rowHeight: 56,
      });
      expect(w.endIndex - w.startIndex).toBeLessThanOrEqual(80);
    }
  });
});

describe("computeWindow — viewport larger than content", () => {
  it("mounts all items when the viewport is taller than the entire list", () => {
    // 30 rows × 56px = 1680px. Viewport = 4000px. totalCount ≤ maxMounted (80).
    const w = computeWindow({
      totalCount: 30,
      scrollTop: 0,
      viewportHeight: 4000,
      rowHeight: 56,
    });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(30);
  });
});
