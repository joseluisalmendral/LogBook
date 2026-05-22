/**
 * logbook session rename <new> — Rename the current session label.
 *
 * Side effects:
 *  1. Validates an active session exists (exits 1 if none).
 *  2. Appends a `system` event (entryType: "session_rename") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  3. Writes state.sessionLabel.
 *  4. Prints JSON: { old, new }.
 *
 * Design §3 CLI command signatures — session rename row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { readState, writeState } from "../../../core/state.js";
import { appendEvent } from "../../../store/index.js";
import { generateUlid } from "../../../util/ulid.js";

export default defineCommand({
  meta: {
    name: "rename",
    description: "Rename the current session label",
  },
  args: {
    new: {
      type: "positional",
      required: true,
      description: "New label for the current session",
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
    const state = readState(paths.statePath);

    // Guard: require an active session.
    if (!state.session) {
      process.stderr.write(
        "error: no active session; run `logbook start` first\n",
      );
      process.exit(1);
    }

    const sessionId = state.session;
    const oldLabel = state.sessionLabel ?? "";
    const newLabel = args["new"] as string;

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "system",
        sessionId,
        payload: {
          entryType: "session_rename",
          sessionId,
          old: oldLabel,
          new: newLabel,
        },
        id: generateUlid(),
        provider: "logbook-cli",
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Update state.sessionLabel.
    try {
      const freshState = readState(paths.statePath);
      freshState.sessionLabel = newLabel;
      writeState(paths.statePath, freshState);
    } catch (err) {
      process.stderr.write(
        `error: failed to write state — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    process.stdout.write(JSON.stringify({ old: oldLabel, new: newLabel }) + "\n");
    process.exit(0);
  },
});
