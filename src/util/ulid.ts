import { monotonicFactory } from "ulid";

// Module-level monotonic generator — guarantees sortable ids within this process.
const _mono = monotonicFactory();

/**
 * Generates a new ULID — 26-character Crockford base32, monotonically sortable.
 * Uses a module-level monotonic factory so consecutive calls within the same
 * millisecond produce incrementing values.
 */
export function generateUlid(): string {
  return _mono();
}

/**
 * Returns a ULID factory function.
 * When `seed` is provided the factory uses a fixed PRNG so tests can produce
 * deterministic output; without seed it behaves identically to `generateUlid`.
 */
export function makeUlidFactory(seed?: number): () => string {
  if (seed !== undefined) {
    // Simple seeded PRNG (mulberry32) — deterministic for tests only.
    let s = seed;
    const prng = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return monotonicFactory(prng);
  }
  return monotonicFactory();
}
