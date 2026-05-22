/**
 * logbook lesson — Record a lesson learned.
 *
 * Side effects:
 *  1. Appends a `user_entry` event (entryType: "lesson") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  2. Best-effort SQLite row in the `lessons` table.
 *  3. Prints JSON: { id }.
 *
 * Design §3 CLI command signatures — lesson row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { openIndex, closeIndex } from "../../store/sqlite.js";
import { generateUlid } from "../../util/ulid.js";

/** Defensive comma-split: handles empty strings, single values, whitespace. */
function splitComma(s: string | undefined): string[] {
  if (!s || !s.trim()) return [];
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export default defineCommand({
  meta: {
    name: "lesson",
    description: "Record a lesson learned",
  },
  args: {
    title: {
      type: "string",
      required: true,
      description: "Lesson title",
    },
    body: {
      type: "string",
      required: true,
      description: "Lesson body / description",
    },
    tags: {
      type: "string",
      required: false,
      description: "Comma-separated tags",
    },
    promotable: {
      type: "boolean",
      default: false,
      description: "Mark as promotable to documentation",
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

    const title = args["title"] as string;
    const body = args["body"] as string;
    const tags = splitComma(args["tags"] as string | undefined);
    const promotable = Boolean(args["promotable"]);

    const id = generateUlid();
    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId,
        payload: { entryType: "lesson", title, body, tags, promotable },
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
        `INSERT INTO lessons (id, session_id, timestamp, title, promotable, tags_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        sessionId || null,
        new Date().toISOString(),
        title,
        promotable ? 1 : 0,
        tags.length > 0 ? JSON.stringify(tags) : null,
      );
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
