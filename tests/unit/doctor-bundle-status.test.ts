/**
 * Unit tests for SG-C: doctor bundle soft warning helpers.
 * Tests are written BEFORE the implementation (TDD RED phase).
 *
 * Helpers under test (to be added to src/cli/commands/doctor.ts):
 *   softThresholdKb(capKb: number): number
 *   classifyBundle(sizeBytes: number, capKb: number): "ok" | "warn" | "fail"
 */

import { describe, it, expect } from "vitest";

// Helpers are exported from doctor.ts itself (keeps bundle footprint minimal)
import {
  softThresholdKb,
  classifyBundle,
} from "../../src/cli/commands/doctor.js";

describe("softThresholdKb", () => {
  it("cap >= 200 KB uses cap - 20 formula", () => {
    expect(softThresholdKb(400)).toBe(380);
  });

  it("cap = 200 is the boundary — uses cap - 20", () => {
    expect(softThresholdKb(200)).toBe(180);
  });

  it("cap = 199 uses floor(cap * 0.95)", () => {
    expect(softThresholdKb(199)).toBe(Math.floor(199 * 0.95)); // 189
  });

  it("cap = 100 uses floor(cap * 0.95)", () => {
    expect(softThresholdKb(100)).toBe(Math.floor(100 * 0.95)); // 95
  });

  it("cap = 80 uses floor(cap * 0.95)", () => {
    expect(softThresholdKb(80)).toBe(Math.floor(80 * 0.95)); // 76
  });

  it("cap = 50 uses floor(cap * 0.95)", () => {
    expect(softThresholdKb(50)).toBe(Math.floor(50 * 0.95)); // 47
  });
});

describe("classifyBundle", () => {
  // cap=400, soft=380 → thresholds: soft=380*1024, cap=400*1024
  const cap = 400;
  const soft = 380;
  const softBytes = soft * 1024;
  const capBytes = cap * 1024;

  it("returns 'ok' for size < soft threshold", () => {
    expect(classifyBundle(softBytes - 1, cap)).toBe("ok");
  });

  it("returns 'warn' for size === soft threshold (boundary)", () => {
    expect(classifyBundle(softBytes, cap)).toBe("warn");
  });

  it("returns 'warn' for soft <= size < cap", () => {
    expect(classifyBundle(capBytes - 1, cap)).toBe("warn");
  });

  it("returns 'fail' for size === cap (boundary)", () => {
    expect(classifyBundle(capBytes, cap)).toBe("fail");
  });

  it("returns 'fail' for size > cap", () => {
    expect(classifyBundle(capBytes + 1024, cap)).toBe("fail");
  });

  it("works for cap = 50 (small cap, floor formula)", () => {
    // soft = floor(50 * 0.95) = 47 KB = 48128 bytes
    const c50 = 50;
    const s47 = 47 * 1024;
    expect(classifyBundle(s47 - 1, c50)).toBe("ok");
    expect(classifyBundle(s47, c50)).toBe("warn");
    expect(classifyBundle(c50 * 1024, c50)).toBe("fail");
  });
});
