/**
 * logbook resource — Attach a resource (url, file, snippet, doc).
 *
 * Side effects:
 *  1. Validates kind ∈ {url, file, snippet, doc} — exits 1 with stderr on failure.
 *  2. For kind=file: asserts path is within project root (security guard).
 *  3. Appends a `manual.resource` event to events.jsonl.
 *     Event uses TOP-LEVEL fields (T10b.D1 convention).
 *  4. Best-effort SQLite row in the `resources` table.
 *  5. Prints JSON: { id }.
 *
 * Design §3 CLI command signatures — resource row.
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { appendJsonl } from "../../store/jsonl.js";
import { openIndex, closeIndex } from "../../store/sqlite.js";
import { generateUlid } from "../../util/ulid.js";
import { assertWithinProject } from "../../util/path-confine.js";

const VALID_KINDS = new Set(["url", "file", "snippet", "doc"]);

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
    name: "resource",
    description: "Attach a resource (url, file, snippet, doc)",
  },
  args: {
    kind: {
      type: "string",
      required: true,
      description: "url|file|snippet|doc",
    },
    uri: {
      type: "string",
      required: true,
      description: "URI or path to the resource",
    },
    title: {
      type: "string",
      required: false,
      description: "Optional title for the resource",
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
    const kind = args["kind"] as string;
    const uri = args["uri"] as string;
    const title = args["title"] as string | undefined;
    const tags = splitComma(args["tags"] as string | undefined);

    // Validate kind.
    if (!VALID_KINDS.has(kind)) {
      process.stderr.write(
        `error: invalid kind "${kind}" — must be one of: url, file, snippet, doc\n`,
      );
      process.exit(1);
    }

    // Security guard for file kind.
    if (kind === "file") {
      try {
        assertWithinProject(uri, root);
      } catch (err) {
        process.stderr.write(
          `error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    }

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    const id = generateUlid();
    const ts = new Date().toISOString();

    // Build event — TOP-LEVEL fields (T10b.D1 convention).
    const event: Record<string, unknown> = {
      id,
      type: "manual.resource",
      ts,
      kind,
      uri,
      tags,
      ...(title !== undefined && title !== "" && { title }),
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
      db.prepare(
        `INSERT INTO resources (id, kind, uri, title, added_at, tags_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        kind,
        uri,
        title ?? null,
        ts,
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
