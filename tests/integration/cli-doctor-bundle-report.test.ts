/**
 * Integration tests for SG-C: doctor command bundle output.
 *
 * Verifies that `logbook doctor` prints a Bundles section,
 * `logbook doctor --json` includes structured bundle entries,
 * and exit code is always 0 (diagnostic, not a gate).
 *
 * These tests run against the BUILT CLI (dist/cli/index.cjs).
 * beforeAll ensures a build exists, same pattern as other integration tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(PROJECT_ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(PROJECT_ROOT, "dist/connectors/claude-code/hook.cjs");

function runCli(
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
      ...extraEnv,
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

let tmp: string;

beforeAll(() => {
  // Ensure CLI is built
  if (!fs.existsSync(CLI)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 120_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\n${result.stderr?.toString()}`,
      );
    }
  }

  // Create a minimal project with logbook installed
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-sgc-"));
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
  );
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

  // Run logbook init to install
  const initResult = runCli(["init", "--preset", "minimal", "--yes"], tmp);
  if (initResult.code !== 0) {
    throw new Error(`logbook init failed:\n${initResult.stdout}\n${initResult.stderr}`);
  }
}, 150_000);

afterAll(() => {
  if (tmp && fs.existsSync(tmp)) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

describe("doctor command — bundle output", () => {
  it("doctor command includes a Bundles section in human output", () => {
    const { stdout, code } = runCli(["doctor"], tmp, { NO_COLOR: "1" });
    expect(code).toBe(0);
    expect(stdout).toMatch(/[Bb]undles/);
  });

  it("doctor exits 0 even when dist bundles are not present (not_built state)", () => {
    // dist/ doesn't exist relative to tmp, so all bundles report not_built
    const { code } = runCli(["doctor"], tmp, { NO_COLOR: "1" });
    expect(code).toBe(0);
  });

  it("doctor --json includes a bundles array", () => {
    const { stdout, code } = runCli(["doctor", "--json"], tmp);
    expect(code).toBe(0);
    const json = JSON.parse(stdout) as Record<string, unknown>;
    expect(json).toHaveProperty("bundles");
    expect(Array.isArray(json["bundles"])).toBe(true);
  });

  it("doctor --json bundles array has 5 entries", () => {
    const { stdout } = runCli(["doctor", "--json"], tmp);
    const json = JSON.parse(stdout) as { bundles: unknown[] };
    expect(json.bundles).toHaveLength(5);
  });

  it("doctor --json each bundle entry has required fields", () => {
    const { stdout } = runCli(["doctor", "--json"], tmp);
    type BundleEntry = {
      name: string;
      path: string;
      capKb: number;
      softKb: number;
      status: string;
    };
    const json = JSON.parse(stdout) as { bundles: BundleEntry[] };
    for (const entry of json.bundles) {
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("capKb");
      expect(entry).toHaveProperty("softKb");
      expect(entry).toHaveProperty("status");
      expect(["ok", "warn", "fail", "not_built"]).toContain(entry.status);
    }
  });

  it("doctor handles missing dist/ directory gracefully (no crash, exit 0)", () => {
    // tmp has no dist/ directory, so all bundles are not_built
    const { code, stderr } = runCli(["doctor"], tmp, { NO_COLOR: "1" });
    expect(code).toBe(0);
    // no unhandled error output
    expect(stderr).not.toMatch(/TypeError|ReferenceError|ENOENT.*unhandled/i);
  });
});
