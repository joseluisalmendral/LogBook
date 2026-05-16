/**
 * T13 — ITER3 GATE: Skill-specific byte-identity lifecycle.
 *
 * Verifies the SkillInstaller handles the full parent-dir create + cleanup cycle
 * correctly when the project has NO pre-existing .claude/skills/ directory.
 *
 * Setup:
 *   - Tmp project WITHOUT .claude/skills/ dir.
 *   - Run `init --preset standard --yes`.
 *   - Assert: .claude/skills/logbook-auto-capture/SKILL.md exists.
 *   - Assert: .claude/skills/logbook-auto-capture/reference.md exists.
 *   - Run `uninstall --force`.
 *   - Assert: both files gone.
 *   - Assert: .claude/skills/logbook-auto-capture/ dir gone (we created it).
 *   - Assert: .claude/skills/ dir gone (we created it).
 *   - Assert: snapshot byte-identical (THE GATE).
 */

import { describe, test, expect, beforeAll } from "vitest";
import { mkdtempSync, existsSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "pathe";
import { spawnSync } from "node:child_process";
import { snapshotDir, diffSnapshots } from "../helpers/snapshot.js";

const REPO_ROOT = resolve(__dirname, "../..");
const CLI_BUNDLE = join(REPO_ROOT, "dist/cli/index.cjs");
const HOOK_BUNDLE = join(REPO_ROOT, "dist/connectors/claude-code/hook.cjs");
const MCP_BUNDLE = join(REPO_ROOT, "dist/mcp/server.cjs");

const SNAPSHOT_IGNORE = [".git", "node_modules", ".logbook", "logbook"];

describe("T13 — byte-identity Skill lifecycle (ITER3 GATE)", () => {
  beforeAll(() => {
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE) || !existsSync(MCP_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }
  });

  test(
    "Skill install+uninstall on project with NO .claude/skills/ → byte-identical",
    async () => {
      // Setup: create a fresh tmp project without .claude/skills/
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-skill-"));
      const tmp = realpathSync(tmpRaw);

      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "test-skill-lifecycle", version: "0.0.0" }, null, 2) + "\n",
      );
      // Create .claude/ dir but NOT .claude/skills/
      mkdirSync(join(tmp, ".claude"), { recursive: true });

      // Snapshot BEFORE install (no .claude/skills/ at all)
      const before = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });

      // Confirm .claude/skills/ does NOT exist before install
      expect(existsSync(join(tmp, ".claude", "skills")), ".claude/skills/ should NOT exist before install").toBe(false);

      // Install
      const installResult = spawnSync(
        "node",
        [CLI_BUNDLE, "init", "--preset", "standard", "--yes"],
        {
          cwd: tmp,
          env: {
            ...process.env,
            LOGBOOK_HOOK_PATH: HOOK_BUNDLE,
            LOGBOOK_MCP_SERVER_PATH: MCP_BUNDLE,
          },
          encoding: "utf8",
        },
      );
      expect(
        installResult.status,
        `init failed:\nstdout: ${installResult.stdout}\nstderr: ${installResult.stderr}`,
      ).toBe(0);

      // Mid-install: Skill files must exist
      const skillDir = join(tmp, ".claude", "skills", "logbook-auto-capture");
      expect(existsSync(join(skillDir, "SKILL.md")), "SKILL.md should be installed").toBe(true);
      expect(existsSync(join(skillDir, "reference.md")), "reference.md should be installed").toBe(true);

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
          },
          encoding: "utf8",
        },
      );
      expect(
        uninstallResult.status,
        `uninstall failed:\nstdout: ${uninstallResult.stdout}\nstderr: ${uninstallResult.stderr}`,
      ).toBe(0);

      // Post-uninstall: Skill files must be gone
      expect(existsSync(join(skillDir, "SKILL.md")), "SKILL.md should be removed").toBe(false);
      expect(existsSync(join(skillDir, "reference.md")), "reference.md should be removed").toBe(false);

      // Parent dirs must be cleaned up (we created them)
      expect(existsSync(skillDir), ".claude/skills/logbook-auto-capture/ should be removed").toBe(false);
      expect(existsSync(join(tmp, ".claude", "skills")), ".claude/skills/ should be removed").toBe(false);

      // THE GATE: byte-identical snapshot
      const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
      const diff = diffSnapshots(before, after);

      expect(
        diff,
        [
          "ITER3 SKILL GATE FAILED — directory is NOT byte-identical after install+uninstall.",
          "Skill lifecycle left traces that should have been cleaned up.",
          "",
          "Diff detail (check 'changed' for modified files, 'added'/'removed' for extra/missing):",
          JSON.stringify(diff, null, 2),
        ].join("\n"),
      ).toEqual({ added: [], removed: [], changed: [] });
    },
    120_000,
  );

  test(
    "Second Skill install after uninstall reproduces same bytes",
    async () => {
      // Setup: project without .claude/skills/
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-skill2-"));
      const tmp = realpathSync(tmpRaw);
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "test-skill-idempotent", version: "0.0.0" }, null, 2) + "\n",
      );
      mkdirSync(join(tmp, ".claude"), { recursive: true });

      const runCli = (args: string[]) =>
        spawnSync("node", [CLI_BUNDLE, ...args], {
          cwd: tmp,
          env: {
            ...process.env,
            LOGBOOK_HOOK_PATH: HOOK_BUNDLE,
            LOGBOOK_MCP_SERVER_PATH: MCP_BUNDLE,
          },
          encoding: "utf8",
        });

      // First install + snapshot mid-install
      expect(runCli(["init", "--preset", "standard", "--yes"]).status).toBe(0);
      const skillPath = join(tmp, ".claude", "skills", "logbook-auto-capture", "SKILL.md");
      const { readFileSync } = await import("node:fs");
      const firstInstallContent = readFileSync(skillPath, "utf8");

      // Uninstall
      expect(runCli(["uninstall", "--force"]).status).toBe(0);

      // Second install
      expect(runCli(["init", "--preset", "standard", "--yes"]).status).toBe(0);
      const secondInstallContent = readFileSync(skillPath, "utf8");

      // Same bytes both times
      expect(secondInstallContent).toBe(firstInstallContent);

      // Cleanup
      expect(runCli(["uninstall", "--force"]).status).toBe(0);
    },
    120_000,
  );
});
