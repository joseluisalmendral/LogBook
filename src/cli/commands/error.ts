/**
 * logbook error — Record an error.
 *
 * Side effects:
 *  1. Applies redaction to `stack` BEFORE persisting (MANDATORY per spec §31 +
 *     T10b assignment — stack may contain secrets like API keys).
 *  2. Appends a `manual.error` event to events.jsonl.
 *     Event uses TOP-LEVEL fields (T10b.D1 convention).
 *  3. Best-effort SQLite row in the `errors` table (resolved=0 by default).
 *  4. Prints JSON: { id }.
 *
 * Design §3 CLI command signatures — error row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendJsonl } from "../../store/jsonl.js";
import { openIndex, closeIndex } from "../../store/sqlite.js";
import { generateUlid } from "../../util/ulid.js";
import { redact } from "../../redact/index.js";

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

    // MANDATORY: redact the stack trace before persisting (may contain secrets).
    const safeStack =
      rawStack !== undefined && rawStack !== ""
        ? redact(rawStack).redacted
        : undefined;

    const id = generateUlid();
    const ts = new Date().toISOString();

    // Build event — TOP-LEVEL fields (T10b.D1 convention).
    const event: Record<string, unknown> = {
      id,
      type: "manual.error",
      ts,
      kind,
      message,
      source,
      ...(safeStack !== undefined && { stack: safeStack }),
    };

    try {
      await appendJsonl(paths.eventsJsonl, JSON.stringify(event));
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
      const state = readState(paths.statePath);
      const sessionId = state.session ?? "";
      db.prepare(
        `INSERT INTO errors (id, session_id, timestamp, kind, message, source, resolved)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      ).run(id, sessionId, ts, kind, message, source);
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
