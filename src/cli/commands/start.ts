/**
 * logbook start — Open a new LogBook session.
 *
 * Side effects:
 *  1. Generates a ULID session id.
 *  2. Ensures .logbook/ and logbook/evidence/ directories exist.
 *  3. Appends a `system` event (entryType: "session_start") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  4. Writes state.session (and optionally state.sessionLabel).
 *  5. Prints JSON: { sessionId, label? }.
 *
 * Design §3 CLI command signatures — start row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState, writeState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { generateUlid } from "../../util/ulid.js";

export default defineCommand({
  meta: {
    name: "start",
    description: "Open a new LogBook session",
  },
  args: {
    label: {
      type: "string",
      required: false,
      description: "Optional human-readable session label",
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

    // Ensure required directories exist.
    fs.mkdirSync(paths.logbookDir, { recursive: true });
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    const sessionId = generateUlid();
    const label = args["label"] as string | undefined;

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "system",
        sessionId,
        payload: {
          entryType: "session_start",
          sessionId,
          ...(label !== undefined && label !== "" && { label }),
        },
        provider: "logbook-cli",
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Update state.json.
    try {
      const state = readState(paths.statePath);
      state.session = sessionId;
      if (label !== undefined && label !== "") {
        state.sessionLabel = label;
      } else {
        // Clear any prior label when starting without one.
        delete state.sessionLabel;
      }
      writeState(paths.statePath, state);
    } catch (err) {
      process.stderr.write(
        `error: failed to write state — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Print result.
    const output: Record<string, unknown> = { sessionId };
    if (label !== undefined && label !== "") output["label"] = label;
    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(0);
  },
});
