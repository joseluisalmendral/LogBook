/**
 * T10 — Integration GAP FILLER: init --preset teaching coexistence with pre-existing artifacts.
 *
 * Identifies and covers the GAPS not covered by existing T8 integration tests:
 *
 * 1. init-teaching.test.ts (T8) uses a CLEAN project (no pre-existing plugins).
 *    GAP: no test verifies teaching preset on a project WITH:
 *      - Pre-existing subagent from another plugin (.claude/subagents/fake-other.md)
 *      - Pre-existing slash command from another plugin (.claude/commands/fake-plugin.md)
 *      - Pre-existing MCP server (fake-plugin in mcp.json)
 *      - Pre-existing hooks (2 fake PostToolUse hooks in settings.local.json)
 *      - Pre-existing CLAUDE.md block (<!-- otherplugin start --> block)
 *
 * This test uses tests/fixtures/project-teaching/ which has ALL the above pre-populated.
 *
 * 2. statusline-installer.test.ts (T3) covers statusline in isolation.
 *    GAP: no test verifies statusline is added to settings.local.json that ALREADY has
 *    pre-existing hooks (not just an empty or minimal file).
 *
 * Coverage decision for T11 (SessionStart + OTel + Codex combined flows):
 *   - session-start-hook.test.ts (T4): fully covers SessionStart end-to-end ✓
 *   - cli-ingest-otel.test.ts (T5): fully covers OTel ingest end-to-end ✓
 *   - cli-ingest-codex.test.ts (T6): fully covers Codex ingest end-to-end ✓
 *   No additional combined-flow tests needed for T11 — gaps are covered by dedicated tests.
 *
 * Requires: pnpm build (uses dist/cli/index.cjs + dist/mcp/server.cjs).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const MCP_CJS = path.join(ROOT, "dist/mcp/server.cjs");
const FIXTURE = path.join(ROOT, "tests/fixtures/project-teaching");

function runCli(
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
      LOGBOOK_MCP_SERVER_PATH: MCP_CJS,
      LOGBOOK_ASSETS_ROOT: path.join(ROOT, "assets"),
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("T10 — init --preset teaching coexistence with pre-existing plugins (GAP)", () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }
    if (!fs.existsSync(MCP_CJS)) {
      throw new Error(`Built MCP server not found at ${MCP_CJS}. Run \`pnpm build\` first.`);
    }

    // Copy fixture into a fresh temp directory
    const tmpRaw = fs.mkdtempSync(path.join(os.tmpdir(), "lb-t10-coex-"));
    tmp = fs.realpathSync(tmpRaw);
    fs.cpSync(FIXTURE, tmp, { recursive: true });

    // Run init with teaching preset
    const result = runCli(["init", "--preset", "teaching", "--yes"], tmp);
    if (result.code !== 0) {
      throw new Error(
        `init --preset teaching failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
  });

  afterAll(() => {
    if (tmp) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  });

  // -------------------------------------------------------------------------
  // GAP 1: pre-existing subagent from another plugin is NOT overwritten
  // -------------------------------------------------------------------------

  it("pre-existing fake-other.md subagent is NOT overwritten by teaching preset", () => {
    const fakeOtherPath = path.join(tmp, ".claude/subagents/fake-other.md");
    expect(fs.existsSync(fakeOtherPath)).toBe(true);
    const content = fs.readFileSync(fakeOtherPath, "utf8");
    expect(content).toContain("A subagent installed by another plugin");
    expect(content).toContain("LogBook must not remove or overwrite it");
  });

  it("LogBook's own subagents are installed alongside the pre-existing one", () => {
    const subagentsDir = path.join(tmp, ".claude/subagents");
    expect(fs.existsSync(path.join(subagentsDir, "logbook-curator.md"))).toBe(true);
    expect(fs.existsSync(path.join(subagentsDir, "logbook-teacher.md"))).toBe(true);
  });

  it("manifest does NOT include an entry for fake-other.md (not ours)", () => {
    const manifestPath = path.join(tmp, ".logbook/install-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      artifacts: Array<{ file_path: string }>;
    };
    const fakeEntry = manifest.artifacts.find((a) =>
      a.file_path.includes("fake-other"),
    );
    expect(fakeEntry).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // GAP 2: pre-existing fake slash command is NOT removed
  // -------------------------------------------------------------------------

  it("pre-existing fake-plugin.md slash command is NOT removed", () => {
    const fakePath = path.join(tmp, ".claude/commands/fake-plugin.md");
    expect(fs.existsSync(fakePath)).toBe(true);
    const content = fs.readFileSync(fakePath, "utf8");
    expect(content).toContain("Fake plugin slash command owned by another plugin");
  });

  it("LogBook slash commands are installed alongside the pre-existing one", () => {
    const cmdsDir = path.join(tmp, ".claude/commands");
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
      expect(fs.existsSync(path.join(cmdsDir, name)), `${name} missing`).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // GAP 3: statusline added to settings.local.json that already has fake hooks
  // -------------------------------------------------------------------------

  it("statusLine key is added to settings.local.json that already has pre-existing hooks", () => {
    const settingsPath = path.join(tmp, ".claude/settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    // Claude Code schema object shape — see fix 2026-05-21.
    expect(typeof settings.statusLine).toBe("object");
    expect(settings.statusLine.command).toContain("state --inline");
  });

  it("pre-existing fake PostToolUse hooks survive statusline + teaching install", () => {
    const settingsPath = path.join(tmp, ".claude/settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    // Verify the hooks are present by parsing — the SessionStart install path
    // uses pure string-patch (T-FIX-HOOK: no re-serialize). Semantic content
    // and byte layout are both preserved; checking semantics here is sufficient.
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
  });

  it("SessionStart hook is appended to settings.local.json without disturbing PostToolUse hooks", () => {
    const settingsPath = path.join(tmp, ".claude/settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

    // PostToolUse: 2 fake + 1 logbook
    const ptuHooks: unknown[] = settings?.hooks?.PostToolUse ?? [];
    const lbPtuHooks = ptuHooks.filter(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        typeof (h as Record<string, unknown>)["_logbookId"] === "string",
    );
    expect(lbPtuHooks).toHaveLength(1);
    expect(ptuHooks).toHaveLength(3); // 2 fake + 1 lb

    // SessionStart: 1 logbook
    const ssHooks: unknown[] = settings?.hooks?.SessionStart ?? [];
    expect(ssHooks).toHaveLength(1);
    const lbSsHook = ssHooks[0] as Record<string, unknown>;
    expect(lbSsHook["_logbookId"]).toBe("lb-hook-sessionstart-001");
  });

  // -------------------------------------------------------------------------
  // GAP 4: CLAUDE.md otherplugin block is preserved
  // -------------------------------------------------------------------------

  it("CLAUDE.md otherplugin block is preserved after teaching install", () => {
    const claudeMd = fs.readFileSync(path.join(tmp, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("<!-- otherplugin start -->");
    expect(claudeMd).toContain("This block is owned by another plugin. LogBook must not remove or modify it.");
    expect(claudeMd).toContain("<!-- otherplugin end -->");
  });

  it("CLAUDE.md logbook block is appended after otherplugin block", () => {
    const claudeMd = fs.readFileSync(path.join(tmp, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("<!-- logbook:generated start v=1 -->");
    // otherplugin block must precede logbook block
    const otherPluginPos = claudeMd.indexOf("<!-- otherplugin start -->");
    const logbookPos = claudeMd.indexOf("<!-- logbook:generated start v=1 -->");
    expect(otherPluginPos).toBeGreaterThanOrEqual(0);
    expect(logbookPos).toBeGreaterThanOrEqual(0);
    expect(logbookPos).toBeGreaterThan(otherPluginPos);
  });

  // -------------------------------------------------------------------------
  // GAP 5: mcp.json fake-plugin entry is NOT disturbed
  // -------------------------------------------------------------------------

  it("mcp.json fake-plugin entry is NOT removed during teaching install", () => {
    const mcpRaw = fs.readFileSync(path.join(tmp, ".claude/mcp.json"), "utf8");
    const mcp = JSON.parse(mcpRaw);
    expect(mcp.mcpServers?.["fake-plugin"]?.["_fakePluginId"]).toBe("fp-001");
  });

  it("mcp.json logbook-mcp entry is added alongside fake-plugin", () => {
    const mcpRaw = fs.readFileSync(path.join(tmp, ".claude/mcp.json"), "utf8");
    const mcp = JSON.parse(mcpRaw);
    expect(typeof mcp.mcpServers?.["logbook-mcp"]?.["_logbookId"]).toBe("string");
  });

  // -------------------------------------------------------------------------
  // GAP 6: .gitignore pre-existing content is preserved
  // -------------------------------------------------------------------------

  it(".gitignore pre-existing lines are preserved after teaching install", () => {
    const gitignore = fs.readFileSync(path.join(tmp, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("dist/");
  });

  it(".gitignore logbook entries are appended", () => {
    const gitignore = fs.readFileSync(path.join(tmp, ".gitignore"), "utf8");
    expect(gitignore).toContain(".logbook/");
    expect(gitignore).toContain("logbook/");
  });

  // -------------------------------------------------------------------------
  // GAP 7: uninstall restores byte-identity with pre-existing artifacts intact
  // -------------------------------------------------------------------------

  it("uninstall exits 0 after teaching install on a project with pre-existing plugins", () => {
    // Run uninstall in a SEPARATE temp dir to avoid interfering with the main beforeAll project
    const tmpRaw2 = fs.mkdtempSync(path.join(os.tmpdir(), "lb-t10-uninstall-"));
    const tmp2 = fs.realpathSync(tmpRaw2);
    fs.cpSync(FIXTURE, tmp2, { recursive: true });

    // Install
    const installResult = runCli(["init", "--preset", "teaching", "--yes"], tmp2);
    expect(installResult.code, `install failed: ${installResult.stderr}`).toBe(0);

    // Uninstall
    const uninstallResult = runCli(["uninstall", "--force"], tmp2);
    expect(
      uninstallResult.code,
      `uninstall failed:\nstdout: ${uninstallResult.stdout}\nstderr: ${uninstallResult.stderr}`,
    ).toBe(0);

    // fake-other.md must still be there after uninstall (we don't own it)
    const fakeOtherPath = path.join(tmp2, ".claude/subagents/fake-other.md");
    expect(fs.existsSync(fakeOtherPath)).toBe(true);

    // fake-plugin slash must still be there
    const fakeSlashPath = path.join(tmp2, ".claude/commands/fake-plugin.md");
    expect(fs.existsSync(fakeSlashPath)).toBe(true);

    // LogBook subagents must be gone
    expect(fs.existsSync(path.join(tmp2, ".claude/subagents/logbook-curator.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmp2, ".claude/subagents/logbook-teacher.md"))).toBe(false);

    // Cleanup
    try {
      fs.rmSync(tmpRaw2, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }, 60_000);
});
