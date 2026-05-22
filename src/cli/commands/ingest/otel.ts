/**
 * logbook ingest otel <file>
 *
 * Parse an OTLP-JSON file (single envelope or JSONL — one envelope per line)
 * and append normalized events to events.jsonl.
 *
 * Design:
 *  - Defensive: never crashes on malformed input (exit 0, ingested=0).
 *  - Path-confined: file must be within the project root (exit 1 on escape).
 *  - Redaction runs before every persist (consistent with iter2 ingest pipeline).
 */

import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { readState } from "../../../core/state.js";
import { assertWithinProject } from "../../../util/path-confine.js";
import { normalizeOtelEnvelope } from "../../../otel/normalize.js";
import { appendEvent } from "../../../store/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse file content as one or more OTLP-JSON envelopes.
 *
 * Strategy:
 *  1. Try the whole content as a single JSON object.
 *  2. On parse failure, treat each non-empty line as a separate envelope (JSONL).
 *  3. Lines that fail JSON.parse are silently skipped.
 *
 * Returns an array of parsed (unknown) envelopes — never throws.
 */
function parseEnvelopes(content: string): unknown[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Attempt 1: single JSON envelope
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return [parsed];
  } catch {
    // Fall through to JSONL mode
  }

  // Attempt 2: JSONL — one envelope per line
  const envelopes: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      envelopes.push(JSON.parse(l) as unknown);
    } catch {
      // Skip malformed lines silently
    }
  }
  return envelopes;
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "otel",
    description: "Ingest OTLP-JSON events from a file",
  },
  args: {
    file: {
      type: "positional",
      required: true,
      description: "Path to OTLP JSON or JSONL file",
    },
  },
  async run({ args }) {
    // 1. Resolve project root and paths.
    const root = resolveProjectRoot();
    const paths = makePaths(root);

    // 2. Read state — if disabled, exit 0 silently.
    const state = readState(paths.statePath);
    if (state.disabled) {
      process.stdout.write(JSON.stringify({ ingested: 0, redacted: 0, reason: "disabled" }) + "\n");
      process.exit(0);
    }

    // 3. Assert file is within project root (path-confine security check).
    let resolvedFile: string;
    try {
      resolvedFile = assertWithinProject(args.file, root);
    } catch {
      process.stderr.write(
        `[logbook] ingest otel: path escape detected for "${args.file}"\n`,
      );
      process.exit(1);
    }

    // 4. Read file content — defensive, exit 0 with ingested=0 on error.
    let content: string;
    try {
      content = fs.readFileSync(resolvedFile!, "utf8");
    } catch (err) {
      process.stdout.write(
        JSON.stringify({ ingested: 0, redacted: 0, reason: "file-read-error" }) + "\n",
      );
      process.exit(0);
    }

    // 5. Parse envelopes (single JSON or JSONL).
    const envelopes = parseEnvelopes(content!);

    if (envelopes.length === 0) {
      process.stdout.write(JSON.stringify({ ingested: 0, redacted: 0 }) + "\n");
      process.exit(0);
    }

    // 6. Normalize each envelope, redact, append.
    let ingested = 0;
    let redactedCount = 0;

    for (const envelope of envelopes) {
      let events;
      try {
        events = normalizeOtelEnvelope(envelope);
      } catch {
        // normalizeOtelEnvelope is itself defensive but double-guard here
        continue;
      }

      for (const event of events) {
        try {
          // Route through appendEvent so redaction and Shape-A are enforced.
          // Pass all already-constructed fields to preserve otel ids/timestamps.
          const { redacted } = await appendEvent(paths, {
            id: event.id,
            traceId: event.traceId,
            spanId: event.spanId,
            ...(event.parentId !== undefined && { parentId: event.parentId }),
            timestamp: event.timestamp,
            kind: event.kind,
            sessionId: event.sessionId,
            provider: event.provider,
            ...(event.model !== undefined && { model: event.model }),
            ...(event.phase !== undefined && { phase: event.phase }),
            payload: event.payload as Record<string, unknown>,
            ...(event.tokens !== undefined && { tokens: event.tokens }),
            ...(event.latencyMs !== undefined && { latencyMs: event.latencyMs }),
            ...(event.meta !== undefined && { meta: event.meta }),
          });
          if (redacted) redactedCount++;
          ingested++;
        } catch {
          // Individual event persist failure — skip, continue.
        }
      }
    }

    // 7. Report result.
    process.stdout.write(JSON.stringify({ ingested, redacted: redactedCount }) + "\n");
    process.exit(0);
  },
});
