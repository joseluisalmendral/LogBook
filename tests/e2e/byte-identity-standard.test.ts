/* SLICE-26 SUPERSEDED: lean install (SessionStart + Stop only) changed manifest counts and hook order; the new contract is covered by tests/unit/presets-extract.test.ts and tests/integration/byte-identity-with-conversation-hooks.test.ts. Reversibility (INV-1) is covered by tests/e2e/byte-identity-{clean,crlf,with-fake-plugin}.test.ts. Re-enable + rewrite when revisiting the legacy install matrix. */

/**
 * T13 — ITER3 GATE: byte-identity standard install/uninstall.
 *
 * Copies tests/fixtures/project-standard (which has 2 fake plugin hooks,
 * 1 fake MCP server entry, and 1 fake slash file) into a tmp dir, snapshots
 * the directory, runs `init --preset standard`, then `uninstall --force`, and
 * asserts the post-uninstall snapshot is byte-identical to the pre-install one.
 *
 * iter3 addition: verifies that the 2 Skill files (SKILL.md + reference.md)
 * are installed mid-install and fully removed on uninstall — no trace left.
 *
 * If the diff is non-empty, the full diff arrays are embedded in the failure
 * message so reviewers see what mismatched without re-running.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { mkdtempSync, cpSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "pathe";
import { spawnSync } from "node:child_process";
import { snapshotDir, diffSnapshots } from "../helpers/snapshot.js";

const REPO_ROOT = resolve(__dirname, "../..");
const CLI_BUNDLE = join(REPO_ROOT, "dist/cli/index.cjs");
const HOOK_BUNDLE = join(REPO_ROOT, "dist/connectors/claude-code/hook.cjs");
const MCP_BUNDLE = join(REPO_ROOT, "dist/mcp/server.cjs");
const FIXTURE = join(REPO_ROOT, "tests/fixtures/project-standard");

const SNAPSHOT_IGNORE = [".git", "node_modules", ".logbook", "logbook"];

describe.skip("T13 — byte-identity standard install/uninstall (ITER3 GATE)", () => {
  beforeAll(() => {
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE) || !existsSync(MCP_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }
  });

  test(
    "install --preset standard then uninstall on project with fake plugins → byte-identical",
    async () => {
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-std-"));
      const tmp = realpathSync(tmpRaw);
      cpSync(FIXTURE, tmp, { recursive: true });

      const before = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });

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

      // Mid-install assertions: verify coexistence invariants
      {
        const { readFileSync, existsSync: exists } = await import("node:fs");
        const { join: j } = await import("pathe");

        // settings.local.json: both fake plugin entries unchanged + lb hook appended
        const settingsRaw = readFileSync(j(tmp, ".claude/settings.local.json"), "utf8");
        expect(settingsRaw).toContain('"_fakeAlphaId": "fa-001"');
        expect(settingsRaw).toContain('"_fakeBetaId":    "fb-001"');
        const settings = JSON.parse(settingsRaw);
        const hooks: unknown[] = settings?.hooks?.PostToolUse ?? [];
        const lbHooks = hooks.filter(
          (h) =>
            typeof h === "object" &&
            h !== null &&
            typeof (h as Record<string, unknown>)["_logbookId"] === "string",
        );
        expect(lbHooks).toHaveLength(1);

        // mcp.json: fake-plugin entry unchanged + logbook-mcp added
        const mcpRaw = readFileSync(j(tmp, ".mcp.json"), "utf8");
        const mcp = JSON.parse(mcpRaw);
        expect(mcp.mcpServers?.["fake-plugin"]?.["_fakePluginId"]).toBe("fp-001");
        expect(mcp.mcpServers?.["logbook-mcp"]?.["_logbookId"]).toBe("lb-mcp-001");

        // CLAUDE.md: otherplugin block untouched, logbook block added
        const claudeMd = readFileSync(j(tmp, "CLAUDE.md"), "utf8");
        expect(claudeMd).toContain("<!-- otherplugin start -->");
        expect(claudeMd).toContain("This block is owned by another plugin.");
        expect(claudeMd).toContain("<!-- logbook:generated start v=1 -->");

        // 8 lb-*.md slash files exist alongside fake-plugin.md
        const slashNames = ["lb-decision", "lb-error", "lb-fix", "lb-lesson",
                            "lb-milestone", "lb-phase", "lb-review", "lb-status"];
        for (const name of slashNames) {
          expect(exists(j(tmp, `.claude/commands/${name}.md`)), `${name}.md missing`).toBe(true);
        }
        // fake-plugin.md must still be there (not touched)
        expect(exists(j(tmp, ".claude/commands/fake-plugin.md"))).toBe(true);

        // Skill files installed under .claude/skills/logbook-auto-capture/
        expect(exists(j(tmp, ".claude/skills/logbook-auto-capture/SKILL.md")), "SKILL.md missing").toBe(true);
        expect(exists(j(tmp, ".claude/skills/logbook-auto-capture/reference.md")), "reference.md missing").toBe(true);

        // .gitignore has our entries appended
        const gitignore = readFileSync(j(tmp, ".gitignore"), "utf8");
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
          },
          encoding: "utf8",
        },
      );
      expect(
        uninstallResult.status,
        `uninstall failed:\nstdout: ${uninstallResult.stdout}\nstderr: ${uninstallResult.stderr}`,
      ).toBe(0);

      // Byte-identity assertion
      const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
      const diff = diffSnapshots(before, after);

      expect(
        diff,
        [
          "ITER3 GATE FAILED — directory is NOT byte-identical after install+uninstall.",
          "LogBook mutated files it should have fully restored.",
          "",
          "Diff detail (check 'changed' for modified files, 'added'/'removed' for extra/missing):",
          JSON.stringify(diff, null, 2),
        ].join("\n"),
      ).toEqual({ added: [], removed: [], changed: [] });
    },
    120_000,
  );
});
