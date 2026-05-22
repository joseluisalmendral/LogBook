/**
 * logbook annotate <event-id> --note "..." — Append a manual annotation event.
 *
 * Side effects:
 *  1. Stream-scan events.jsonl to validate event-id exists.
 *     If not found → exit 1 with "error: no event with id <id>".
 *  2. Validate --note non-empty and ≤ 2000 chars (Valibot, exit 1 on failure).
 *  3. Capture getGitSha(root) if possible (best-effort, undefined on failure).
 *  4. Build and validate annotation input, then append via appendEvent — redaction
 *     is automatic at the chokepoint.
 *  5. Print JSON: { id, relatedEventId }.
 *
 * Design S6.1 — annotation contract.
 * CLI-only — NOT exposed as an MCP tool (proposal D1 hard constraint).
 */

import * as fs from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { defineCommand } from "citty";
import * as v from "valibot";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { generateUlid } from "../../util/ulid.js";
import { getGitSha } from "../../connectors/git.js";

// ---------------------------------------------------------------------------
// Valibot schema — exported for unit tests (annotation-schema.test.ts)
// Schema validates the pre-write input shape (not the stored Shape-A event).
// ---------------------------------------------------------------------------

export const AnnotationEventSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)),
  type: v.literal("manual.annotation"),
  ts: v.pipe(v.string(), v.isoTimestamp()),
  relatedEventId: v.pipe(v.string(), v.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)),
  note: v.pipe(v.string(), v.minLength(1), v.maxLength(2000)),
  gitSha: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/))),
});

export type AnnotationEvent = v.InferOutput<typeof AnnotationEventSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stream-scan events.jsonl for an event matching the given id.
 * Returns true if found, false if not found or file absent.
 * Malformed JSON lines are skipped silently (same behaviour as other commands).
 */
async function eventExists(eventsPath: string, id: string): Promise<boolean> {
  if (!fs.existsSync(eventsPath)) return false;

  return new Promise<boolean>((resolve) => {
    const rl = createInterface({
      input: createReadStream(eventsPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    let found = false;

    rl.on("line", (line) => {
      if (found) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as { id?: unknown };
        if (parsed.id === id) {
          found = true;
          rl.close();
        }
      } catch {
        // Skip malformed lines.
      }
    });

    rl.on("close", () => resolve(found));
    rl.on("error", () => resolve(false));
  });
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "annotate",
    description: "Append a manual annotation linked to an existing event",
  },
  args: {
    "event-id": {
      type: "positional",
      required: true,
      description: "ULID of the event to annotate",
    },
    note: {
      type: "string",
      required: true,
      description: "Annotation text (max 2000 characters)",
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
    const relatedEventId = args["event-id"] as string;
    const note = args["note"] as string | undefined;

    // Validate --note present and non-empty.
    if (!note || note.trim() === "") {
      process.stderr.write(
        `error: --note is required and must not be empty\n`,
      );
      process.exit(1);
    }

    // Validate note length.
    if (note.length > 2000) {
      process.stderr.write(
        `error: --note must be 2000 characters or fewer (got ${note.length})\n`,
      );
      process.exit(1);
    }

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    // Validate relatedEventId exists in events.jsonl.
    const exists = await eventExists(paths.eventsJsonl, relatedEventId);
    if (!exists) {
      process.stderr.write(
        `error: no event with id ${relatedEventId}\n`,
      );
      process.exit(1);
    }

    // Best-effort git SHA.
    let gitSha: string | undefined;
    try {
      gitSha = await getGitSha(root);
    } catch {
      // Degrade silently — non-git projects are fine.
    }

    // Build validation object (pre-write schema check on the logical input).
    const id = generateUlid();
    const ts = new Date().toISOString();

    const validationInput: Record<string, unknown> = {
      id,
      type: "manual.annotation",
      ts,
      relatedEventId,
      note,
      ...(gitSha !== undefined && { gitSha }),
    };

    // Validate against schema before writing.
    const validation = v.safeParse(AnnotationEventSchema, validationInput);
    if (!validation.success) {
      const messages = v.flatten(validation.issues);
      process.stderr.write(
        `error: annotation event failed validation — ${JSON.stringify(messages)}\n`,
      );
      process.exit(1);
    }

    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId,
        payload: {
          entryType: "annotation",
          relatedEventId,
          note,
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

    process.stdout.write(JSON.stringify({ id, relatedEventId }) + "\n");
    process.exit(0);
  },
});
