/**
 * Store façade — re-exports all public store primitives.
 *
 * `appendEvent` is the ONLY legal way for code outside src/store/ to write to
 * events.jsonl. Direct imports of appendJsonl from src/store/jsonl.ts are
 * banned outside this directory (enforced by the ESLint no-restricted-imports
 * rule in eslint.config.js and by the static guard in
 * tests/unit/store-no-direct-appendJsonl.test.ts).
 *
 * Exception: src/mcp/tools/suggest.ts writes to pending-suggestions.jsonl
 * (NOT events.jsonl) and is annotated with an explicit // EXCEPTION comment.
 */

export { openIndex, closeIndex, type OpenIndexOptions } from "./sqlite.js";
// NOTE: appendJsonl is intentionally NOT re-exported here.
// All writes to events.jsonl must go through appendEvent below.
export { migrate } from "./migrate.js";
export { DDL, SCHEMA_VERSION } from "./schema.js";

import { appendJsonl } from "./jsonl.js";
import { redactEventDeep } from "./redact-event.js";
import { generateUlid } from "../util/ulid.js";
import type { Event, EventInput } from "../types/event.js";
import type { ProjectPaths } from "../core/paths.js";

// Re-export EventInput so callers can import it from the store barrel.
export type { EventInput };

/**
 * Persist a user/system/hook event to events.jsonl.
 *
 * Sequence:
 *  1. Wrap EventInput into a full Event (fill id, traceId, spanId, timestamp,
 *     schemaVersion=3, redacted=false).
 *  2. Call redactEventDeep — walks the entire event tree (except structural
 *     scalars) and applies the Gitleaks-derived redaction rules.
 *  3. Set event.redacted = redactedAny.
 *  4. Append the serialized event to paths.eventsJsonl via the internal
 *     appendJsonl function (which is NOT exported from this module).
 *  5. Return the constructed + redacted event for callers that need it (e.g.
 *     the hook ingest path needs it for SessionStart side effects).
 *
 * @param paths  ProjectPaths — only paths.eventsJsonl is used.
 * @param input  EventInput built by the caller.
 * @returns      The full Event as written to disk, plus a `redacted` flag.
 */
export async function appendEvent(
  paths: ProjectPaths,
  input: EventInput,
): Promise<{ event: Event; redacted: boolean }> {
  const now = new Date().toISOString();
  const id = input.id ?? generateUlid();
  const spanId = input.spanId ?? generateUlid();
  // traceId defaults to sessionId (OTel convention for hook-originated events)
  const traceId = input.traceId ?? input.sessionId;
  const timestamp = input.timestamp ?? now;

  const event: Event = {
    schemaVersion: 3,
    id,
    traceId,
    spanId,
    ...(input.parentId !== undefined && { parentId: input.parentId }),
    timestamp,
    sessionId: input.sessionId,
    provider: input.provider ?? "logbook",
    ...(input.model !== undefined && { model: input.model }),
    kind: input.kind,
    ...(input.phase !== undefined && { phase: input.phase }),
    redacted: false,
    payload: input.payload as Event["payload"],
    ...(input.tokens !== undefined && { tokens: input.tokens }),
    ...(input.latencyMs !== undefined && { latencyMs: input.latencyMs }),
    ...(input.meta !== undefined && { meta: input.meta }),
  };

  const { redactedAny } = redactEventDeep(event);
  event.redacted = redactedAny;

  await appendJsonl(paths.eventsJsonl, JSON.stringify(event));

  return { event, redacted: redactedAny };
}
