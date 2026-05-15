/**
 * logbook disable — soft-disable LogBook hooks without removing artifacts.
 *
 * Sets state.disabled = true. The hook checks this flag at startup and
 * exits immediately when true (hot-path degrades silently).
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState, writeState } from "../../core/state.js";

export default defineCommand({
  meta: {
    name: "disable",
    description: "Soft-disable LogBook hooks without removing artifacts",
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
    state.disabled = true;
    writeState(paths.statePath, state);

    process.stdout.write("LogBook disabled. Hooks will exit immediately.\n");
  },
});
