/**
 * logbook phase <name> — Set the active LogBook phase.
 *
 * Side effects:
 *  1. Appends a `system` event (entryType: "phase_change") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  2. Writes state.currentPhase atomically.
 *  3. Prints JSON: { phase }.
 *
 * Design §3 CLI command signatures — phase row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState, writeState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
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

    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "system",
        sessionId,
        payload: { entryType: "phase_change", phase: phaseName },
        phase: phaseName,
        provider: "logbook-cli",
        id: generateUlid(),
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Update state.currentPhase.
    try {
      const freshState = readState(paths.statePath);
      freshState.currentPhase = phaseName;
      writeState(paths.statePath, freshState);
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
