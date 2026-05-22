/**
 * logbook error — Record an error.
 *
 * Side effects:
 *  1. Appends a `user_entry` event (entryType: "error") to events.jsonl via
 *     appendEvent — redaction (including stack trace) is automatic at the chokepoint.
 *  2. Best-effort SQLite row in the `errors` table (resolved=0 by default).
 *  3. Prints JSON: { id }.
 *
 * Design §3 CLI command signatures — error row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { openIndex, closeIndex } from "../../store/sqlite.js";
import { generateUlid } from "../../util/ulid.js";

export default defineCommand({
  meta: {
    name: "error",
    description: "Record an error",
  },
  args: {
    kind: {
      type: "string",
      required: true,
      description: "Error taxonomy label",
    },
    message: {
      type: "string",
      required: true,
      description: "Error message",
    },
    stack: {
      type: "string",
      required: false,
      description: "Stack trace (will be redacted for secrets before storing)",
    },
    source: {
      type: "string",
      required: false,
      default: "manual",
      description: "agent|tool|hook|build|test|manual",
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

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    const kind = args["kind"] as string;
    const message = args["message"] as string;
    const rawStack = args["stack"] as string | undefined;
    const source = (args["source"] as string | undefined) ?? "manual";

    const id = generateUlid();
    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction of stack and all fields is automatic.
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId,
        payload: {
          entryType: "error",
          kind,
          message,
          source,
          ...(rawStack !== undefined && rawStack !== "" && { stack: rawStack }),
        },
        id,
        provider: "logbook-cli",
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Best-effort SQLite index row.
    let db: ReturnType<typeof openIndex> | undefined;
    try {
      db = openIndex(paths.indexDbPath);
      db.prepare(
        `INSERT INTO errors (id, session_id, timestamp, kind, message, source, resolved)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      ).run(id, sessionId || null, new Date().toISOString(), kind, message, source);
    } catch (err) {
      process.stderr.write(
        `warning: SQLite index failed (non-fatal) — ${err instanceof Error ? err.message : String(err)}\n`,
      );
    } finally {
      if (db) closeIndex(db);
    }

    process.stdout.write(JSON.stringify({ id }) + "\n");
    process.exit(0);
  },
});
