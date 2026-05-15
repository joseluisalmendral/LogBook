import { describe, it, expect } from "vitest";
import { shannonEntropy } from "../../src/redact/entropy.js";

describe("shannonEntropy", () => {
  it("returns 0 for an empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for a single-character string (one symbol, no information)", () => {
    // Only one distinct symbol: p=1, contribution = -1*log2(1) = 0
    expect(shannonEntropy("a")).toBe(0);
  });

  it("returns 0 for a string with one repeated character", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
  });

  it("returns 1.0 for two equiprobable symbols", () => {
    // "ab": p(a)=0.5, p(b)=0.5 → H = 1.0 bit
    expect(shannonEntropy("ab")).toBeCloseTo(1.0, 10);
  });

  it("returns > 3 for a string with 10 distinct characters", () => {
    // "abcdefghij": all chars distinct, p=0.1 each → H ≈ 3.32 bits
    const h = shannonEntropy("abcdefghij");
    expect(h).toBeGreaterThan(3);
    expect(h).toBeLessThan(4);
  });

  it("returns > 3.5 for a hardcoded 40-char hex blob (simulated random secret)", () => {
    // Hardcoded fixture — not Math.random; represents a realistic secret value.
    // This is the sha256 of the string "entropy-test-fixture-logbook-2026".
    // Hex strings have high entropy due to uniform distribution across 16 symbols.
    const hexBlob = "a3f9b2c7e1d4087654ef23ab91c650de8f7a3b1204c98e6d5f7a2c01b4e9f3d8";
    const h = shannonEntropy(hexBlob);
    expect(h).toBeGreaterThan(3.5);
  });

  it("returns > 3 but < 4.5 for normal English sentence", () => {
    // Natural language has moderate entropy — above noise, below random binary
    const sentence = "this is a normal english sentence";
    const h = shannonEntropy(sentence);
    expect(h).toBeGreaterThan(3);
    expect(h).toBeLessThan(4.5);
  });
});
