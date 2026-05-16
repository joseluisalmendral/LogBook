/**
 * Codex hook payload normalizer — raw payload → LogBook Event.
 *
 * Design: purely defensive — never throws on any input (null, undefined,
 * non-object, empty). Unknown top-level fields pass through to event.meta.
 *
 * FORWARD-COMPATIBILITY CONTRACT:
 *   When Codex's payload schema evolves, only this file needs updating.
 *   All unknown fields are preserved in meta so no data is lost.
 *
 * Field mapping (current best guesses — documented for traceability):
 *   payload.event_type | hook_event → kind (mapped via EVENT_TYPE_MAP)
 *   payload.model                  → event.model (if string)
 *   payload.message                → event.payload.text (preferred)
 *   payload.content                → event.payload.text (fallback when message absent)
 *   payload.tool                   → event.payload.tool_name
 *   payload.tool_args              → event.payload.tool_args
 *   payload.tool_response          → event.payload.tool_response
 *   all other top-level keys       → event.meta.<key>
 *
 * Redaction: runs in the CLI wrapper (codex.ts) BEFORE persist — never here.
 */

import type { Event, EventKind, EventPayload } from "../../types/event.js";

// ---------------------------------------------------------------------------
// Normalize context (injectable for deterministic tests)
// ---------------------------------------------------------------------------

export interface NormalizeCodexContext {
  sessionId: string;
  now: () => string;
  ulid: () => string;
}

// ---------------------------------------------------------------------------
// Kind mapping — Codex event_type / hook_event → EventKind
// ---------------------------------------------------------------------------

const EVENT_TYPE_MAP: Record<string, EventKind> = {
  tool_call: "tool_use",
  tool_result: "tool_result",
  user_message: "user_input",
  assistant_message: "assistant_response",
  error: "error",
  system: "system",
};

function mapKind(eventType: string | undefined): EventKind {
  if (eventType === undefined || eventType === null) return "hook_event";
  return EVENT_TYPE_MAP[eventType] ?? "hook_event";
}

// ---------------------------------------------------------------------------
// Known top-level fields — these are handled explicitly and NOT forwarded to meta
// (except event_type which is stored in meta under a namespaced key)
// ---------------------------------------------------------------------------

const KNOWN_FIELDS = new Set([
  "event_type",
  "hook_event_name", // alternate Codex spelling
  "model",
  "message",
  "content",
  "tool",
  "tool_args",
  "tool_response",
  "ts",             // timestamp — intentionally skipped (we use ctx.now())
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Codex hook payload into a LogBook Event.
 *
 * This function is safe to call with ANY input — null, undefined, strings,
 * numbers, arrays. Degenerate input produces a valid Event with kind="error"
 * and a meta.codex.parse_error=true flag.
 *
 * The caller is responsible for running redaction on the returned event
 * BEFORE persisting it to disk.
 */
export function normalizeCodexEvent(raw: unknown, ctx: NormalizeCodexContext): Event {
  const id = ctx.ulid();
  const spanId = ctx.ulid();
  const timestamp = ctx.now();

  // Guard: non-object input → return a degraded error event
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      schemaVersion: 3,
      id,
      traceId: ctx.sessionId,
      spanId,
      timestamp,
      sessionId: ctx.sessionId,
      provider: "codex",
      kind: "error",
      redacted: false,
      payload: {
        text: `Codex normalizer: non-object input received (type=${Array.isArray(raw) ? "array" : typeof raw})`,
      },
      meta: {
        "codex.parse_error": true,
        "codex.raw_type": Array.isArray(raw) ? "array" : typeof raw,
      },
    };
  }

  const obj = raw as Record<string, unknown>;

  // Resolve event_type from either spelling Codex may use
  const eventType =
    (typeof obj["event_type"] === "string" ? obj["event_type"] : undefined) ??
    (typeof obj["hook_event_name"] === "string" ? obj["hook_event_name"] : undefined);

  const kind = mapKind(eventType);

  // model — only when it is a string (forward-safe)
  const model = typeof obj["model"] === "string" ? obj["model"] : undefined;

  // payload.text — prefer message, fall back to content
  const textFromMessage = typeof obj["message"] === "string" ? obj["message"] : undefined;
  const textFromContent = typeof obj["content"] === "string" ? obj["content"] : undefined;
  const text = textFromMessage ?? textFromContent;

  // Build the LogBook payload
  const payload: EventPayload = { raw: obj };
  if (text !== undefined) payload.text = text;
  if (typeof obj["tool"] === "string") payload.tool_name = obj["tool"];
  if (obj["tool_args"] !== undefined) payload.tool_args = obj["tool_args"];
  if (obj["tool_response"] !== undefined) payload.tool_response = obj["tool_response"];

  // Build meta — always include namespaced event_type for traceability
  const meta: Record<string, unknown> = {
    "codex.event_type": eventType,
  };

  // Forward all unknown top-level fields into meta (forward-compatibility)
  for (const [k, v] of Object.entries(obj)) {
    if (!KNOWN_FIELDS.has(k)) {
      meta[k] = v;
    }
  }

  return {
    schemaVersion: 3,
    id,
    traceId: ctx.sessionId,
    spanId,
    timestamp,
    sessionId: ctx.sessionId,
    provider: "codex",
    ...(model !== undefined && { model }),
    kind,
    redacted: false,
    payload,
    meta,
  };
}
