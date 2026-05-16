/**
 * I-INIT2 — uninstall after init --preset standard.
 *
 * T13 (iter3): Verifies that uninstall --force reverses all 14 preset standard
 * manifest entries cleanly, preserving data directories (.logbook/state.json)
 * but removing all installer-written content including Skill files and their
 * parent directory (.claude/skills/logbook-auto-capture/ and .claude/skills/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const MCP_CJS = path.join(ROOT, "dist/mcp/server.cjs");

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
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("I-INIT2 — uninstall after init --preset standard", () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    // Create temp project
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-uninst-std-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.0" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    // Install
    const installResult = runCli(["init", "--preset", "standard", "--yes"], tmp);
    if (installResult.code !== 0) {
      throw new Error(`init failed:\n${installResult.stderr}`);
    }

    // Uninstall
    const uninstallResult = runCli(["uninstall", "--force"], tmp);
    if (uninstallResult.code !== 0) {
      throw new Error(`uninstall failed:\n${uninstallResult.stderr}`);
    }
  });

  it("manifest is removed after uninstall", () => {
    const manifestPath = path.join(tmp, ".logbook", "install-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it("hook entry removed from settings.local.json", () => {
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    if (!fs.existsSync(settingsPath)) {
      // File was absent before install and was created only for our hook.
      // After uninstall it may be gone (if we created it) or empty.
      return;
    }
    // If still present, the logbook hook must not be there.
    const content = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(content);
    const hooks: unknown[] = settings?.hooks?.PostToolUse ?? [];
    const lbHook = hooks.find(
      (h) => typeof h === "object" && h !== null &&
             typeof (h as Record<string, unknown>)["_logbookId"] === "string",
    );
    expect(lbHook).toBeUndefined();
  });

  it("logbook-mcp removed from mcp.json", () => {
    const mcpPath = path.join(tmp, ".claude", "mcp.json");
    if (!fs.existsSync(mcpPath)) {
      // File was created by us for the mcp entry. It was deleted on uninstall.
      return;
    }
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    expect(mcp.mcpServers?.["logbook-mcp"]).toBeUndefined();
  });

  it("CLAUDE.md has no logbook generated block", () => {
    const claudeMdPath = path.join(tmp, "CLAUDE.md");
    if (!fs.existsSync(claudeMdPath)) {
      // We may have created it and then deleted it on uninstall. Fine.
      return;
    }
    const content = fs.readFileSync(claudeMdPath, "utf8");
    expect(content).not.toContain("<!-- logbook:generated start");
  });

  it("lb-*.md slash files removed from .claude/commands/", () => {
    const commandsDir = path.join(tmp, ".claude", "commands");
    const slashNames = ["lb-decision", "lb-error", "lb-fix", "lb-lesson",
                        "lb-milestone", "lb-phase", "lb-review", "lb-status"];
    for (const name of slashNames) {
      const filePath = path.join(commandsDir, `${name}.md`);
      expect(fs.existsSync(filePath), `${name}.md should be removed`).toBe(false);
    }
  });

  it("gitignore entries removed", () => {
    const gitignorePath = path.join(tmp, ".gitignore");
    if (!fs.existsSync(gitignorePath)) return;
    const content = fs.readFileSync(gitignorePath, "utf8");
    // logbook-specific entries should be gone
    expect(content).not.toContain("lb-gitignore-001");
    expect(content).not.toContain(".logbook/");
  });

  it("state.json preserved (data dir contract)", () => {
    const statePath = path.join(tmp, ".logbook", "state.json");
    // state.json lives in .logbook/ which is preserved on uninstall per spec
    // It may or may not exist depending on whether init wrote it.
    // The important thing is that IF it was written, it is NOT deleted.
    // We verify this indirectly: .logbook/ dir must still exist if state was written.
    // (init --yes writes state.json, so it should be there)
    expect(fs.existsSync(statePath)).toBe(true);
  });

  it("Skill files removed after uninstall", () => {
    const skillMdPath = path.join(tmp, ".claude", "skills", "logbook-auto-capture", "SKILL.md");
    const refPath = path.join(tmp, ".claude", "skills", "logbook-auto-capture", "reference.md");
    expect(fs.existsSync(skillMdPath), "SKILL.md should be removed").toBe(false);
    expect(fs.existsSync(refPath), "reference.md should be removed").toBe(false);
  });

  it(".claude/skills/logbook-auto-capture/ dir removed after uninstall", () => {
    const skillDir = path.join(tmp, ".claude", "skills", "logbook-auto-capture");
    expect(fs.existsSync(skillDir), ".claude/skills/logbook-auto-capture/ should be removed").toBe(false);
  });

  it(".claude/skills/ dir removed after uninstall (we created it)", () => {
    const skillsDir = path.join(tmp, ".claude", "skills");
    expect(fs.existsSync(skillsDir), ".claude/skills/ should be removed (was created by us)").toBe(false);
  });
});
