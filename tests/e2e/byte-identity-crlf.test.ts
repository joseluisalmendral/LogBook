/**
 * T13 — ITER2 GATE + W1 closure: byte-identity CRLF standard install/uninstall.
 *
 * Same shape as byte-identity-standard.test.ts but uses tests/fixtures/crlf-standard/
 * which has CRLF line endings on all shared files (settings.local.json, CLAUDE.md,
 * mcp.json, .gitignore). Proves the installer reads the original line ending,
 * writes with it preserved, and restores byte-identical content on uninstall.
 *
 * This closes W1 (CRLF roundtrip through full installer workflow).
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
const FIXTURE = join(REPO_ROOT, "tests/fixtures/crlf-standard");

const SNAPSHOT_IGNORE = [".git", "node_modules", ".logbook", "logbook"];

describe("T13 — byte-identity CRLF install/uninstall (closes W1)", () => {
  beforeAll(() => {
    if (!existsSync(CLI_BUNDLE) || !existsSync(HOOK_BUNDLE) || !existsSync(MCP_BUNDLE)) {
      spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    }
  });

  test(
    "install --preset standard then uninstall on CRLF fixture → byte-identical including CRLF endings",
    async () => {
      const tmpRaw = mkdtempSync(join(tmpdir(), "lb-e2e-crlf-std-"));
      const tmp = realpathSync(tmpRaw);
      cpSync(FIXTURE, tmp, { recursive: true });

      const before = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });

      // Verify the fixture itself has CRLF in the expected files
      // (sanity check — if this fails, the fixture was corrupted)
      {
        const { readFileSync } = await import("node:fs");
        const { join: j } = await import("pathe");
        const settingsRaw = readFileSync(j(tmp, ".claude/settings.local.json"), "utf8");
        expect(settingsRaw).toContain("\r\n");
        const claudeMd = readFileSync(j(tmp, "CLAUDE.md"), "utf8");
        expect(claudeMd).toContain("\r\n");
      }

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

      // Mid-install: shared CRLF files should still have CRLF
      {
        const { readFileSync } = await import("node:fs");
        const { join: j } = await import("pathe");

        const settingsRaw = readFileSync(j(tmp, ".claude/settings.local.json"), "utf8");
        expect(settingsRaw).toContain("\r\n");
        expect(settingsRaw).toContain('"_fakeAlphaId": "fa-001"');
        expect(settingsRaw).toContain('"_fakeBetaId":    "fb-001"');

        const claudeMd = readFileSync(j(tmp, "CLAUDE.md"), "utf8");
        expect(claudeMd).toContain("\r\n");
        expect(claudeMd).toContain("<!-- otherplugin start -->");
        expect(claudeMd).toContain("<!-- logbook:generated start v=1 -->");

        const mcpRaw = readFileSync(j(tmp, ".mcp.json"), "utf8");
        // mcp.json may be CRLF (original) — verify fake-plugin preserved + logbook added
        const mcp = JSON.parse(mcpRaw);
        expect(mcp.mcpServers?.["fake-plugin"]?.["_fakePluginId"]).toBe("fp-001");
        expect(mcp.mcpServers?.["logbook-mcp"]?.["_logbookId"]).toBe("lb-mcp-001");

        const gitignore = readFileSync(j(tmp, ".gitignore"), "utf8");
        expect(gitignore).toContain("\r\n");
        expect(gitignore).toContain(".logbook/");
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

      // Byte-identity assertion — CRLF byte for byte
      const after = await snapshotDir(tmp, { ignore: SNAPSHOT_IGNORE });
      const diff = diffSnapshots(before, after);

      expect(
        diff,
        [
          "ITER2 GATE (W1 closure) FAILED — CRLF fixture is NOT byte-identical after install+uninstall.",
          "This means CRLF line endings were not preserved symmetrically.",
          "",
          "Diff detail:",
          JSON.stringify(diff, null, 2),
        ].join("\n"),
      ).toEqual({ added: [], removed: [], changed: [] });
    },
    120_000,
  );
});
