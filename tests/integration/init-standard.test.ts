/**
 * I-INIT1 — init --preset standard on an empty project.
 *
 * T13 (iter3): Verifies that buildArtifactsForPreset("standard") installs exactly
 * 14 manifest entries (13 logical artifacts) in the correct design §6 order:
 *   1  hook
 *   2  mcp_server
 *   3  augment_claudemd
 *   4-11  slash_command × 8 (lb-decision, lb-error, lb-fix, lb-lesson,
 *                             lb-milestone, lb-phase, lb-review, lb-status)
 *   12  skill (SKILL.md)       — logbook-auto-capture Skill body
 *   13  skill (reference.md)   — logbook-auto-capture reference
 *   14  gitignore_entry (index 13, 0-based)
 *
 * Spawns the built CJS binary. Requires pnpm build before running.
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
  env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
      LOGBOOK_MCP_SERVER_PATH: MCP_CJS,
      ...env,
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("I-INIT1 — init --preset standard", () => {
  let tmp: string;
  let manifest: {
    version: number;
    preset: string;
    artifacts: Array<{ id: string; kind: string; file_path: string }>;
  };

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }
    if (!fs.existsSync(MCP_CJS)) {
      throw new Error(`Built MCP server not found at ${MCP_CJS}. Run \`pnpm build\` first.`);
    }

    // Create a temp project: package.json + .claude/
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-init-std-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.0" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    // Run init
    const result = runCli(["init", "--preset", "standard", "--yes"], tmp);
    if (result.code !== 0) {
      throw new Error(`init --preset standard failed:\n${result.stderr}`);
    }

    // Load manifest
    const manifestPath = path.join(tmp, ".logbook", "install-manifest.json");
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  });

  it("exits 0", () => {
    // Covered by beforeAll (would throw on non-zero). Assert manifest is loaded.
    expect(manifest).toBeDefined();
  });

  it("manifest has exactly 14 entries (1 hook + 1 mcp + 1 augment + 8 slash + 2 skill + 1 gitignore)", () => {
    // Design §6 iter3 order: hook(1) + mcp_server(1) + augment_claudemd(1) + slash×8(8) + skill×2(2) + gitignore(1) = 14
    expect(manifest.artifacts).toHaveLength(14);
  });

  it("manifest preset is 'standard'", () => {
    expect(manifest.preset).toBe("standard");
  });

  it("first artifact is hook", () => {
    expect(manifest.artifacts[0]?.kind).toBe("hook");
  });

  it("second artifact is mcp_server", () => {
    expect(manifest.artifacts[1]?.kind).toBe("mcp_server");
  });

  it("third artifact is augment_claudemd", () => {
    expect(manifest.artifacts[2]?.kind).toBe("augment_claudemd");
  });

  it("artifacts 4-11 (index 3-10) are slash_command × 8 in design §6 order", () => {
    // Indices 3..10 (0-based) = positions 4..11 (1-based)
    const slashArtifacts = manifest.artifacts.slice(3, 11);
    expect(slashArtifacts).toHaveLength(8);
    for (const a of slashArtifacts) {
      expect(a.kind).toBe("slash_command");
    }

    // Verify §6 order: decision, error, fix, lesson, milestone, phase, review, status
    const slashNames = slashArtifacts.map((a) => path.basename(a.file_path, ".md"));
    expect(slashNames).toEqual([
      "lb-decision",
      "lb-error",
      "lb-fix",
      "lb-lesson",
      "lb-milestone",
      "lb-phase",
      "lb-review",
      "lb-status",
    ]);
  });

  it("artifacts 12-13 (index 11-12) are skill × 2 (SKILL.md + reference.md)", () => {
    // Index 11 = skill SKILL.md, index 12 = skill reference.md
    const skillMain = manifest.artifacts[11];
    const skillRef = manifest.artifacts[12];
    expect(skillMain?.kind).toBe("skill");
    expect(skillRef?.kind).toBe("skill");
    expect(skillMain?.file_path).toContain("SKILL.md");
    expect(skillRef?.file_path).toContain("reference.md");
  });

  it("last artifact (index 13) is gitignore_entry", () => {
    // 14 total entries: hook(0) mcp(1) augment(2) slash×8(3-10) skill×2(11-12) gitignore(13)
    expect(manifest.artifacts[13]?.kind).toBe("gitignore_entry");
  });

  it("hook entry written to settings.local.json", () => {
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const hooks = settings?.hooks?.PostToolUse ?? [];
    const lbHook = hooks.find(
      (h: Record<string, unknown>) => typeof h["_logbookId"] === "string",
    );
    expect(lbHook).toBeDefined();
    expect(lbHook?.["_logbookId"]).toBe("lb-hook-posttooluse-001");
  });

  it("mcp_server entry written to .mcp.json at project root", () => {
    // Canonical project-scope MCP path (fix 2026-05-22). Claude Code reads
    // `.mcp.json` at root, NOT `.claude/mcp.json`.
    const mcpPath = path.join(tmp, ".mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    expect(mcp.mcpServers?.["logbook-mcp"]).toBeDefined();
    expect(mcp.mcpServers["logbook-mcp"]._logbookId).toBe("lb-mcp-001");
  });

  it("augment_claudemd block written to CLAUDE.md", () => {
    const claudeMdPath = path.join(tmp, "CLAUDE.md");
    expect(fs.existsSync(claudeMdPath)).toBe(true);
    const content = fs.readFileSync(claudeMdPath, "utf8");
    expect(content).toContain("<!-- logbook:generated start v=1 -->");
    expect(content).toContain("<!-- logbook:generated end -->");
  });

  it("all 8 slash command files created under .claude/commands/", () => {
    const commandsDir = path.join(tmp, ".claude", "commands");
    const slashNames = ["lb-decision", "lb-error", "lb-fix", "lb-lesson",
                        "lb-milestone", "lb-phase", "lb-review", "lb-status"];
    for (const name of slashNames) {
      const filePath = path.join(commandsDir, `${name}.md`);
      expect(fs.existsSync(filePath), `${name}.md should exist`).toBe(true);
    }
  });

  it("gitignore appended with logbook lines", () => {
    const gitignorePath = path.join(tmp, ".gitignore");
    const content = fs.readFileSync(gitignorePath, "utf8");
    expect(content).toContain(".logbook/");
    expect(content).toContain("logbook/");
  });

  it("Skill files created under .claude/skills/logbook-auto-capture/", () => {
    const skillDir = path.join(tmp, ".claude", "skills", "logbook-auto-capture");
    expect(fs.existsSync(path.join(skillDir, "SKILL.md")), "SKILL.md should exist").toBe(true);
    expect(fs.existsSync(path.join(skillDir, "reference.md")), "reference.md should exist").toBe(true);
  });

  it("SKILL.md content contains expected skill name", () => {
    const skillPath = path.join(tmp, ".claude", "skills", "logbook-auto-capture", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf8");
    expect(content).toContain("logbook-auto-capture");
  });
});
