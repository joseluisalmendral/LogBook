/**
 * Integration test: atomic adrCounter under concurrent writeAdrFile calls (T9).
 *
 * Contract: 10 concurrent decisions → unique monotonic counters 1..10,
 * 10 files, no duplicates, no gaps, no partial writes.
 *
 * This is the atomicity smoke test specified in T9.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { writeAdrFile } from "../../src/generate/adr.js";
import { makePaths } from "../../src/core/paths.js";
import { readState } from "../../src/core/state.js";

function makeTmpProject(): ReturnType<typeof makePaths> {
  const root = join(
    tmpdir(),
    `logbook-adr-atomic-${randomBytes(6).toString("hex")}`,
  );
  mkdirSync(join(root, ".logbook"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", version: "0.0.0" }));
  // state.json with adrCounter: 0
  writeFileSync(
    join(root, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [], staleLocksReleased: 0, adrCounter: 0 }) + "\n",
  );
  return makePaths(root);
}

describe("adr-counter-atomic", () => {
  it("10 concurrent writeAdrFile calls produce unique monotonic counters 1..10", async () => {
    const paths = makeTmpProject();
    const N = 10;

    // Spawn 10 promises simultaneously with different titles.
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        writeAdrFile(paths, { title: `Decision number ${i + 1}` }),
      ),
    );

    // 1. All 10 completed without error.
    expect(results).toHaveLength(N);

    // 2. state.json has adrCounter === 10.
    const state = readState(paths.statePath);
    expect(state.adrCounter).toBe(N);

    // 3. 10 files in logbook/decisions/.
    const decisionsDir = join(paths.dataDir, "decisions");
    const files = readdirSync(decisionsDir);
    expect(files).toHaveLength(N);

    // 4. Counter values are strictly 1..N (no duplicates, no gaps).
    const counters = results.map((r) => r.counter).sort((a, b) => a - b);
    for (let i = 0; i < N; i++) {
      expect(counters[i]).toBe(i + 1);
    }

    // 5. No duplicate counters.
    const uniqueCounters = new Set(counters);
    expect(uniqueCounters.size).toBe(N);

    // 6. File names match their counter (filename prefix = counter zero-padded).
    for (const result of results) {
      const prefix = String(result.counter).padStart(4, "0");
      expect(result.filename.startsWith(prefix + "-")).toBe(true);
    }

    // 7. No partial writes — every file has well-formed content (starts with "# ").
    for (const result of results) {
      const content = readFileSync(result.filepath, "utf8");
      expect(content.startsWith("# ")).toBe(true);
      expect(content).toContain("## Status");
      expect(content).toContain("## Context");
      expect(content).toContain("## Decision");
      expect(content).toContain("## Consequences");
    }
  }, 30_000);
});
