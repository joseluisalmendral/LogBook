/**
 * Integration test: `logbook providers test` CLI command (T7).
 *
 * Tests:
 *  1. With LOGBOOK_LLM_MOCK=1 → exit 0, output contains ok:true, text:"pong", latencyMs >= 0
 *  2. Real LLM E2E path (skipped unless LOGBOOK_E2E_REAL_LLM is set)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(PROJECT_ROOT, "dist", "cli", "index.cjs");

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`,
      );
    }
  }
}, 90_000);

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-providers-test-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  return dir;
}

function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("cli-providers-test", () => {
  it("exits 0 and returns ok:true with LOGBOOK_LLM_MOCK=1", () => {
    const dir = makeTmpProject();

    const { code, stdout, stderr } = runCli(
      ["providers", "test", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["ok"]).toBe(true);
    expect(out["text"]).toBe("pong");
    expect(typeof out["provider"]).toBe("string");
    expect(typeof out["model"]).toBe("string");
    expect(typeof out["latencyMs"]).toBe("number");
    expect((out["latencyMs"] as number) >= 0).toBe(true);
    expect(typeof out["redactedFields"]).toBe("number");
  });

  it.skipIf(!process.env["LOGBOOK_E2E_REAL_LLM"])(
    "exits 0 with real LLM when LOGBOOK_E2E_REAL_LLM is set",
    () => {
      const dir = makeTmpProject();

      const { code, stdout } = runCli(["providers", "test", "--json"], dir);

      expect(code).toBe(0);
      const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
      expect(out["ok"]).toBe(true);
    },
  );
});
