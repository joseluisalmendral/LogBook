/**
 * I-INIT-TEACH — init --preset teaching on an empty project.
 *
 * T8 (iter4+CC): Verifies that buildArtifactsForPreset("teaching") installs exactly
 * 20 manifest entries (conversation-capture adds UserPromptSubmit + Stop hooks):
 *
 *  Index  Kind
 *  -----  ----
 *   0     hook (PostToolUse)
 *   1     hook (UserPromptSubmit) — conversation-capture
 *   2     hook (Stop)             — conversation-capture
 *   3     mcp_server
 *   4     augment_claudemd
 *   5-12  slash_command × 8 (lb-decision, lb-error, lb-fix, lb-lesson,
 *                             lb-milestone, lb-phase, lb-review, lb-status)
 *   13    skill (SKILL.md)
 *   14    skill (reference.md)
 *   15    subagent (logbook-curator)
 *   16    subagent (logbook-teacher)
 *   17    statusline
 *   18    hook (SessionStart)
 *   19    gitignore_entry (LAST)
 *
 * Total: 20 manifest entries.
 * Logical count: 3×hook + mcp + augment + 8×slash + 2×skill + 2×subagent + statusline + SessionStart-hook + gitignore = 19 distinct artifacts.
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
      LOGBOOK_ASSETS_ROOT: path.join(ROOT, "assets"),
      ...env,
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("I-INIT-TEACH — init --preset teaching", () => {
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

    // Create a temp project
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-init-teach-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.0" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    // Run init with teaching preset
    const result = runCli(["init", "--preset", "teaching", "--yes"], tmp);
    if (result.code !== 0) {
      throw new Error(`init --preset teaching failed:\n${result.stderr}\n${result.stdout}`);
    }

    // Load manifest
    const manifestPath = path.join(tmp, ".logbook", "install-manifest.json");
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  });

  it("exits 0 and manifest is loaded", () => {
    expect(manifest).toBeDefined();
    expect(manifest.artifacts).toBeDefined();
  });

  it("manifest has exactly 20 entries", () => {
    // Design T8:
    //   hook(PostToolUse) + hook(UserPromptSubmit) + hook(Stop)
    //   + mcp_server + augment_claudemd
    //   + slash×8 + skill×2 + subagent×2 + statusline + hook(SessionStart) + gitignore
    //   = 3+1+1+8+2+2+1+1+1 = 20
    expect(manifest.artifacts).toHaveLength(20);
  });

  it("manifest preset is 'teaching'", () => {
    expect(manifest.preset).toBe("teaching");
  });

  it("index 0 is hook (PostToolUse)", () => {
    expect(manifest.artifacts[0]?.kind).toBe("hook");
  });

  it("index 1 is hook (UserPromptSubmit)", () => {
    expect(manifest.artifacts[1]?.kind).toBe("hook");
    expect(manifest.artifacts[1]?.id).toContain("lb-hook-userpromptsubmit");
  });

  it("index 2 is hook (Stop)", () => {
    expect(manifest.artifacts[2]?.kind).toBe("hook");
    expect(manifest.artifacts[2]?.id).toContain("lb-hook-stop");
  });

  it("index 3 is mcp_server", () => {
    expect(manifest.artifacts[3]?.kind).toBe("mcp_server");
  });

  it("index 4 is augment_claudemd", () => {
    expect(manifest.artifacts[4]?.kind).toBe("augment_claudemd");
  });

  it("indices 5-12 are slash_command × 8 in design §6 order", () => {
    const slashArtifacts = manifest.artifacts.slice(5, 13);
    expect(slashArtifacts).toHaveLength(8);
    for (const a of slashArtifacts) {
      expect(a.kind).toBe("slash_command");
    }
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

  it("indices 13-14 are skill × 2 (SKILL.md + reference.md)", () => {
    const skillMain = manifest.artifacts[13];
    const skillRef = manifest.artifacts[14];
    expect(skillMain?.kind).toBe("skill");
    expect(skillRef?.kind).toBe("skill");
    expect(skillMain?.file_path).toContain("SKILL.md");
    expect(skillRef?.file_path).toContain("reference.md");
  });

  it("indices 15-16 are subagent × 2 (curator then teacher)", () => {
    const curator = manifest.artifacts[15];
    const teacher = manifest.artifacts[16];
    expect(curator?.kind).toBe("subagent");
    expect(teacher?.kind).toBe("subagent");
    expect(curator?.file_path).toContain("logbook-curator");
    expect(teacher?.file_path).toContain("logbook-teacher");
  });

  it("index 17 is statusline", () => {
    const statusline = manifest.artifacts[17];
    expect(statusline?.kind).toBe("statusline");
  });

  it("index 18 is hook (SessionStart)", () => {
    const sessionHook = manifest.artifacts[18];
    expect(sessionHook?.kind).toBe("hook");
    // The file_path for hooks is settings.local.json; verify by id pattern
    // The id should be lb-hook-sessionstart-001
    expect(sessionHook?.id).toContain("lb-hook-sessionstart");
  });

  it("index 19 (last) is gitignore_entry", () => {
    expect(manifest.artifacts[19]?.kind).toBe("gitignore_entry");
  });

  it("subagent files created under .claude/subagents/", () => {
    const subagentsDir = path.join(tmp, ".claude", "subagents");
    expect(fs.existsSync(path.join(subagentsDir, "logbook-curator.md"))).toBe(true);
    expect(fs.existsSync(path.join(subagentsDir, "logbook-teacher.md"))).toBe(true);
  });

  it("statusline written to settings.local.json", () => {
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    // Claude Code schema requires the object shape `{type, command}` —
    // the bare-string shape was rejected with
    // `statusLine: Expected object, but received string` (fix 2026-05-21).
    expect(typeof settings.statusLine).toBe("object");
    expect(settings.statusLine.type).toBe("command");
    expect(settings.statusLine.command).toContain("state --inline");
  });

  it("SessionStart hook written to settings.local.json", () => {
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const sessionStartHooks = settings?.hooks?.SessionStart ?? [];
    expect(sessionStartHooks.length).toBeGreaterThanOrEqual(1);
    const lbHook = sessionStartHooks.find(
      (h: Record<string, unknown>) => typeof h["_logbookId"] === "string",
    );
    expect(lbHook).toBeDefined();
    expect(lbHook?.["_logbookId"]).toBe("lb-hook-sessionstart-001");
  });

  it("PostToolUse hook id is distinct from SessionStart hook id", () => {
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const postToolUseHooks = settings?.hooks?.PostToolUse ?? [];
    const sessionStartHooks = settings?.hooks?.SessionStart ?? [];
    const ptuHook = postToolUseHooks.find(
      (h: Record<string, unknown>) => typeof h["_logbookId"] === "string",
    );
    const ssHook = sessionStartHooks.find(
      (h: Record<string, unknown>) => typeof h["_logbookId"] === "string",
    );
    expect(ptuHook?.["_logbookId"]).toBe("lb-hook-posttooluse-001");
    expect(ssHook?.["_logbookId"]).toBe("lb-hook-sessionstart-001");
    expect(ptuHook?.["_logbookId"]).not.toBe(ssHook?.["_logbookId"]);
  });
});
