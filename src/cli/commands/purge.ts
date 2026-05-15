/**
 * logbook purge — uninstall AND delete all LogBook data (DESTRUCTIVE).
 *
 * Requires --force. After uninstall, removes .logbook/ and logbook/ entirely.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { runUninstall } from "../../core/uninstall-engine.js";
import { readManifest } from "../../core/manifest.js";

export default defineCommand({
  meta: {
    name: "purge",
    description: "Uninstall and delete all LogBook data (DESTRUCTIVE)",
  },
  args: {
    force: {
      type: "boolean",
      default: false,
      description: "Required — acknowledges data loss",
    },
  },
  async run({ args }) {
    if (!args["force"]) {
      process.stderr.write(
        "error: --force is required for purge. This will delete all LogBook data.\n",
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

    // Capture manifest before uninstall for sentinel handling
    const manifestBefore = readManifest(paths.manifestPath);

    // Run uninstall (artifact removal)
    try {
      await runUninstall({ paths, dryRun: false });
    } catch {
      // Best-effort on purge — continue to delete data dirs regardless.
    }

    // Handle sentinel backups
    if (manifestBefore) {
      for (const backup of manifestBefore.backups) {
        if (backup.sha256 === "") {
          const absPath = path.join(paths.root, backup.file_path);
          try {
            if (fs.existsSync(absPath)) {
              fs.rmSync(absPath);
            }
          } catch {
            // Best-effort.
          }
        }
      }
    }

    // Delete manifest file if still present
    try {
      if (fs.existsSync(paths.manifestPath)) {
        fs.rmSync(paths.manifestPath, { force: true });
      }
    } catch {
      // Best-effort.
    }

    // Delete .logbook/ entirely
    try {
      fs.rmSync(paths.logbookDir, { recursive: true, force: true });
    } catch {
      // Best-effort.
    }

    // Delete logbook/ data directory entirely
    try {
      fs.rmSync(paths.dataDir, { recursive: true, force: true });
    } catch {
      // Best-effort.
    }

    process.stdout.write("Purged.\n");
  },
});
