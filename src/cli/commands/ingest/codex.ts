/**
 * logbook ingest codex
 *
 * Read a Codex hook payload from stdin and append normalized events to
 * events.jsonl.
 *
 * Design:
 *  - Defensive: never crashes (exit 0 always, even on malformed input).
 *  - Redaction runs before every persist (consistent with iter2 pipeline).
 *  - Supports both single-JSON and JSONL (multiple events on separate lines).
 *  - Empty stdin → exit 0 silently, no append.
 *  - Malformed JSON → write a degraded "error" event so the failure is auditable.
 *  - state.disabled → exit 0 silently, no append.
 */

import { defineCommand } from "citty";
import { readAllStdin } from "../../../util/stdin.js";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { readState } from "../../../core/state.js";
import { normalizeCodexEvent } from "../../../connectors/codex/normalize.js";
import { appendJsonl } from "../../../store/jsonl.js";
import { redact } from "../../../redact/index.js";
import { generateUlid } from "../../../util/ulid.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively redact all string values in a value tree.
 * Returns the redacted tree and a flag indicating whether any hit fired.
 */
function redactDeep(value: unknown): { value: unknown; redactedAny: boolean } {
  if (typeof value === "string") {
    const result = redact(value);
    return { value: result.redacted, redactedAny: result.hits.length > 0 };
  }
  if (Array.isArray(value)) {
    let redactedAny = false;
    const next = value.map((item) => {
      const r = redactDeep(item);
      if (r.redactedAny) redactedAny = true;
      return r.value;
    });
    return { value: next, redactedAny };
  }
  if (value !== null && typeof value === "object") {
    let redactedAny = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = redactDeep(v);
      if (r.redactedAny) redactedAny = true;
      next[k] = r.value;
    }
    return { value: next, redactedAny };
  }
  return { value, redactedAny: false };
}

/**
 * Parse stdin content as one or more Codex payloads.
 *
 * Strategy:
 *  1. Try the whole content as a single JSON object.
 *  2. On parse failure, treat each non-empty line as a separate payload (JSONL).
 *  3. Lines that fail JSON.parse are returned as raw strings so callers can
 *     produce degraded error events (data-preservation contract).
 *
 * Returns an array of parsed items (unknown) — never throws.
 */
function parsePayloads(content: string): { parsed: unknown; raw: string }[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Attempt 1: single JSON object
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return [{ parsed, raw: trimmed }];
  } catch {
    // Fall through to JSONL mode
  }

  // Attempt 2: JSONL — one payload per non-empty line
  const results: { parsed: unknown; raw: string }[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      results.push({ parsed: JSON.parse(l) as unknown, raw: l });
    } catch {
      // Malformed line — forward as a raw-string sentinel so we can create
      // a degraded error event (data-preservation contract: never silently drop).
      results.push({ parsed: null, raw: l });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "codex",
    description: "Read a Codex hook payload from stdin and append to JSONL",
  },
  args: {
    "session-id": {
      type: "string",
      required: false,
      description: "Override session id (default: env LOGBOOK_SESSION_ID or generated ULID)",
    },
  },
  async run({ args }) {
    // 1. Read stdin (with a generous timeout for CLI usage vs the 200ms hook constraint).
    const stdinContent = await readAllStdin({ timeoutMs: 5_000 });

    // 2. Resolve project root and paths.
    const root = resolveProjectRoot();
    const paths = makePaths(root);

    // 3. Read state — if disabled, exit 0 silently (no append).
    const state = readState(paths.statePath);
    if (state.disabled) {
      process.stdout.write(JSON.stringify({ ingested: 0, redacted: 0, reason: "disabled" }) + "\n");
      process.exit(0);
    }

    // 4. Empty stdin → exit 0 silently (no append, no output).
    if (!stdinContent.trim()) {
      process.exit(0);
    }

    // 5. Resolve session id.
    const sessionId =
      (args["session-id"] ? String(args["session-id"]) : undefined) ??
      process.env["LOGBOOK_SESSION_ID"] ??
      generateUlid();

    const nowFn = () => new Date().toISOString();
    const ulidFn = generateUlid;

    const ctx = {
      sessionId,
      now: nowFn,
      ulid: ulidFn,
    };

    // 6. Parse payloads (single JSON or JSONL).
    const items = parsePayloads(stdinContent);

    // Edge case: parsePayloads returned empty (shouldn't happen after trim check,
    // but guard defensively).
    if (items.length === 0) {
      process.stdout.write(JSON.stringify({ ingested: 0, redacted: 0 }) + "\n");
      process.exit(0);
    }

    // 7. Normalize each payload → redact → append.
    let ingested = 0;
    let redactedCount = 0;

    for (const { parsed, raw: rawStr } of items) {
      try {
        // When parsed is null it means JSON.parse failed on this line.
        // Produce a degraded error event with the raw string in meta — data-preservation.
        // Use event_type="error" so the normalizer maps it to kind="error".
        const rawPayload: unknown =
          parsed !== null
            ? parsed
            : { event_type: "error", codex_parse_error: true, raw_stdin: rawStr };

        const event = normalizeCodexEvent(rawPayload, ctx);

        // Apply redaction BEFORE persist (spec §30 requirement).
        const { value: redactedPayload, redactedAny } = redactDeep(event.payload);
        event.payload = redactedPayload as typeof event.payload;
        if (redactedAny) {
          event.redacted = true;
          redactedCount++;
        }

        const line = JSON.stringify(event);
        await appendJsonl(paths.eventsJsonl, line);
        ingested++;
      } catch {
        // Individual event persist failure — skip and continue.
        // The hook must never crash the parent process.
      }
    }

    // 8. Report result.
    process.stdout.write(JSON.stringify({ ingested, redacted: redactedCount }) + "\n");
    process.exit(0);
  },
});
