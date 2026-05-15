/**
 * logbook status — show installed artifacts and recent activity.
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readManifest } from "../../core/manifest.js";
import { readState } from "../../core/state.js";
import { renderTable, renderKv, renderJson } from "../render.js";

export default defineCommand({
  meta: {
    name: "status",
    description: "Show installed artifacts and recent activity",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Output as JSON",
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
    const manifest = readManifest(paths.manifestPath);

    if (manifest === null) {
      process.stdout.write("LogBook not installed.\n");
      process.exit(0);
    }

    const state = readState(paths.statePath);

    if (args["json"]) {
      process.stdout.write(renderJson({ manifest, state }));
      return;
    }

    // Artifact table
    const rows = manifest.artifacts.map((a) => [
      a.id,
      a.kind,
      a.file_path,
      a.installed_at,
    ]);

    process.stdout.write(
      renderTable(
        [
          { header: "id" },
          { header: "kind" },
          { header: "file" },
          { header: "installed_at" },
        ],
        rows,
      ),
    );

    // State kv
    process.stdout.write(
      renderKv([
        ["disabled", String(state.disabled)],
        ["warnings", String(state.warnings.length)],
        ["preset", manifest.preset],
      ]),
    );
  },
});
