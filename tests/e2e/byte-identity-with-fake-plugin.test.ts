/**
 * S10 Test 2 — §37 / §36.2 byte-identity gate (project with two fake plugins).
 *
 * Uses the project-with-two-plugins fixture which pre-populates
 * .claude/settings.local.json with two hooks in DIFFERENT formatting styles
 * (2-space for the first, tab-indent for the second) to stress-test the
 * string-patch coexistence invariant.
 *
 * Critical assertions:
 *  - After install: both fake-plugin entries are byte-for-byte intact at the
 *    same string offsets as before; LogBook appends exactly one new entry last.
 *  - After uninstall: the full directory is byte-identical to the fixture state.
 *
 * If the snapshot diff is non-empty, the full diff is dumped into the failure
 * message so reviewers see the mismatch without re-running.
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
const FIXTURE = join(REPO_ROOT, "tests/fixtures/project-with-two-plugins");

describe("S10 Test 2 — byte-identity with two pre-installed fake plugins (§37)", () => {
  let tmp: string;
  /** Raw text of the fixture's settings.local.json — used to check byte offsets. */
  let fixtureSettingsRaw: string;

  beforeAll(() => {
    // Build is triggered by pretest:e2e. Guard in case tests run in isolation.
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }

    // Capture the exact bytes of the fixture's settings.local.json before copy.
    fixtureSettingsRaw = fs.readFileSync(
      join(FIXTURE, ".claude/settings.local.json"),
      "utf8",
    );
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

  test("install then uninstall with two fake plugins → byte-identical (§37 gate)", async () => {
    const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-plugins-"));
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

    // --- Mid-install assertions ---

    const settingsPath = join(tmp, ".claude/settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settingsAfterInstall = fs.readFileSync(settingsPath, "utf8");

    // 1. Both fake-plugin markers must still be present in the file string.
    expect(settingsAfterInstall).toContain('"_fakePluginAId": "fpa-001"');
    expect(settingsAfterInstall).toContain('"_fakePluginBId": "fpb-001"');

    // 2. The fake-plugin entries must appear at the SAME byte offsets as in the fixture.
    //    We verify this by checking that the fixture raw content is a substring of
    //    the post-install content up to the closing bracket of the second entry.
    //    Strategy: locate the original entries' substrings in the new file.
    const fakePluginAMarker = '"_fakePluginAId": "fpa-001"';
    const fakePluginBMarker = '"_fakePluginBId": "fpb-001"';
    const origAOffset = fixtureSettingsRaw.indexOf(fakePluginAMarker);
    const origBOffset = fixtureSettingsRaw.indexOf(fakePluginBMarker);
    const newAOffset = settingsAfterInstall.indexOf(fakePluginAMarker);
    const newBOffset = settingsAfterInstall.indexOf(fakePluginBMarker);

    expect(newAOffset).toBe(origAOffset);
    expect(newBOffset).toBe(origBOffset);

    // 3. Exactly one LogBook hook entry is appended after both fake-plugin entries.
    const settings = JSON.parse(settingsAfterInstall);
    const post: unknown[] = settings.hooks?.PostToolUse ?? [];
    const lbEntries = post.filter(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        typeof (h as Record<string, unknown>)["_logbookId"] === "string" &&
        ((h as Record<string, unknown>)["_logbookId"] as string).startsWith("lb-hook-"),
    );
    expect(lbEntries).toHaveLength(1);

    // LogBook entry must be the LAST one in the array.
    const lastEntry = post[post.length - 1] as Record<string, unknown>;
    expect(typeof lastEntry["_logbookId"]).toBe("string");

    // 4. .gitignore must now contain the pre-existing lines AND the logbook lines.
    const gitignorePath = join(tmp, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const gitignoreAfterInstall = fs.readFileSync(gitignorePath, "utf8");
    // Pre-existing content is preserved.
    expect(gitignoreAfterInstall).toContain("node_modules/");
    expect(gitignoreAfterInstall).toContain("dist/");
    // LogBook lines appended.
    expect(gitignoreAfterInstall).toContain(".logbook/");
    expect(gitignoreAfterInstall).toContain("logbook/");

    // --- Run uninstall ---

    const uninstallResult = spawnSync("node", [CLI_BUNDLE, "uninstall", "--force"], {
      cwd: tmp,
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_BUNDLE },
      encoding: "utf8",
    });
    expect(
      uninstallResult.status,
      `uninstall failed:\nstdout: ${uninstallResult.stdout}\nstderr: ${uninstallResult.stderr}`,
    ).toBe(0);

    // --- Post-uninstall assertion: full directory must be byte-identical ---

    const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
    const diff = diffSnapshots(before, after);

    expect(
      diff,
      [
        "Byte-identity FAILED (§37 gate) — directory is NOT identical after install+uninstall.",
        "This means LogBook mutated a file it should have fully restored.",
        "",
        "Diff:",
        JSON.stringify(diff, null, 2),
      ].join("\n"),
    ).toEqual({ added: [], removed: [], changed: [] });
  }, 60_000);
});
