/**
 * Normalize a raw Claude Code hook payload into a structured Event.
 *
 * The raw payload is whatever Claude Code sends over stdin — a minimal envelope
 * with known fields and possibly unknown extras. We forward unknown fields into
 * `meta` for forensic completeness.
 *
 * Pure function — no I/O, no side effects.
 */

import type { Event, EventKind, EventPayload } from "../types/event.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface RawClaudeHookPayload {
  hook_event_name?: string;   // "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStop" | "SessionStart" | …
  session_id?: string;
  timestamp?: string;
  tool_name?: string;
  tool_args?: unknown;
  tool_response?: unknown;
  [k: string]: unknown;       // forward unknown fields into meta
}

export interface NormalizeContext {
  sessionId: string;          // resolved by caller (env override or generated ULID)
  now: () => string;          // RFC3339 UTC; injectable for deterministic tests
  ulid: () => string;         // injectable for deterministic tests
}

// ---------------------------------------------------------------------------
// Kind mapping
// ---------------------------------------------------------------------------

const SYSTEM_EVENTS = new Set(["Stop", "SubagentStop", "SessionStart"]);

function mapKind(hookEventName: string | undefined): EventKind {
  if (hookEventName === undefined) return "hook_event";
  if (hookEventName === "PreToolUse") return "tool_use";
  if (hookEventName === "PostToolUse") return "tool_result";
  if (hookEventName === "UserPromptSubmit") return "user_prompt";
  if (SYSTEM_EVENTS.has(hookEventName)) return "system";
  return "hook_event";
}

// ---------------------------------------------------------------------------
// Known top-level fields that we handle explicitly (not forwarded to meta)
// ---------------------------------------------------------------------------

const KNOWN_FIELDS = new Set([
  "hook_event_name",
  "session_id",
  "timestamp",
  "tool_name",
  "tool_args",
  "tool_response",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transform a raw Claude Code hook payload into a normalized Event.
 *
 * The caller is responsible for running redaction on the returned event
 * BEFORE persisting it to disk.
 */
export function normalizeClaudeEvent(raw: RawClaudeHookPayload, ctx: NormalizeContext): Event {
  const id = ctx.ulid();
  const spanId = ctx.ulid();

  const kind = mapKind(raw.hook_event_name);

  // Build payload — tool_response as text only when it is a plain string
  const payload: EventPayload = {
    raw,
  };
  if (raw.tool_name !== undefined) payload.tool_name = raw.tool_name;
  if (raw.tool_args !== undefined) payload.tool_args = raw.tool_args;
  if (raw.tool_response !== undefined) payload.tool_response = raw.tool_response;
  // Best-effort text extraction: only when tool_response is a plain string
  if (typeof raw.tool_response === "string") payload.text = raw.tool_response;
  // UserPromptSubmit: extract prompt text from payload fields (Claude Code sends "prompt" field).
  if (kind === "user_prompt") {
    const promptText =
      (typeof raw["prompt"] === "string" ? raw["prompt"] : undefined) ??
      (typeof raw["user_prompt"] === "string" ? raw["user_prompt"] : undefined) ??
      "";
    payload.text = promptText;
  }

  // Build meta — hook event name + any unknown top-level fields
  const meta: Record<string, unknown> = { hook: raw.hook_event_name };
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_FIELDS.has(k)) {
      meta[k] = v;
    }
  }

  // model is not provided by Claude Code hooks in iter1.
  const event: Event = {
    schemaVersion: 3,
    id,
    traceId: ctx.sessionId,   // iter1: trace == session
    spanId,
    timestamp: ctx.now(),
    sessionId: ctx.sessionId,
    provider: "claude-code",
    kind,
    redacted: false,           // set to true downstream after redaction pass
    payload,
    meta,
  };
  return event;
}
