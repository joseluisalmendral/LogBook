/**
 * Test 3 — Ingest p95 performance gate (full pipeline)
 *
 * Runs the hook bundle with the FULL pipeline (redact + normalize + ingest +
 * appendJsonl) 100 times and asserts p95 < 200ms.
 *
 * This is the iter1 acceptance test #3.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ROOT = path.resolve(__dirname, "../../");
const HOOK_PATH = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = HOOK_PATH;
const FIXTURE = path.join(ROOT, "tests/fixtures/claude-hook-payloads/user-message.json");

describe("Test 3 — ingest p95 gate (full pipeline)", () => {
  let tmp: string;

  beforeAll(() => {
    // Build if needed (pretest:e2e normally handles this, but guard here too)
    if (!fs.existsSync(HOOK_PATH)) {
      execFileSync("pnpm", ["build"], { stdio: "inherit", cwd: ROOT });
    }
    if (!fs.existsSync(HOOK_PATH)) {
      throw new Error("hook bundle missing after pnpm build");
    }

    // Setup: temp project with logbook initialized
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-ingest-p95-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const init = spawnSync("node", [CLI, "init", "--preset", "minimal", "--yes"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    if ((init.status ?? 1) !== 0) {
      throw new Error(`init failed: ${init.stderr}`);
    }
  });

  test(
    "p95 < 200ms across 100 spawns of hook.cjs (full ingest pipeline)",
    () => {
      const N = 100;
      const times: number[] = [];
      const payload = fs.readFileSync(FIXTURE);

      for (let i = 0; i < N; i++) {
        const t0 = process.hrtime.bigint();
        const res = spawnSync("node", [HOOK_PATH], {
          input: payload,
          cwd: tmp,
          timeout: 10_000,
          env: { ...process.env },
        });
        const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
        if (res.status !== 0) {
          throw new Error(
            `hook exited non-zero at run ${i}: ${res.stderr.toString()}`,
          );
        }
        times.push(elapsedMs);
      }

      times.sort((a, b) => a - b);
      const p50 = times[Math.floor(0.5 * N)]!;
      const p95 = times[Math.floor(0.95 * N)]!;
      const p99 = times[Math.floor(0.99 * N)]!;

      console.log(
        `ingest-p95 (full pipeline): median=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms`,
      );

      expect(
        p95,
        `p95 budget breach — full pipeline: median=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms`,
      ).toBeLessThan(200);
    },
    120_000, // 2-minute timeout
  );
});
