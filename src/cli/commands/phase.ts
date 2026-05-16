/**
 * logbook phase <name> — Set the active LogBook phase.
 *
 * Side effects:
 *  1. Appends a `manual.phase` event to events.jsonl.
 *  2. Writes state.currentPhase atomically.
 *  3. Prints JSON: { phase }.
 *
 * Design §3 CLI command signatures — phase row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState, writeState } from "../../core/state.js";
import { appendJsonl } from "../../store/jsonl.js";
import { generateUlid } from "../../util/ulid.js";

export default defineCommand({
  meta: {
    name: "phase",
    description: "Set the active LogBook phase",
  },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Phase name (e.g. 'design', 'apply', 'verify')",
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
    const phaseName = args["name"] as string;

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    const event = {
      id: generateUlid(),
      type: "manual.phase",
      ts: new Date().toISOString(),
      phase: phaseName,
    };

    try {
      await appendJsonl(paths.eventsJsonl, JSON.stringify(event));
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Update state.currentPhase.
    try {
      const state = readState(paths.statePath);
      state.currentPhase = phaseName;
      writeState(paths.statePath, state);
    } catch (err) {
      process.stderr.write(
        `error: failed to write state — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    process.stdout.write(JSON.stringify({ phase: phaseName }) + "\n");
    process.exit(0);
  },
});
