/**
 * logbook init — install LogBook artifacts into the current project.
 *
 * Preset "minimal" (iter1): one PostToolUse hook + one .gitignore entry.
 * Preset "standard" (iter2): hook + mcp_server + augment_claudemd + 8 slash_command × + gitignore_entry.
 *   Install order per design §6 (deterministic):
 *     1. hook
 *     2. mcp_server
 *     3. augment_claudemd
 *     4-11. slash_command × 8 (lb-decision, lb-error, lb-fix, lb-lesson,
 *                               lb-milestone, lb-phase, lb-review, lb-status)
 *     12. gitignore_entry (LAST)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { runInstall } from "../../core/install-engine.js";
import { writeState, readState } from "../../core/state.js";
import { renderTable } from "../render.js";
import type { Artifact } from "../../types/artifact.js";

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
  // __dirname in CJS output → dist/cli
  return path.resolve(__dirname, "../connectors/claude-code/hook.cjs");
}

// ---------------------------------------------------------------------------
// MCP server path resolution.
// Production: dist/cli/index.cjs → __dirname = dist/cli/
//             server is at dist/mcp/server.cjs
// Tests: override via LOGBOOK_MCP_SERVER_PATH env var (same pattern as T4).
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
  const assetsRoot = process.env["LOGBOOK_ASSETS_ROOT"] ??
    path.resolve(__dirname, "../../assets");
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
// Artifact builders
// ---------------------------------------------------------------------------

function buildMinimalArtifacts(): Artifact[] {
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
function buildStandardArtifacts(): Artifact[] {
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
    // 12. gitignore_entry (LAST — per iter1 install-order contract)
    {
      kind: "gitignore_entry",
      file_path: ".gitignore",
      lines: [".logbook/", "logbook/", "# lb-gitignore-001"],
    },
  ];
}

/**
 * Dispatch to the correct artifact builder based on preset.
 * "minimal" → iter1 baseline (hook + gitignore_entry).
 * "standard" → iter2 full set (11 artifacts).
 * "full" is reserved for iter3+; falls back to standard for now.
 */
function buildArtifactsForPreset(preset: string): Artifact[] {
  if (preset === "standard" || preset === "full") {
    return buildStandardArtifacts();
  }
  // Default: minimal
  return buildMinimalArtifacts();
}

async function confirmPrompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

export default defineCommand({
  meta: {
    name: "init",
    description: "Install LogBook artifacts into the current project",
  },
  args: {
    preset: {
      type: "string",
      default: "minimal",
      description: "minimal | standard | full (iter1: only minimal honored)",
    },
    yes: {
      type: "boolean",
      default: false,
      description: "Skip confirmation prompt",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Plan-only; no writes",
    },
  },
  async run({ args }) {
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const paths = makePaths(root);
    bootstrapClaudeCodeInstallers();

    const preset = (args["preset"] as string) || "minimal";
    const artifacts = buildArtifactsForPreset(preset);
    const dryRun = args["dry-run"] as boolean;
    const skipConfirm = args["yes"] as boolean;

    // Prompt if: not --yes, not --dry-run, stdin is a TTY
    if (!skipConfirm && !dryRun && process.stdin.isTTY) {
      const proceed = await confirmPrompt(
        "Install LogBook artifacts into this project? [y/N] ",
      );
      if (!proceed) {
        process.stdout.write("Aborted.\n");
        process.exit(0);
      }
    }

    let result: Awaited<ReturnType<typeof runInstall>>;
    try {
      result = await runInstall({
        paths,
        preset: (preset === "standard" || preset === "full") ? "standard" : "minimal",
        artifacts,
        dryRun,
        onReport(report) {
          if (report.warnings.length > 0) {
            for (const w of report.warnings) {
              process.stderr.write(`warning: ${w}\n`);
            }
          }
        },
      });
    } catch (err) {
      process.stderr.write(
        `error: install failed — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Ensure state.json exists with disabled: false
    if (!dryRun) {
      const state = readState(paths.statePath);
      writeState(paths.statePath, state);
    }

    // Print summary
    if (dryRun) {
      process.stdout.write("Dry run — no files written.\n");
      const planRows = result.report.rows.map((r) => [r.kind, r.filePath, r.action]);
      process.stdout.write(
        renderTable(
          [
            { header: "kind" },
            { header: "file" },
            { header: "action" },
          ],
          planRows,
        ),
      );
    } else {
      const summary: string[][] = [];
      for (const a of result.installed) {
        summary.push([a.kind, a.file_path, "installed"]);
      }
      for (const s of result.skipped) {
        summary.push([s.artifact.kind, "", "skipped"]);
      }

      if (summary.length > 0) {
        process.stdout.write(
          renderTable(
            [
              { header: "kind" },
              { header: "file" },
              { header: "result" },
            ],
            summary,
          ),
        );
      }
      process.stdout.write("LogBook installed.\n");
    }
  },
});
