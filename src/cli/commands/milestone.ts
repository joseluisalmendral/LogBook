/**
 * logbook milestone — Record a milestone.
 *
 * Side effects:
 *  1. Appends a `user_entry` event (entryType: "milestone") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  2. Best-effort SQLite row in the `milestones` table.
 *  3. Prints JSON: { id }.
 *
 * Design §3 CLI command signatures — milestone row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { openIndex, closeIndex } from "../../store/sqlite.js";
import { generateUlid } from "../../util/ulid.js";
import { getGitSha } from "../../connectors/git.js";

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
    name: "milestone",
    description: "Record a milestone",
  },
  args: {
    title: {
      type: "string",
      required: true,
      description: "Milestone title",
    },
    description: {
      type: "string",
      required: true,
      description: "Milestone description",
    },
    "session-ids": {
      type: "string",
      required: false,
      description: "Comma-separated session ids",
    },
    "decision-ids": {
      type: "string",
      required: false,
      description: "Comma-separated decision ids",
    },
    tags: {
      type: "string",
      required: false,
      description: "Comma-separated tags",
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
    const description = args["description"] as string;
    const sessionIds = splitComma(args["session-ids"] as string | undefined);
    const decisionIds = splitComma(args["decision-ids"] as string | undefined);
    const tags = splitComma(args["tags"] as string | undefined);

    const id = generateUlid();

    // Best-effort gitSha (v1.1 S2.3): fresh subprocess for manual commands.
    let gitSha: string | undefined;
    try {
      gitSha = await getGitSha(root);
    } catch {
      // Degrade silently — git unavailable or not a repo is fine.
    }

    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId,
        payload: {
          entryType: "milestone",
          title,
          description,
          sessionIds,
          decisionIds,
          tags,
          ...(gitSha !== undefined && { gitSha }),
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
        `INSERT INTO milestones (id, timestamp, title, tags_json)
         VALUES (?, ?, ?, ?)`,
      ).run(
        id,
        new Date().toISOString(),
        title,
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
