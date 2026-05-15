export type EventKind =
  | "user_input"          // human-authored prompt to the agent
  | "assistant_response"  // model output (text, tool calls)
  | "tool_use"            // tool invocation by the agent
  | "tool_result"         // tool response payload
  | "system"              // session lifecycle, hook bootstrap, configuration
  | "error"               // captured error in agent/tool/hook/build/test
  | "hook_event";         // raw event delivered by Claude Code's hook bus

export interface EventTokens {
  in?: number;             // prompt tokens (best-effort, heuristic in iter1)
  out?: number;            // completion tokens
  total?: number;          // in + out when both known
}

export interface EventPayload {
  // OTel-genai aligned payload envelope; only `text` is guaranteed in iter1
  text?: string;           // canonical textual content of the event after redaction
  tool_name?: string;      // for tool_use / tool_result
  tool_args?: unknown;     // for tool_use; redacted
  tool_response?: unknown; // for tool_result; redacted via §30 rules
  raw?: unknown;           // original hook payload kept for forensics (also redacted)
}

export interface Event {
  schemaVersion: 3;        // §26.1 — bumped on breaking changes
  id: string;              // ULID — globally unique event id
  traceId: string;         // OTel trace id; equals sessionId for hook-originated events in iter1
  spanId: string;          // OTel span id; ULID-derived 16-char id
  parentId?: string;       // parent span/event id (e.g. tool_result's tool_use)
  timestamp: string;       // RFC3339 with millis, UTC ("Z" suffix)
  sessionId: string;       // session this event belongs to
  provider: string;        // "anthropic" | "openai" | … ; "claude-code" for hook origin
  model?: string;          // model name when known (e.g. "claude-3-7-sonnet")
  kind: EventKind;         // discriminator
  phase?: string;          // domain phase tag (e.g. "design","apply") — optional in iter1
  redacted: boolean;       // true if any redaction rule fired on this event's text
  payload: EventPayload;   // event content (post-redaction)
  tokens?: EventTokens;    // token usage if reported
  latencyMs?: number;      // elapsed time for tool calls / model responses
  meta?: Record<string, unknown>; // free-form bag for hook-supplied metadata
}
