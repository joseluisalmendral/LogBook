/**
 * Preset artifact builders — extracted from src/cli/commands/init.ts (iter6 T1).
 *
 * This module is the single source of truth for which artifacts each preset
 * installs. It is imported by:
 *   - src/cli/commands/init.ts (CLI install command)
 *   - src/tui/screens/install-wizard.ts (wizard preview — iter6 T4)
 *
 * No I/O side-effects at import time. All env-var resolution and fs reads happen
 * inside the builder functions, matching the original init.ts behavior exactly.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Artifact } from "../types/artifact.js";

// ---------------------------------------------------------------------------
// Hook bundle path resolution.
// Production: dist/cli/index.cjs → __dirname = dist/cli/
//             hook is at dist/connectors/claude-code/hook.cjs
// Tests: override via LOGBOOK_HOOK_PATH env var.
// ---------------------------------------------------------------------------
function resolveHookPath(): string {
  if (process.env["LOGBOOK_HOOK_PATH"]) {
    return process.env["LOGBOOK_HOOK_PATH"];
  }
  // __dirname in CJS output → dist/cli (bundled by tsup into dist/cli/index.cjs)
  return path.resolve(__dirname, "../connectors/claude-code/hook.cjs");
}

// ---------------------------------------------------------------------------
// MCP server path resolution.
// Production: dist/cli/index.cjs → __dirname = dist/cli/
//             server is at dist/mcp/server.cjs
// Tests: override via LOGBOOK_MCP_SERVER_PATH env var.
// ---------------------------------------------------------------------------
function resolveMcpServerPath(): string {
  if (process.env["LOGBOOK_MCP_SERVER_PATH"]) {
    return process.env["LOGBOOK_MCP_SERVER_PATH"];
  }
  // __dirname in CJS output → dist/cli
  return path.resolve(__dirname, "../mcp/server.cjs");
}

// ---------------------------------------------------------------------------
// Asset reading helpers — read slash command bodies and augment block from disk.
// These paths are relative to the repo root in dev; in production the assets
// are bundled alongside the CJS at dist/cli/../assets/ (i.e., ../../assets/).
// We resolve relative to __dirname at runtime for CJS output compatibility.
// ---------------------------------------------------------------------------

/**
 * Resolve path to an asset file relative to the CLI bundle.
 * Production CJS layout:
 *   dist/cli/index.cjs          ← __dirname = dist/cli
 *   assets/slash/lb-*.md        ← 2 levels up from dist/cli, then assets/
 *
 * At tsup bundle time, assets/ is NOT inlined — we read from the filesystem.
 * The LOGBOOK_ASSETS_ROOT env var overrides for tests (tests use repo root).
 */
function resolveAssetPath(...segments: string[]): string {
  const assetsRoot =
    process.env["LOGBOOK_ASSETS_ROOT"] ?? path.resolve(__dirname, "../../assets");
  return path.join(assetsRoot, ...segments);
}

/**
 * Read a slash command body from assets/slash/<name>.md.
 * Throws if the file is not found — assets are required for standard preset.
 */
function readSlashAsset(name: string): string {
  const assetPath = resolveAssetPath("slash", `${name}.md`);
  return fs.readFileSync(assetPath, "utf8");
}

/**
 * Read the augment_claudemd body from assets/claudemd/augment.md.
 */
function readAugmentAsset(): string {
  const assetPath = resolveAssetPath("claudemd", "augment.md");
  return fs.readFileSync(assetPath, "utf8");
}

/**
 * Read a Skill asset file from assets/skill/<name>.
 * Supports SKILL.md and reference.md.
 * Throws if the file is not found — assets are required for standard preset.
 */
function readSkillAsset(name: string): string {
  const assetPath = resolveAssetPath("skill", name);
  return fs.readFileSync(assetPath, "utf8");
}

/**
 * Read a subagent body from assets/subagents/<name>.md.
 * Throws if not found — assets are required for teaching preset.
 */
function readSubagentAsset(name: string): string {
  const assetPath = resolveAssetPath("subagents", `${name}.md`);
  return fs.readFileSync(assetPath, "utf8");
}

// ---------------------------------------------------------------------------
// The 8 slash command names in design §6 install order.
// ---------------------------------------------------------------------------
const STANDARD_SLASH_NAMES = [
  "lb-decision",
  "lb-error",
  "lb-fix",
  "lb-lesson",
  "lb-milestone",
  "lb-phase",
  "lb-review",
  "lb-status",
] as const;

// ---------------------------------------------------------------------------
// Artifact builders (exported for use by install-wizard preview in iter6 TUI)
// ---------------------------------------------------------------------------

export function buildMinimalArtifacts(): Artifact[] {
  const hookPath = resolveHookPath();
  return [
    {
      kind: "hook",
      hookEvent: "PostToolUse",
      command: `node ${hookPath}`,
      _logbookId: "lb-hook-posttooluse-001",
    },
    {
      kind: "gitignore_entry",
      file_path: ".gitignore",
      lines: [".logbook/", "logbook/", "# lb-gitignore-001"],
    },
  ];
}

/**
 * Build the full artifact list for preset "standard" in design §6 order.
 *
 * Reads slash command bodies and the augment block from the assets/ directory
 * at build time (not at install time — the list is assembled once, then the
 * install-engine installs them in order). This matches the §6 spec exactly.
 */
