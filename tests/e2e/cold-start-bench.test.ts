import { describe, test, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const HOOK_PATH = resolve(process.cwd(), "dist/connectors/claude-code/hook.cjs");

describe("S4 cold-start gate (Darwin 25 ARM target)", () => {
  beforeAll(() => {
    if (!existsSync(HOOK_PATH)) {
      execFileSync("pnpm", ["build"], { stdio: "inherit" });
    }
    if (!existsSync(HOOK_PATH)) {
      throw new Error("hook bundle missing after pnpm build");
    }
  });

  test(
    "p95 < 200ms across 100 cold spawns",
    () => {
      const N = 100;
      const times: number[] = [];
      const payload = Buffer.from('{"hook":"PostToolUse"}\n');
      for (let i = 0; i < N; i++) {
        const t0 = process.hrtime.bigint();
        const res = spawnSync("node", [HOOK_PATH], {
          input: payload,
          timeout: 5000,
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
        `cold-start: median=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms`,
      );
      expect(
        p95,
        `p95 budget breach — median=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms`,
      ).toBeLessThan(200);
    },
    120_000,
  ); // 2-minute test timeout
});
