/**
 * logbook purge — uninstall AND delete all LogBook data (DESTRUCTIVE).
 *
 * Requires --force. After uninstall, removes .logbook/ and logbook/ entirely.
 * Sentinel-backup cleanup + manifest deletion are handled INSIDE runUninstall().
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { runUninstall } from "../../core/uninstall-engine.js";

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

    // Run uninstall (artifact removal). Purge is "wipe everything" — it must
    // remove all artifacts even when content has drifted, so we pass force.
    // The engine handles sentinel-backup cleanup and manifest deletion.
    try {
      await runUninstall({ paths, dryRun: false, force: true });
    } catch {
      // Best-effort on purge — continue to delete data dirs regardless.
    }

    // Defensive: if the engine left the manifest behind for any reason
    // (e.g. it crashed mid-flight), purge force-deletes it. The engine's
    // own logic only deletes when artifacts.length === 0, so this catches
    // the partial-uninstall case where purge wants a clean slate anyway.
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
