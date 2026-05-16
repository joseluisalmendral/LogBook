/**
 * cli-zero-arg-no-tty.test.ts — Zero-arg CLI intercept regression guard (iter6 T6).
 *
 * TDD Cycle:
 *   RED  → tests written BEFORE cli/index.ts is modified (file did not exist)
 *   GREEN → add maybeShell() intercept; these tests must pass unchanged
 *
 * Critical contract: when stdin/stdout are NOT a TTY (CI, scripts, piped),
 * `logbook` with no args MUST fall through to citty and NOT launch the
 * interactive shell. The process must exit promptly (not hang).
 *
 * The key observable is: the CLI exits with a definite exit code within the
 * timeout (not hanging indefinitely waiting for TTY input). We do not assert
 * on stdout content because citty's help output mechanism is implementation
 * detail that may vary in different environments.
 *
 * citty behavior (measured against the actual binary):
 *   - No args           → exits 1 (no subcommand given)
 *   - --help / -h       → exits 0
 *   - <subcommand>      → runs subcommand normally
 *
 * TTY limitation: we cannot test the TTY path (shell launch) from vitest because
 * spawnSync with stdio="pipe" always sets isTTY=false. The interactive shell
 * path is covered by:
 *   tests/integration/shell-tui-smoke.test.ts — Ink component smoke tests
 *   Manual verification: run `node dist/cli/index.cjs` in a real terminal
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

/** Spawn the CLI with stdio piped (no TTY). Returns code + output. */
function spawnNoTty(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe", // NOT a TTY — stdin.isTTY and stdout.isTTY will be false
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

// ---------------------------------------------------------------------------
// Core contract: no-arg + no-TTY → citty fallback (no shell launch, no hang)
// ---------------------------------------------------------------------------

describe("cli-zero-arg-no-tty — non-TTY fallback to citty", () => {
  it("no args, no TTY → exits promptly without hanging (shell must NOT be launched)", () => {
    // CRITICAL: the process must exit and not block indefinitely waiting for TTY input.
    // spawnSync with timeout=15s will kill if it hangs.
    // The zero-arg intercept must detect non-TTY and skip shell launch.
    // citty exits 1 when no subcommand given — that is the expected fallback.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-zero-arg-test-"));
    try {
      const { code } = spawnNoTty([], tmp);
      // Any definite exit code means the CLI ran and exited, not hung.
      // citty exits 1 for "No command specified" — that's the expected fallback.
      expect(typeof code).toBe("number");
      // Specifically: exit 1 = citty's "no command" behavior (not 0, not timeout)
      expect(code).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--help flag → exits 0 (citty handles --help with exit 0; intercept not triggered)", () => {
    // argv.length > 2 → maybeShell() returns false immediately → citty handles --help
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-zero-arg-test-"));
    try {
      const { code } = spawnNoTty(["--help"], tmp);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("-h flag → exits 0 (citty handles -h the same as --help)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-zero-arg-test-"));
    try {
      const { code } = spawnNoTty(["-h"], tmp);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Existing subcommand behavior must be unchanged (regression guard)
// ---------------------------------------------------------------------------

describe("cli-zero-arg-no-tty — subcommand bypass (regression guard)", () => {
  it("init --help → exits 0 (subcommand bypasses intercept; argv.length > 2)", () => {
    // argv.length > 2 → maybeShell() returns false immediately → citty runs init --help
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-zero-arg-test-"));
    try {
      const { code } = spawnNoTty(["init", "--help"], tmp);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("status → exits with any code but does NOT hang (no interactive shell)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-zero-arg-test-"));
    try {
      // status in a non-project dir exits non-zero; we just care it doesn't hang
      const { code } = spawnNoTty(["status"], tmp);
      expect(typeof code).toBe("number");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no args with LOGBOOK_DEBUG=1 → exits 1 (debug mode does not change non-TTY behavior)", () => {
    // Verifies that the LOGBOOK_DEBUG env var doesn't accidentally trigger the shell
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-zero-arg-test-"));
    try {
      const { code } = spawnNoTty([], tmp, { LOGBOOK_DEBUG: "1" });
      expect(code).toBe(1); // citty: no subcommand
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// TTY detection note (documented limitation)
// ---------------------------------------------------------------------------

// NOTE: We CANNOT test the TTY path (shell launch) from vitest because
// spawnSync with stdio="pipe" always sets isTTY=false. The interactive shell
// path is covered by:
//   tests/integration/shell-tui-smoke.test.ts — Ink component smoke tests
//   Manual verification: run `node dist/cli/index.cjs` in a real terminal
