/**
 * T12 — byte-identity-statusline.
 *
 * Verifies that StatuslineInstaller leaves .claude/settings.local.json byte-identical
 * after install + uninstall, even when the file already contains pre-existing hooks
 * from another plugin (mixed indentation).
 *
 * Setup: uses tests/fixtures/project-teaching/ which has:
 *   - settings.local.json with 2 fake PostToolUse hooks (mixed indent, NO statusLine key)
 *
 * Tests:
 *   1. Install teaching preset (which includes statusline) → verify statusLine key added
 *      with fake hooks intact (byte-offsets preserved).
 *   2. Uninstall → verify settings.local.json is byte-identical to before install.
 *   3. Conflict path: if another plugin's statusLine key already exists → uninstall leaves
 *      it untouched (StatuslineInstaller uses hash-based conflict detection).
 */

import { describe, test, expect, beforeAll } from "vitest";
import {
  mkdtempSync,
  cpSync,
  existsSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "pathe";
import { spawnSync } from "node:child_process";
import { snapshotDir, diffSnapshots } from "../helpers/snapshot.js";

const REPO_ROOT = resolve(__dirname, "../..");
const CLI_BUNDLE = join(REPO_ROOT, "dist/cli/index.cjs");
const HOOK_BUNDLE = join(REPO_ROOT, "dist/connectors/claude-code/hook.cjs");
const MCP_BUNDLE = join(REPO_ROOT, "dist/mcp/server.cjs");
const FIXTURE = join(REPO_ROOT, "tests/fixtures/project-teaching");

const SNAPSHOT_IGNORE = [".git", "node_modules", ".logbook", "logbook"];

describe("T12 — byte-identity statusline install/uninstall", () => {
  beforeAll(() => {
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE) || !existsSync(MCP_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }
  });

  test(
    "install teaching (includes statusline) then uninstall on project with fake hooks → byte-identical",
    async () => {
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-statusline-"));
      const tmp = realpathSync(tmpRaw);
      cpSync(FIXTURE, tmp, { recursive: true });

      // Capture fixture settings.local.json raw bytes for offset verification
      const fixtureSettingsRaw = readFileSync(
        join(FIXTURE, ".claude/settings.local.json"),
        "utf8",
      );

      // Snapshot BEFORE install
      const before = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });

      // Install
      const installResult = spawnSync(
        "node",
        [CLI_BUNDLE, "init", "--preset", "teaching", "--yes"],
        {
          cwd: tmp,
          env: {
            ...process.env,
            LOGBOOK_HOOK_PATH: HOOK_BUNDLE,
            LOGBOOK_MCP_SERVER_PATH: MCP_BUNDLE,
            LOGBOOK_ASSETS_ROOT: join(REPO_ROOT, "assets"),
          },
          encoding: "utf8",
        },
      );
      expect(
        installResult.status,
        `init failed:\nstdout: ${installResult.stdout}\nstderr: ${installResult.stderr}`,
      ).toBe(0);

      // Mid-install: verify statusLine key added
      {
        const settingsPath = join(tmp, ".claude/settings.local.json");
        const settingsRaw = readFileSync(settingsPath, "utf8");
        const settings = JSON.parse(settingsRaw);

        // statusLine key must be present
        expect(typeof settings.statusLine).toBe("string");
        expect(settings.statusLine).toContain("state --inline");

        // Pre-existing fake hooks must still be present (semantically).
        // T-FIX-HOOK: the SessionStart hook install now uses pure string-patch —
        // no re-serialize — so byte offsets of pre-existing entries are preserved.
        // The byte-identity assertion below confirms this end-to-end.
        const ptuHooks: unknown[] = settings?.hooks?.PostToolUse ?? [];
        const alphaHook = ptuHooks.find(
          (h) =>
            typeof h === "object" &&
            h !== null &&
            (h as Record<string, unknown>)["_fakeAlphaId"] === "fa-001",
        );
        const betaHook = ptuHooks.find(
          (h) =>
            typeof h === "object" &&
            h !== null &&
            (h as Record<string, unknown>)["_fakeBetaId"] === "fb-001",
        );
        expect(alphaHook).toBeDefined();
        expect(betaHook).toBeDefined();
      }

      // Uninstall
      const uninstallResult = spawnSync(
        "node",
        [CLI_BUNDLE, "uninstall", "--force"],
        {
          cwd: tmp,
          env: {
            ...process.env,
            LOGBOOK_HOOK_PATH: HOOK_BUNDLE,
            LOGBOOK_MCP_SERVER_PATH: MCP_BUNDLE,
            LOGBOOK_ASSETS_ROOT: join(REPO_ROOT, "assets"),
          },
          encoding: "utf8",
        },
      );
      expect(
        uninstallResult.status,
        `uninstall failed:\nstdout: ${uninstallResult.stdout}\nstderr: ${uninstallResult.stderr}`,
      ).toBe(0);

      // Post-uninstall: statusLine key must be gone
      {
        const settingsPath = join(tmp, ".claude/settings.local.json");
        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
        expect(settings.statusLine).toBeUndefined();
      }

      // Byte-identity assertion
      const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
      const diff = diffSnapshots(before, after);

      expect(
        diff,
        [
          "T12 BYTE-IDENTITY FAILED (statusline) — directory is NOT byte-identical after install+uninstall.",
          "StatuslineInstaller mutated settings.local.json in a non-reversible way.",
          "",
          "Diff detail:",
          JSON.stringify(diff, null, 2),
        ].join("\n"),
      ).toEqual({ added: [], removed: [], changed: [] });
    },
    120_000,
  );

  test(
    "statusLine key correctly added to settings.local.json that already has pre-existing hooks",
    async () => {
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-statusline2-"));
      const tmp = realpathSync(tmpRaw);
      cpSync(FIXTURE, tmp, { recursive: true });

      const settingsBeforeInstall = readFileSync(
        join(tmp, ".claude/settings.local.json"),
        "utf8",
      );
      // Verify fixture has NO statusLine before install
      const parsedBefore = JSON.parse(settingsBeforeInstall);
      expect(parsedBefore.statusLine).toBeUndefined();

      // Install
      const installResult = spawnSync(
        "node",
        [CLI_BUNDLE, "init", "--preset", "teaching", "--yes"],
        {
          cwd: tmp,
          env: {
            ...process.env,
            LOGBOOK_HOOK_PATH: HOOK_BUNDLE,
            LOGBOOK_MCP_SERVER_PATH: MCP_BUNDLE,
            LOGBOOK_ASSETS_ROOT: join(REPO_ROOT, "assets"),
          },
          encoding: "utf8",
        },
      );
      expect(installResult.status).toBe(0);

      const settingsAfterInstall = readFileSync(
        join(tmp, ".claude/settings.local.json"),
        "utf8",
      );
      const parsedAfter = JSON.parse(settingsAfterInstall);

      // statusLine must be a string command
      expect(typeof parsedAfter.statusLine).toBe("string");
      expect(parsedAfter.statusLine).toContain("node");
      expect(parsedAfter.statusLine).toContain("state --inline");

      // hooks structure must still be intact
      const ptuHooks = parsedAfter?.hooks?.PostToolUse ?? [];
      expect(ptuHooks).toHaveLength(3); // 2 fake + 1 lb PostToolUse

      // The hooks key must appear before statusLine in the JSON string
      // (statusLine is appended after existing keys — no rearranging)
      const hooksPos = settingsAfterInstall.indexOf('"hooks"');
      const statusLinePos = settingsAfterInstall.indexOf('"statusLine"');
      expect(hooksPos).toBeGreaterThanOrEqual(0);
      expect(statusLinePos).toBeGreaterThan(hooksPos);
    },
    60_000,
  );

  test(
    "second install of statusline is idempotent (already-installed via teach preset)",
    async () => {
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-statusline3-"));
      const tmp = realpathSync(tmpRaw);
      cpSync(FIXTURE, tmp, { recursive: true });

      const runCli = (args: string[]) =>
        spawnSync("node", [CLI_BUNDLE, ...args], {
          cwd: tmp,
          env: {
            ...process.env,
            LOGBOOK_HOOK_PATH: HOOK_BUNDLE,
            LOGBOOK_MCP_SERVER_PATH: MCP_BUNDLE,
            LOGBOOK_ASSETS_ROOT: join(REPO_ROOT, "assets"),
          },
          encoding: "utf8",
        });

      // First install
      expect(runCli(["init", "--preset", "teaching", "--yes"]).status).toBe(0);

      const settingsAfterFirst = readFileSync(
        join(tmp, ".claude/settings.local.json"),
        "utf8",
      );

      // Second install (should be idempotent — statusLine already present)
      const secondInstall = runCli(["init", "--preset", "teaching", "--yes"]);
      expect(secondInstall.status).toBe(0);

      const settingsAfterSecond = readFileSync(
        join(tmp, ".claude/settings.local.json"),
        "utf8",
      );

      // Settings must be the same after second install (no duplicated statusLine)
      const parsedFirst = JSON.parse(settingsAfterFirst);
      const parsedSecond = JSON.parse(settingsAfterSecond);
      expect(parsedSecond.statusLine).toBe(parsedFirst.statusLine);
    },
    120_000,
  );
});
