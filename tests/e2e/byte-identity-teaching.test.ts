/**
 * T12 — ITER4 GATE: byte-identity teaching install/uninstall.
 *
 * THE TEACHING PRESET GATE. Uses tests/fixtures/project-teaching/ which has:
 *   - CLAUDE.md with user content + otherplugin block in <!-- otherplugin start --> markers
 *   - .claude/settings.local.json with 2 fake PostToolUse hooks (mixed indent), NO statusLine key
 *   - .claude/mcp.json with 1 fake plugin mcp server
 *   - .claude/commands/fake-plugin.md — pre-existing slash from another plugin
 *   - .claude/subagents/fake-other.md — pre-existing subagent from another plugin
 *   - .gitignore with node_modules/ + dist/
 *
 * Flow:
 *   1. Snapshot BEFORE install
 *   2. `init --preset teaching --yes` (all 18 manifest entries)
 *   3. Mid-install assertions (coexistence invariants for all 18 artifact kinds)
 *   4. `uninstall --force`
 *   5. Snapshot AFTER → byte-identical to BEFORE (THE GATE)
 *
 * If ANY diff is non-empty, the test reports BLOCKED with the full diff.
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

describe("T12 — ITER4 GATE: byte-identity teaching install/uninstall (THE TEACHING PRESET GATE)", () => {
  beforeAll(() => {
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE) || !existsSync(MCP_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }
  });

  test(
    "install --preset teaching then uninstall on project with 2 fake plugins → byte-identical (ITER4 GATE)",
    async () => {
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-teach-"));
      const tmp = realpathSync(tmpRaw);
      cpSync(FIXTURE, tmp, { recursive: true });

      // Capture fixture bytes for mid-install comparison assertions
      const fixtureClaudeMd = readFileSync(join(FIXTURE, "CLAUDE.md"), "utf8");
      const fixtureMcpRaw = readFileSync(join(FIXTURE, ".claude/mcp.json"), "utf8");
      const fakeOtherContent = readFileSync(
        join(FIXTURE, ".claude/subagents/fake-other.md"),
        "utf8",
      );
      const fakeSlashContent = readFileSync(
        join(FIXTURE, ".claude/commands/fake-plugin.md"),
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

      // Mid-install assertions: all 18 artifact kinds
      {
        // 1. Manifest has exactly 18 entries
        const manifest = JSON.parse(
          readFileSync(join(tmp, ".logbook/install-manifest.json"), "utf8"),
        ) as { artifacts: Array<{ id: string; kind: string; file_path: string }> };
        expect(manifest.artifacts).toHaveLength(18);

        // 2. settings.local.json: 2 fake hooks UNCHANGED (byte-for-byte) +
        //    1 lb-hook(PostToolUse) + 1 lb-hook(SessionStart) + statusLine appended
        //
        // T-FIX-HOOK: HookInstaller now uses pure string-patch for ALL cases (no
        // JSON.parse+JSON.stringify re-serialize). When installing the SessionStart
        // hook on a file that only has PostToolUse, the installer injects
        // "SessionStart": [] via setJsonObjectKey — byte-preserving — then appends
        // the entry. Pre-existing PostToolUse bytes are untouched.
        const settingsPath = join(tmp, ".claude/settings.local.json");
        const settingsRaw = readFileSync(settingsPath, "utf8");
        const settings = JSON.parse(settingsRaw);

        // Fake hooks must still be present (semantically)
        const fakeAlphaMarker = '"_fakeAlphaId": "fa-001"';
        const fakeBetaMarker = '"_fakeBetaId"';
        expect(settingsRaw).toContain(fakeAlphaMarker);
        expect(settingsRaw).toContain(fakeBetaMarker);

        // PostToolUse: 2 fake + 1 lb
        const ptuHooks: unknown[] = settings?.hooks?.PostToolUse ?? [];
        const lbPtuHooks = ptuHooks.filter(
          (h) =>
            typeof h === "object" &&
            h !== null &&
            typeof (h as Record<string, unknown>)["_logbookId"] === "string",
        );
        expect(lbPtuHooks).toHaveLength(1);
        expect(ptuHooks).toHaveLength(3);

        // SessionStart hook
        const ssHooks: unknown[] = settings?.hooks?.SessionStart ?? [];
        expect(ssHooks).toHaveLength(1);
        const lbSsHook = ssHooks[0] as Record<string, unknown>;
        expect(lbSsHook["_logbookId"]).toBe("lb-hook-sessionstart-001");

        // statusLine key present as Claude-Code-compliant object (fix 2026-05-21)
        expect(typeof settings.statusLine).toBe("object");
        expect((settings.statusLine as { command: string }).command).toContain(
          "state --inline",
        );

        // 3. mcp.json: fake-plugin entry UNCHANGED + logbook-mcp added
        const mcpPath = join(tmp, ".claude/mcp.json");
        const mcpRaw = readFileSync(mcpPath, "utf8");
        const mcp = JSON.parse(mcpRaw);
        const fakePluginMarker = '"fake-plugin"';
        expect(mcpRaw.indexOf(fakePluginMarker)).toBe(fixtureMcpRaw.indexOf(fakePluginMarker));
        expect(mcp.mcpServers?.["fake-plugin"]?.["_fakePluginId"]).toBe("fp-001");
        expect(typeof mcp.mcpServers?.["logbook-mcp"]?.["_logbookId"]).toBe("string");

        // 4. CLAUDE.md: otherplugin block UNCHANGED + logbook block appended
        const claudeMd = readFileSync(join(tmp, "CLAUDE.md"), "utf8");
        const otherPluginStart = "<!-- otherplugin start -->";
        expect(claudeMd.indexOf(otherPluginStart)).toBe(fixtureClaudeMd.indexOf(otherPluginStart));
        expect(claudeMd).toContain(
          "This block is owned by another plugin. LogBook must not remove or modify it.",
        );
        expect(claudeMd).toContain("<!-- logbook:generated start v=1 -->");

        // 5. 8 slash files (lb-*) + fake-plugin slash UNCHANGED
        const cmdsDir = join(tmp, ".claude/commands");
        const lbSlashes = [
          "lb-decision.md",
          "lb-error.md",
          "lb-fix.md",
          "lb-lesson.md",
          "lb-milestone.md",
          "lb-phase.md",
          "lb-review.md",
          "lb-status.md",
        ];
        for (const name of lbSlashes) {
          expect(existsSync(join(cmdsDir, name)), `${name} missing`).toBe(true);
        }
        const fakePluginSlashContent = readFileSync(
          join(tmp, ".claude/commands/fake-plugin.md"),
          "utf8",
        );
        expect(fakePluginSlashContent).toBe(fakeSlashContent);

        // 6. 2 skill files installed
        const skillsDir = join(tmp, ".claude/skills/logbook-auto-capture");
        expect(existsSync(join(skillsDir, "SKILL.md")), "SKILL.md missing").toBe(true);
        expect(existsSync(join(skillsDir, "reference.md")), "reference.md missing").toBe(true);

        // 7. 2 subagent files installed + fake-other UNCHANGED
        const subagentsDir = join(tmp, ".claude/subagents");
        expect(existsSync(join(subagentsDir, "logbook-curator.md")), "curator missing").toBe(true);
        expect(existsSync(join(subagentsDir, "logbook-teacher.md")), "teacher missing").toBe(true);
        const fakeOtherAfterInstall = readFileSync(
          join(tmp, ".claude/subagents/fake-other.md"),
          "utf8",
        );
        expect(fakeOtherAfterInstall).toBe(fakeOtherContent);

        // 8. .gitignore has original lines preserved + lb lines appended
        const gitignore = readFileSync(join(tmp, ".gitignore"), "utf8");
        expect(gitignore).toContain("node_modules/");
        expect(gitignore).toContain("dist/");
        expect(gitignore).toContain(".logbook/");
        expect(gitignore).toContain("logbook/");
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

      // Post-uninstall: verify LogBook artifacts are gone, pre-existing ones remain
      {
        // LogBook subagents gone
        expect(
          existsSync(join(tmp, ".claude/subagents/logbook-curator.md")),
          "curator should be removed",
        ).toBe(false);
        expect(
          existsSync(join(tmp, ".claude/subagents/logbook-teacher.md")),
          "teacher should be removed",
        ).toBe(false);

        // Pre-existing fake-other subagent still there (we don't own it)
        expect(
          existsSync(join(tmp, ".claude/subagents/fake-other.md")),
          "fake-other.md must survive uninstall",
        ).toBe(true);

        // Pre-existing fake-plugin slash still there
        expect(
          existsSync(join(tmp, ".claude/commands/fake-plugin.md")),
          "fake-plugin.md must survive uninstall",
        ).toBe(true);

        // statusLine key removed from settings.local.json
        const settings = JSON.parse(
          readFileSync(join(tmp, ".claude/settings.local.json"), "utf8"),
        );
        expect(settings.statusLine).toBeUndefined();

        // skills dir cleaned up
        expect(
          existsSync(join(tmp, ".claude/skills/logbook-auto-capture/SKILL.md")),
          "SKILL.md should be removed",
        ).toBe(false);
      }

      // THE GATE: byte-identical snapshot
      const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
      const diff = diffSnapshots(before, after);

      expect(
        diff,
        [
          "ITER4 TEACHING GATE FAILED — directory is NOT byte-identical after install+uninstall.",
          "LogBook mutated files it should have fully restored, or left traces in the project.",
          "",
          "This is a BLOCKER. The diff below shows exactly what changed:",
          JSON.stringify(diff, null, 2),
        ].join("\n"),
      ).toEqual({ added: [], removed: [], changed: [] });
    },
    120_000,
  );
});
