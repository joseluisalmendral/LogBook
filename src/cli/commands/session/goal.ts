/**
 * logbook session goal <text> — Record a session goal.
 *
 * Persists a user_entry event with entryType "session_goal" tied to the
 * current session. Later writes for the same session win (latest-write-wins
 * per ADR-7). Sessions HTML renders the last goal above the timeline.
 *
 * Validation: text must be 1–500 chars.
 * Side effects: appendEvent → redaction fires automatically.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { readState } from "../../../core/state.js";
import { appendEvent } from "../../../store/index.js";
import { generateUlid } from "../../../util/ulid.js";

export default defineCommand({
  meta: {
    name: "goal",
    description: "Record a goal for the current session",
  },
  args: {
    text: {
      type: "positional",
      required: true,
      description: "Session goal text (1–500 chars)",
    },
  },
  async run({ args }) {
    const text = String(args["text"] ?? "").trim();

    // Validate length.
    if (text.length === 0) {
      process.stderr.write("error: goal text must not be empty\n");
      process.exit(1);
    }
    if (text.length > 500) {
      process.stderr.write(
        `error: goal text is too long (${text.length} chars, max 500)\n`,
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
    const state = readState(paths.statePath);

    // Guard: require an active session.
    if (!state.session) {
      process.stderr.write(
        "error: no active session; run `logbook start` first\n",
      );
      process.exit(1);
    }

    const sessionId = state.session;
    const id = generateUlid();

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    try {
      await appendEvent(paths, {
        id,
        kind: "user_entry",
        sessionId,
        payload: {
          entryType: "session_goal",
          text,
        },
        provider: "logbook-cli",
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    process.stdout.write(JSON.stringify({ id, sessionId, text }) + "\n");
    process.exit(0);
  },
});