export function buildStandardArtifacts(): Artifact[] {
  const hookPath = resolveHookPath();
  const mcpServerPath = resolveMcpServerPath();
  const augmentBody = readAugmentAsset();

  // Build the 8 slash command artifacts
  const slashArtifacts: Artifact[] = STANDARD_SLASH_NAMES.map((name) => ({
    kind: "slash_command" as const,
    name,
    file_path: `.claude/commands/${name}.md`,
    body: readSlashAsset(name),
    _logbookId: `lb-cmd-${name}`,
  }));

  return [
    // 1. hook (PostToolUse — same as minimal)
    {
      kind: "hook",
      hookEvent: "PostToolUse",
      command: `node ${hookPath}`,
      _logbookId: "lb-hook-posttooluse-001",
    },
    // 2. mcp_server (logbook-mcp → dist/mcp/server.cjs)
    {
      kind: "mcp_server",
      name: "logbook-mcp",
      command: "node",
      args: [mcpServerPath],
      _logbookId: "lb-mcp-001",
    },
    // 3. augment_claudemd
    {
      kind: "augment_claudemd",
      file_path: "CLAUDE.md",
      block_content: augmentBody,
      _logbookId: "lb-claudemd-001",
    },
    // 4-11. slash_command × 8 (in §6 order)
    ...slashArtifacts,
    // 12. skill (SKILL.md — logbook-auto-capture body; in fixed agent context)
    {
      kind: "skill",
      name: "logbook-auto-capture",
      file_path: ".claude/skills/logbook-auto-capture/SKILL.md",
      body: readSkillAsset("SKILL.md"),
      _logbookId: "lb-skill-logbook-auto-capture-skill",
    },
    // 13. skill (reference.md — on-demand field reference; NOT in fixed context)
    {
      kind: "skill",
      name: "logbook-auto-capture",
      file_path: ".claude/skills/logbook-auto-capture/reference.md",
      body: readSkillAsset("reference.md"),
      _logbookId: "lb-skill-logbook-auto-capture-reference",
    },
    // 14. gitignore_entry (LAST — per iter1 install-order contract)
    {
      kind: "gitignore_entry",
      file_path: ".gitignore",
      lines: [".logbook/", "logbook/", "# lb-gitignore-001"],
    },
  ];
}

/**
 * Build the full artifact list for preset "teaching" in T8 design order.
 *
 * Teaching = standard set + 2 subagents + statusline + SessionStart hook.
 *
 * Final manifest order (18 entries):
 *   0   hook (PostToolUse)
 *   1   mcp_server
 *   2   augment_claudemd
 *   3-10 slash_command × 8
 *   11  skill (SKILL.md)
 *   12  skill (reference.md)
 *   13  subagent (logbook-curator)
 *   14  subagent (logbook-teacher)
 *   15  statusline
 *   16  hook (SessionStart)
 *   17  gitignore_entry (LAST)
 */
export function buildTeachingArtifacts(): Artifact[] {
  const hookPath = resolveHookPath();
  const standard = buildStandardArtifacts();

  // Standard artifacts without the trailing gitignore_entry (we re-append it last).
  const withoutGitignore = standard.slice(0, standard.length - 1);
  const gitignoreEntry = standard[standard.length - 1]!;

  // Subagent bodies from assets/subagents/
  const curatorBody = readSubagentAsset("logbook-curator");
  const teacherBody = readSubagentAsset("logbook-teacher");

  // Statusline command: invoke the CLI's state --inline subcommand.
  // __dirname at runtime = dist/cli/ → the CLI bundle is dist/cli/index.cjs.
  const cliAbsPath = path.resolve(__dirname, "index.cjs");
  const statuslineCommand = `node ${cliAbsPath} state --inline`;

  return [
    ...withoutGitignore,
    // 13. subagent — logbook-curator
    {
      kind: "subagent",
      name: "logbook-curator",
      file_path: ".claude/subagents/logbook-curator.md",
      body: curatorBody,
      _logbookId: "lb-agent-curator-001",
    },
    // 14. subagent — logbook-teacher
    {
      kind: "subagent",
      name: "logbook-teacher",
      file_path: ".claude/subagents/logbook-teacher.md",
      body: teacherBody,
      _logbookId: "lb-agent-teacher-001",
    },
    // 15. statusline
    {
      kind: "statusline",
      command: statuslineCommand,
      _logbookId: "lb-statusline-001",
    },
    // 16. hook (SessionStart) — distinct id from PostToolUse hook
    {
      kind: "hook",
      hookEvent: "SessionStart",
      command: `node ${hookPath}`,
      _logbookId: "lb-hook-sessionstart-001",
    },
    // 17. gitignore_entry (LAST — per iter1 install-order contract)
    gitignoreEntry,
  ];
}

/**
 * Dispatch to the correct artifact builder based on preset.
 * "minimal"  → iter1 baseline (hook + gitignore_entry).
 * "standard" → iter3 full set (14 manifest entries / 13 logical artifacts).
 *              Skill is 1 logical artifact composed of 2 files (SKILL.md + reference.md).
 * "teaching" → iter4 teaching preset (18 manifest entries):
 *              standard set + 2 subagents + statusline + SessionStart hook.
 * "full" is reserved for future use; falls back to teaching for now.
 */
export function buildArtifactsForPreset(preset: string): Artifact[] {
  if (preset === "teaching" || preset === "full") {
    return buildTeachingArtifacts();
  }
  if (preset === "standard") {
    return buildStandardArtifacts();
  }
  // Default: minimal
  return buildMinimalArtifacts();
}
