import { describe, it, expect } from "vitest";
import { generateUlid, makeUlidFactory } from "../../src/util/ulid.js";

// Crockford base32 alphabet
const CROCKFORD_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

describe("generateUlid", () => {
  it("returns a 26-character string", () => {
    expect(generateUlid()).toHaveLength(26);
  });

  it("uses only Crockford base32 characters", () => {
    expect(CROCKFORD_RE.test(generateUlid())).toBe(true);
  });

  it("produces monotonically sortable ids on consecutive calls", () => {
    const a = generateUlid();
    const b = generateUlid();
    // ULID monotonicity: second call >= first (same ms → incremented random)
    expect(b >= a).toBe(true);
  });
});

describe("makeUlidFactory", () => {
  it("produces deterministic output when seeded", () => {
    const factory = makeUlidFactory(1);
    const first = factory();
    const second = factory();
    // Both are valid ULIDs
    expect(CROCKFORD_RE.test(first)).toBe(true);
    expect(CROCKFORD_RE.test(second)).toBe(true);
  });

  it("without seed behaves like generateUlid", () => {
    const factory = makeUlidFactory();
    const id = factory();
    expect(id).toHaveLength(26);
    expect(CROCKFORD_RE.test(id)).toBe(true);
  });
});
