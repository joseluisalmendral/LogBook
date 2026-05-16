/**
 * logbook promote <event-id> --teaching {high|medium|low} [--json]
 *
 * Mutates the teachingValue on a stored event by:
 *  1. Validating --teaching ∈ {high, medium, low}; exits 1 on invalid value.
 *  2. Scanning events.jsonl to confirm the event-id exists; exits 1 if not found.
 *  3. Appending a `manual.promote` event to events.jsonl (canonical audit trail).
 *  4. Best-effort SQLite UPDATE (T9.D1: schema.ts events table does not have a
 *     teaching_value column; skip SQLite entirely and rely on JSONL only).
 *
 * T9.D1 decision: no schema migration in T9. The JSONL is canonical. SQLite UPDATE
 * is skipped because the events table (schema v1) has no teaching_value column.
 * This keeps T9 narrow and avoids migration complexity. T13 or a later slice can
 * add the column and backfill if needed.
 *
 * Output (--json):
 *   { id: string; eventId: string; teachingValue: "high"|"medium"|"low" }
 *
 * Exit codes:
 *   0 → success
 *   1 → validation error, event not found, or I/O failure
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { appendJsonl } from "../../store/jsonl.js";
import { generateUlid } from "../../util/ulid.js";

/** Valid teaching values (ordered for UX display). */
const VALID_TEACHING_VALUES = ["high", "medium", "low"] as const;
type TeachingValue = (typeof VALID_TEACHING_VALUES)[number];

function isTeachingValue(v: unknown): v is TeachingValue {
  return VALID_TEACHING_VALUES.includes(v as TeachingValue);
}

/**
 * Scan events.jsonl line-by-line looking for an event with the given id.
 * Returns true if found, false otherwise.
 * O(n) — acceptable for iter3 project sizes.
 */
function eventExistsInJsonl(eventsJsonlPath: string, eventId: string): boolean {
  if (!fs.existsSync(eventsJsonlPath)) return false;

  const content = fs.readFileSync(eventsJsonlPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed["id"] === eventId) return true;
    } catch {
      // Skip malformed lines
    }
  }
  return false;
}

export default defineCommand({
  meta: {
    name: "promote",
    description: "Set the teachingValue on a stored event",
  },
  args: {
    "event-id": {
      type: "positional",
      required: true,
      description: "ULID of the event to promote",
    },
    teaching: {
      type: "string",
      required: true,
      description: "Teaching value: high | medium | low",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    // 1. Validate --teaching value
    const teachingRaw = args["teaching"] as string | undefined;
    if (!isTeachingValue(teachingRaw)) {
      process.stderr.write(
        `error: --teaching must be one of: ${VALID_TEACHING_VALUES.join(", ")} (got: ${String(teachingRaw)})\n`,
      );
      process.exit(1);
    }
    const teachingValue: TeachingValue = teachingRaw;

    // 2. Validate --teaching is present (citty handles required, but guard defensively)
    if (!teachingValue) {
      process.stderr.write(`error: --teaching is required\n`);
      process.exit(1);
    }

    const eventId = args["event-id"] as string;

    // 3. Resolve project root and paths
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

    // 4. Scan events.jsonl to confirm the event exists
    if (!eventExistsInJsonl(paths.eventsJsonl, eventId)) {
      process.stderr.write(`error: event not found: ${eventId}\n`);
      process.exit(1);
    }

    // 5. Build the manual.promote event (top-level fields; T3 convention)
    const promoteId = generateUlid();
    const ts = new Date().toISOString();
    const promoteEvent = {
      id: promoteId,
      type: "manual.promote",
      ts,
      eventId,
      teachingValue,
      source: "cli",
    };

    // 6. Append to events.jsonl
    try {
      await appendJsonl(paths.eventsJsonl, JSON.stringify(promoteEvent));
    } catch (err) {
      process.stderr.write(
        `error: failed to append promote event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // 7. Best-effort SQLite UPDATE (T9.D1: skipped — no teaching_value column in v1 schema)
    // When T13 adds the column, this block will be:
    //   db.prepare("UPDATE events SET teaching_value = ? WHERE id = ?").run(teachingValue, eventId)
    // For now, JSONL is the canonical store and this is a no-op.

    // 8. Output result
    const result = { id: promoteId, eventId, teachingValue };

    if (args["json"]) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(
        `promoted event ${eventId} with teachingValue=${teachingValue} (promote id: ${promoteId})\n`,
      );
    }

    process.exit(0);
  },
});
