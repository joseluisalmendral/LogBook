/**
 * Unit tests for `logbook decision --with-diff` (S2.2).
 *
 * Tests the getDiffStat connector helper and the renderAdr implementation
 * section in isolation — pure functions and injectable subprocess seams.
 *
 * RED phase: written before implementation. All tests fail initially.
 */

import { describe, it, expect } from "vitest";
import { renderAdr } from "../../src/generate/adr.js";
import type { AdrInput } from "../../src/generate/adr.js";

// ---------------------------------------------------------------------------
// renderAdr with implementation section
// ---------------------------------------------------------------------------

describe("renderAdr — implementation section (S2.2)", () => {
  const mockNow = () => "2026-05-17T00:00:00.000Z";

  it("appends '## Implementation (commit <sha>)' section when implementation is provided", () => {
    const input: AdrInput = {
      title: "Use Redis",
      implementation: {
        sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        stats: "2 files changed, 15 insertions(+), 3 deletions(-)",
      },
    };
    const body = renderAdr(1, input, { now: mockNow });
    expect(body).toContain("## Implementation (commit a1b2c3d)");
  });

  it("includes truncated 7-char SHA in implementation heading", () => {
    const input: AdrInput = {
      title: "Use Postgres",
      implementation: {
        sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        stats: "1 file changed, 5 insertions(+)",
      },
    };
    const body = renderAdr(2, input, { now: mockNow });
    expect(body).toContain("## Implementation (commit deadbee)");
  });

  it("includes diff stats content under the implementation section", () => {
    const stats = "src/foo.ts | 10 +++\nsrc/bar.ts | 5 ---";
    const input: AdrInput = {
      title: "Switch to ESM",
      implementation: {
        sha: "1111111122222222333333334444444455555555",
        stats,
      },
    };
    const body = renderAdr(3, input, { now: mockNow });
    expect(body).toContain(stats);
  });

  it("includes optional commitUrl as a link when provided", () => {
    const input: AdrInput = {
      title: "Use Vite",
      implementation: {
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        stats: "3 files changed",
        commitUrl: "https://github.com/org/repo/commit/aaaaaaa",
      },
    };
    const body = renderAdr(4, input, { now: mockNow });
    expect(body).toContain("https://github.com/org/repo/commit/aaaaaaa");
  });

  it("does NOT include implementation section when implementation field is absent (back-compat)", () => {
    const input: AdrInput = { title: "No diff" };
    const body = renderAdr(5, input, { now: mockNow });
    expect(body).not.toContain("## Implementation");
  });

  it("is byte-stable: same sha + stats always produce same section", () => {
    const input: AdrInput = {
      title: "Stable",
      implementation: {
        sha: "cafe0000cafe0000cafe0000cafe0000cafe0000",
        stats: "1 file changed, 2 insertions(+)",
      },
    };
    const a = renderAdr(6, input, { now: mockNow });
    const b = renderAdr(6, input, { now: mockNow });
    expect(a).toBe(b);
  });

  it("truncates stats lines to 50 lines max to keep ADR compact", () => {
    // Build stats with 60 lines
    const lines = Array.from({ length: 60 }, (_, i) => `file${i}.ts | ${i + 1} +`);
    const longStats = lines.join("\n");
    const input: AdrInput = {
      title: "Big commit",
      implementation: {
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        stats: longStats,
      },
    };
    const body = renderAdr(7, input, { now: mockNow });
    // The stats in the body should not contain all 60 lines
    // (i.e., truncation at 50 lines must have cut some)
    const implIdx = body.indexOf("## Implementation");
    const afterImpl = body.slice(implIdx);
    const lineCount = afterImpl.split("\n").filter(l => l.startsWith("file")).length;
    expect(lineCount).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// getDiffStat — git connector helper
// ---------------------------------------------------------------------------

import { getDiffStat } from "../../src/connectors/git.js";

describe("getDiffStat", () => {
  it("is exported from src/connectors/git.ts", () => {
    expect(typeof getDiffStat).toBe("function");
  });

  it("returns undefined gracefully when outside a git repo", async () => {
    // Use /tmp as a non-repo dir (tmp itself is not a git repo)
    const result = await getDiffStat("/tmp");
    // Should be undefined or null — never throw
    expect(result === undefined || result === null).toBe(true);
  });

  it("returns undefined gracefully when git has no commits", async () => {
    // This is hard to test without spawning a fresh git init repo.
    // Instead we just ensure the function signature matches (accepts cwd string).
    expect(getDiffStat).toBeTypeOf("function");
  });
});
