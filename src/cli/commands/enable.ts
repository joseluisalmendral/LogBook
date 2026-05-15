/**
 * logbook enable — re-enable LogBook hooks after a disable.
 *
 * Sets state.disabled = false.
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState, writeState } from "../../core/state.js";

export default defineCommand({
  meta: {
    name: "enable",
    description: "Re-enable LogBook hooks",
  },
  async run() {
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
    const state = readState(paths.statePath);
    state.disabled = false;
    writeState(paths.statePath, state);

    process.stdout.write("LogBook enabled.\n");
  },
});
