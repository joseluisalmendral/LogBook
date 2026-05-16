/**
 * Integration test: `logbook export html` with missing docs (T12).
 *
 * Verifies that running `logbook export html` on a project that has NOT
 * run `logbook build` first exits with code 1 and prints a helpful error
 * suggesting the user run `logbook build`.
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
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`
      );
    }
  }
}, 90_000);

function makeTmpProjectNoBuild(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-export-missing-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" })
  );

  fs.writeFileSync(
    path.join(dir, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [] }, null, 2) + "\n"
  );

  // No logbook/docs/ directory — simulates a project that never ran `logbook build`
  return dir;
}

function runCli(
  args: string[],
  cwd: string
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 30_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("export-missing-docs", () => {
  it("exits with code 1 when logbook/docs/ is missing", () => {
    const dir = makeTmpProjectNoBuild();
    const { code } = runCli(["export", "html"], dir);
    expect(code).toBe(1);
  });

  it("prints an error message suggesting logbook build", () => {
    const dir = makeTmpProjectNoBuild();
    const { stderr, stdout } = runCli(["export", "html"], dir);
    const combined = stderr + stdout;
    // Should mention "build" in the error message
    expect(combined.toLowerCase()).toContain("build");
  });

  it("does NOT create logbook/exports/index.html when build is missing", () => {
    const dir = makeTmpProjectNoBuild();
    runCli(["export", "html"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    expect(fs.existsSync(htmlPath)).toBe(false);
  });
});
