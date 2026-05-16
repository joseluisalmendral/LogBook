/**
 * T12 — byte-identity-subagent.
 *
 * Verifies the SubagentInstaller byte-identity contract through the full CLI pipeline:
 * install --preset teaching then uninstall --force → byte-identical to before.
 *
 * Coverage decision (per T12 spec):
 *   The unit test subagent-installer.test.ts (T2) already covers the owned_file
 *   lifecycle at the installer level via runInstall/runUninstall engine calls.
 *   The integration test subagent-via-engine.test.ts (T2) covers the engine roundtrip.
 *   This E2E test covers the CLI-level path (spawnSync via dist/cli/index.cjs) to
 *   ensure the full stack (CLI → init.ts → engine → SubagentInstaller) is verified.
 *
 * Setup: project WITH a pre-existing .claude/subagents/fake-other.md from another plugin.
 *   This is the key coexistence invariant: the pre-existing subagent must be UNCHANGED
 *   after LogBook installs and uninstalls its own subagents.
 *
 * Byte-identity contract:
 *   After teaching install + uninstall, the directory must be byte-identical to before.
 *   In particular, .claude/subagents/fake-other.md must be untouched.
 *   LogBook's own subagent files must be fully removed.
 *   The .claude/subagents/ dir must NOT be removed (it existed before install with fake-other.md).
 */

import { describe, test, expect, beforeAll } from "vitest";
import {
  mkdtempSync,
  cpSync,
  existsSync,
  realpathSync,
  readFileSync,
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

describe("T12 — byte-identity subagent install/uninstall (CLI-level)", () => {
  beforeAll(() => {
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE) || !existsSync(MCP_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }
  });

  test(
    "install teaching (includes 2 subagents) then uninstall → byte-identical, pre-existing subagent untouched",
    async () => {
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-subagent-"));
      const tmp = realpathSync(tmpRaw);

      // Copy fixture: includes .claude/subagents/fake-other.md pre-installed
      cpSync(FIXTURE, tmp, { recursive: true });

      // Confirm pre-existing subagent is in place
      const fakeOtherPath = join(tmp, ".claude/subagents/fake-other.md");
      expect(existsSync(fakeOtherPath), "Pre-existing fake-other.md must exist in fixture").toBe(
        true,
      );
      const fakeOtherContentBefore = readFileSync(fakeOtherPath, "utf8");

      // Snapshot BEFORE install
      const before = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });

      // Install teaching preset (includes logbook-curator + logbook-teacher subagents)
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

      // Mid-install assertions
      {
        const subagentsDir = join(tmp, ".claude/subagents");

        // LogBook subagents installed
        expect(existsSync(join(subagentsDir, "logbook-curator.md")), "curator must be installed").toBe(
          true,
        );
        expect(existsSync(join(subagentsDir, "logbook-teacher.md")), "teacher must be installed").toBe(
          true,
        );

        // Pre-existing fake-other.md is UNCHANGED (same content)
        const fakeOtherContentMid = readFileSync(fakeOtherPath, "utf8");
        expect(fakeOtherContentMid).toBe(fakeOtherContentBefore);
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

      // Post-uninstall: LogBook subagents must be gone
      expect(
        existsSync(join(tmp, ".claude/subagents/logbook-curator.md")),
        "logbook-curator.md must be removed",
      ).toBe(false);
      expect(
        existsSync(join(tmp, ".claude/subagents/logbook-teacher.md")),
        "logbook-teacher.md must be removed",
      ).toBe(false);

      // Pre-existing subagent must still be there (we don't own it)
      expect(existsSync(fakeOtherPath), "fake-other.md must survive uninstall").toBe(true);
      const fakeOtherContentAfter = readFileSync(fakeOtherPath, "utf8");
      expect(fakeOtherContentAfter).toBe(fakeOtherContentBefore);

      // .claude/subagents/ dir must still exist (it had fake-other.md before we arrived)
      expect(
        existsSync(join(tmp, ".claude/subagents")),
        ".claude/subagents/ dir must remain (not empty before install — has fake-other.md)",
      ).toBe(true);

      // Byte-identity assertion (THE GATE)
      const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
      const diff = diffSnapshots(before, after);

      expect(
        diff,
        [
          "T12 BYTE-IDENTITY FAILED (subagent) — directory is NOT byte-identical after install+uninstall.",
          "SubagentInstaller left traces or corrupted pre-existing files.",
          "",
          "Diff detail:",
          JSON.stringify(diff, null, 2),
        ].join("\n"),
      ).toEqual({ added: [], removed: [], changed: [] });
    },
    120_000,
  );

  test(
    "subagent install on project WITHOUT pre-existing .claude/subagents/ → dir created then fully removed",
    async () => {
      // This is the no-coexistence case: .claude/subagents/ does NOT exist before install.
      // After uninstall, the dir must be gone (we created it, it's empty).
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-subagent2-"));
      const tmp = realpathSync(tmpRaw);

      // Copy project-standard fixture (no subagents dir)
      const STANDARD_FIXTURE = join(REPO_ROOT, "tests/fixtures/project-standard");
      cpSync(STANDARD_FIXTURE, tmp, { recursive: true });

      // Confirm subagents dir does NOT exist before install
      expect(
        existsSync(join(tmp, ".claude/subagents")),
        ".claude/subagents/ must NOT exist in project-standard fixture",
      ).toBe(false);

      const before = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });

      // Install teaching preset (standard fixture has no .claude/ at all — that's fine,
      // init will create .claude/ as part of the install)
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

      // Subagents dir must exist now
      expect(existsSync(join(tmp, ".claude/subagents")), ".claude/subagents/ must be created").toBe(
        true,
      );

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

      // .claude/subagents/ must be GONE (we created it, it's empty after uninstall)
      expect(
        existsSync(join(tmp, ".claude/subagents")),
        ".claude/subagents/ must be removed (we created it, now empty)",
      ).toBe(false);

      // Byte-identity assertion
      const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
      const diff = diffSnapshots(before, after);

      expect(
        diff,
        [
          "T12 BYTE-IDENTITY FAILED (subagent, no-preexisting-dir case) — directory is NOT identical.",
          "",
          "Diff detail:",
          JSON.stringify(diff, null, 2),
        ].join("\n"),
      ).toEqual({ added: [], removed: [], changed: [] });
    },
    120_000,
  );
});
