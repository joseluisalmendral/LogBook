/**
 * logbook init — install LogBook artifacts into the current project.
 *
 * Preset "minimal" (iter1): one PostToolUse hook + one .gitignore entry.
 * Other presets are accepted for forward-compat but behave like minimal.
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

    // iter1: all presets map to minimal artifact set
    const artifacts = buildMinimalArtifacts();
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
        preset: "minimal",
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
