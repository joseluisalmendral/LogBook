/**
 * S10 Test 1 — §36.1 byte-identity gate (clean project).
 *
 * Copies the empty-project fixture into a temp dir, runs `logbook init`,
 * checks the mid-install state, then runs `logbook uninstall --force` and
 * asserts the directory is byte-identical to its initial snapshot.
 *
 * If the snapshot diff is non-empty, the full diff is included in the failure
 * message so reviewers can see the byte-level mismatch without re-running.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { mkdtempSync, cpSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "pathe";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { snapshotDir, diffSnapshots } from "../helpers/snapshot.js";

const REPO_ROOT = resolve(__dirname, "../..");
const CLI_BUNDLE = join(REPO_ROOT, "dist/cli/index.cjs");
const HOOK_BUNDLE = join(REPO_ROOT, "dist/connectors/claude-code/hook.cjs");
const FIXTURE = join(REPO_ROOT, "tests/fixtures/empty-project");

describe("S10 Test 1 — byte-identity clean install/uninstall", () => {
  let tmp: string;

  beforeAll(() => {
    // Build is triggered by pretest:e2e. Guard in case tests run in isolation.
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }
  });

  afterAll(() => {
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // OS tmp cleanup is a best-effort operation.
      }
    }
  });

  test("install then uninstall on empty project → byte-identical", async () => {
    const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-clean-"));
    tmp = realpathSync(tmpRaw);

    // Copy fixture into the temp directory.
    cpSync(FIXTURE, tmp, { recursive: true });

    // Snapshot BEFORE install.
    // Exclude .logbook/ and logbook/ — these are data directories that are
    // intentionally preserved by `logbook uninstall` per spec §24/§908.
    // The byte-identity guarantee is for SHARED CONFIG FILES only
    // (.claude/settings.local.json, .gitignore, CLAUDE.md, etc.).
    const SNAPSHOT_IGNORE = [".git", "node_modules", ".logbook", "logbook"];
    const before = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });

    // Run install.
    const installResult = spawnSync("node", [CLI_BUNDLE, "init", "--preset", "minimal", "--yes"], {
      cwd: tmp,
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_BUNDLE },
      encoding: "utf8",
    });
    expect(
      installResult.status,
      `init failed:\nstdout: ${installResult.stdout}\nstderr: ${installResult.stderr}`,
    ).toBe(0);

    // Mid-install assertion: settings.local.json has exactly 1 hook with our id.
    const settingsPath = join(tmp, ".claude/settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const post: unknown[] = settings.hooks?.PostToolUse ?? [];
    const lbEntries = post.filter(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        typeof (h as Record<string, unknown>)["_logbookId"] === "string" &&
        ((h as Record<string, unknown>)["_logbookId"] as string).startsWith("lb-hook-"),
    );
    expect(lbEntries).toHaveLength(1);

    // Run uninstall.
    const uninstallResult = spawnSync("node", [CLI_BUNDLE, "uninstall", "--force"], {
      cwd: tmp,
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_BUNDLE },
      encoding: "utf8",
    });
    expect(
      uninstallResult.status,
      `uninstall failed:\nstdout: ${uninstallResult.stdout}\nstderr: ${uninstallResult.stderr}`,
    ).toBe(0);

    // Snapshot AFTER uninstall — must be identical to before.
    const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
    const diff = diffSnapshots(before, after);

    expect(
      diff,
      `Byte-identity FAILED — directory is NOT identical after install+uninstall:\n${JSON.stringify(diff, null, 2)}`,
    ).toEqual({ added: [], removed: [], changed: [] });
  }, 60_000);
});
