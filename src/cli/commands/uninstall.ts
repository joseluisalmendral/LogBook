/**
 * logbook uninstall — remove LogBook artifacts (data preserved).
 *
 * Safety guard: --force is required unless --dry-run is used.
 *
 * Sentinel-backup cleanup (delete files LogBook created from nothing) and
 * manifest-file deletion are handled INSIDE runUninstall(). The CLI is a thin
 * wrapper around the engine.
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { runUninstall } from "../../core/uninstall-engine.js";
import { renderTable } from "../render.js";

export default defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove LogBook artifacts (data preserved)",
  },
  args: {
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Plan-only; no writes",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Required when not in --dry-run mode",
    },
  },
  async run({ args }) {
    const dryRun = args["dry-run"] as boolean;
    const force = args["force"] as boolean;

    // Safety guard
    if (!dryRun && !force) {
      process.stderr.write(
        "error: --force is required to uninstall. Use --dry-run to preview.\n",
      );
      process.exit(1);
    }

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

    try {
      await runUninstall({
        paths,
        dryRun,
        force,
        onReport(rows) {
          if (rows.length > 0) {
            const tableRows = rows.map((r) => [r.id, r.kind, r.filePath, r.status]);
            process.stdout.write(
              renderTable(
                [
                  { header: "id" },
                  { header: "kind" },
                  { header: "file" },
                  { header: "status" },
                ],
                tableRows,
              ),
            );
          }
        },
      });
    } catch (err) {
      process.stderr.write(
        `error: uninstall failed — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    if (dryRun) {
      process.stdout.write("Dry run — no files modified.\n");
      return;
    }

    process.stdout.write("LogBook uninstalled. Data preserved under .logbook/ and logbook/.\n");
  },
});
