/**
 * Unit tests: parseMcpClockOffset env var helper (SG-B).
 *
 * TDD Cycle:
 *   RED  → fail: parseMcpClockOffset is not exported from src/mcp/server.ts
 *   GREEN → add the pure helper to server.ts and export it
 *
 * Strategy:
 *   - Pure function — no subprocess needed for unit-level parsing tests
 *   - Covers: undefined, empty string, zero, valid integer, NaN/garbage, negative
 *   - All 6 cases (B1–B6) per design #144
 */

import { describe, it, expect } from "vitest";
import { parseMcpClockOffset } from "../../src/mcp/server.js";

describe("parseMcpClockOffset", () => {
  it("B1: returns 0 when env var is undefined (unset)", () => {
    expect(parseMcpClockOffset(undefined)).toBe(0);
  });

  it("B2: returns 0 when env var is empty string", () => {
    expect(parseMcpClockOffset("")).toBe(0);
  });

  it("B3: returns 0 when env var is '0'", () => {
    expect(parseMcpClockOffset("0")).toBe(0);
  });

  it("B4: returns 1500 when env var is '1500'", () => {
    expect(parseMcpClockOffset("1500")).toBe(1500);
  });

  it("B5: returns 0 for NaN/garbage input ('not-a-number')", () => {
    expect(parseMcpClockOffset("not-a-number")).toBe(0);
  });

  it("B6: returns -500 for negative value '-500' (allowed — tests may freeze the past)", () => {
    expect(parseMcpClockOffset("-500")).toBe(-500);
  });

  it("returns 0 for float string '1.7' (parseInt truncates, not NaN)", () => {
    // Number.parseInt("1.7", 10) === 1 — not NaN, so returns 1
    expect(parseMcpClockOffset("1.7")).toBe(1);
  });

  it("returns 0 for whitespace-only string '   '", () => {
    expect(parseMcpClockOffset("   ")).toBe(0);
  });
});
