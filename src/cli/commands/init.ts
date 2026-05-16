/**
 * logbook init — install LogBook artifacts into the current project.
 *
 * Preset "minimal" (iter1): one PostToolUse hook + one .gitignore entry.
 * Preset "standard" (iter3): 14 manifest entries / 13 logical artifacts.
 *   Install order per design §6 (deterministic):
 *     1.  hook
 *     2.  mcp_server
 *     3.  augment_claudemd
 *     4-11. slash_command × 8 (lb-decision, lb-error, lb-fix, lb-lesson,
 *                               lb-milestone, lb-phase, lb-review, lb-status)
 *     12. skill (SKILL.md — logbook-auto-capture body)
 *     13. skill (reference.md — logbook-auto-capture reference, on-demand)
 *     14. gitignore_entry (LAST)
 *
 * Logical vs manifest: Skill is 1 logical artifact in 2 files (2 manifest entries).
 * User-facing summary reports 13 logical artifacts.
 *
 * Artifact builders extracted to src/core/presets.ts (iter6 T1).
 */

import * as readline from "node:readline";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { runInstall } from "../../core/install-engine.js";
import { writeState, readState } from "../../core/state.js";
import { renderTable } from "../render.js";
import { buildArtifactsForPreset } from "../../core/presets.js";

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
      description: "minimal | standard | teaching | full",
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
        preset: (preset === "teaching" || preset === "full") ? "teaching" : (preset === "standard") ? "standard" : "minimal",
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
