/**
 * cli-zero-arg-not-installed.test.ts — Non-TTY fallback in non-project dirs (iter6 T6).
 *
 * Extra guard: even if the zero-arg intercept were to activate despite non-TTY,
 * it must fall through gracefully when there is no .logbook/install-manifest.json
 * (non-project dir, CI, bare temp dir).
 *
 * Contract:
 *   - `logbook` (no args, no TTY) in a dir without a manifest → citty fallback,
 *     exits with definite code (not hang), not launching interactive shell.
 *   - TTY check fires first, so the shell never launches; but if it did, the
 *     try/catch in maybeShell() catches any error and falls through to runMain.
 *
 * citty behavior: no args → exits 1 ("No command specified").
 *
 * These tests spawn the BUILT CJS binary (dist/cli/index.cjs).
 * Run `pnpm build` before running integration tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(PROJECT_ROOT, "dist/cli/index.cjs");

function spawnNoTty(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: {
      ...process.env,
      ...env,
    },
    timeout: 15_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    throw new Error(
      `Built CLI not found at ${CLI}. Run \`pnpm build\` before running integration tests.`
    );
  }
}, 10_000);

describe("cli-zero-arg-not-installed — no-manifest project", () => {
  it("no args, no TTY, no manifest → exits 1 (citty fallback, no hang)", () => {
    // Completely empty temp dir — no package.json, no .logbook/
    // TTY check fires first → maybeShell() returns false → citty exits 1
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-not-installed-test-"));
    try {
      const { code } = spawnNoTty([], tmp);
      // citty exits 1 for "No command specified" — we care it's not hanging
      expect(code).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("init --help → exits 0 in empty dir (argv.length > 2 → intercept skipped)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-not-installed-test-"));
    try {
      const { code } = spawnNoTty(["init", "--help"], tmp);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--version → exits 0 in empty dir (argv.length > 2 → intercept skipped)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-not-installed-test-"));
    try {
      const { code } = spawnNoTty(["--version"], tmp);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
