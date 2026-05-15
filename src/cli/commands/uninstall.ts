/**
 * logbook uninstall — remove LogBook artifacts (data preserved).
 *
 * Safety guard: --force is required unless --dry-run is used.
 * After uninstall, deletes the manifest file when all artifacts are gone.
 * Handles sentinel backups (empty sha256 = file did not exist pre-install).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { runUninstall } from "../../core/uninstall-engine.js";
import { readManifest } from "../../core/manifest.js";
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

    // Capture manifest before uninstall (for sentinel handling)
    const manifestBefore = readManifest(paths.manifestPath);

    let result: Awaited<ReturnType<typeof runUninstall>>;
    try {
      result = await runUninstall({
        paths,
        dryRun,
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

    // Post-uninstall cleanup:

    // 1. Handle sentinel backups: files with empty sha256 did not exist before install
    //    → delete them after uninstall.
    if (manifestBefore) {
      for (const backup of manifestBefore.backups) {
        if (backup.sha256 === "") {
          // Sentinel: file did not exist before install — delete it now.
          const absPath = path.join(paths.root, backup.file_path);
          try {
            if (fs.existsSync(absPath)) {
              fs.rmSync(absPath);
            }
          } catch {
            // Best-effort; do not fail the uninstall.
          }
        }
      }
    }

    // 2. After all artifacts are gone, delete manifest file.
    //    The engine leaves an empty-artifact manifest on disk; we delete it here.
    const manifestAfter = readManifest(paths.manifestPath);
    if (manifestAfter !== null && manifestAfter.artifacts.length === 0) {
      try {
        fs.rmSync(paths.manifestPath, { force: true });
      } catch {
        // Best-effort.
      }
    }

    process.stdout.write("LogBook uninstalled. Data preserved under .logbook/ and logbook/.\n");
  },
});
