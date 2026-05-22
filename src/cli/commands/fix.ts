/**
 * logbook fix — Link a fix to an error.
 *
 * Side effects:
 *  1. Appends a `user_entry` event (entryType: "fix") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  2. Best-effort SQLite: inserts into `fixes` table; if --verified, also
 *     UPDATEs errors SET resolved=1, fix_id=<id> WHERE id=<error-id>.
 *  3. Prints JSON: { id, errorId }.
 *
 * Note: `error-id` is the citty arg name (with hyphen); accessed via args["error-id"].
 *
 * Design §3 CLI command signatures — fix row.
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
    name: "fix",
    description: "Link a fix to an error",
  },
  args: {
    "error-id": {
      type: "string",
      required: true,
      description: "ULID of the error this fixes",
    },
    description: {
      type: "string",
      required: true,
      description: "Description of the fix",
    },
    verified: {
      type: "boolean",
      default: false,
      description: "Mark error as resolved/verified",
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

    const errorId = args["error-id"] as string;
    const description = args["description"] as string;
    // citty boolean args: presence of --verified flag sets it to true.
    const verified = Boolean(args["verified"]);

    const id = generateUlid();
    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId,
        payload: { entryType: "fix", errorId, description, verified },
        id,
        provider: "logbook-cli",
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Best-effort SQLite.
    let db: ReturnType<typeof openIndex> | undefined;
    try {
      db = openIndex(paths.indexDbPath);

      db.prepare(
        `INSERT INTO fixes (id, error_id, timestamp, verified) VALUES (?, ?, ?, ?)`,
      ).run(id, errorId, new Date().toISOString(), verified ? 1 : 0);

      if (verified) {
        db.prepare(`UPDATE errors SET resolved=1, fix_id=? WHERE id=?`).run(
          id,
          errorId,
        );
      }
    } catch (err) {
      process.stderr.write(
        `warning: SQLite index failed (non-fatal) — ${err instanceof Error ? err.message : String(err)}\n`,
      );
    } finally {
      if (db) closeIndex(db);
    }

    process.stdout.write(JSON.stringify({ id, errorId }) + "\n");
    process.exit(0);
  },
});
