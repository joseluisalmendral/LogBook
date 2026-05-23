export type EventKind =
  | "user_input"          // human-authored prompt to the agent
  | "assistant_response"  // model output (text, tool calls)
  | "tool_use"            // tool invocation by the agent
  | "tool_result"         // tool response payload
  | "system"              // session lifecycle, hook bootstrap, configuration
  | "error"               // captured error in agent/tool/hook/build/test
  | "hook_event"          // raw event delivered by Claude Code's hook bus
  | "user_entry"          // CLI / MCP user-authored record; subtype in payload.entryType
  | "user_prompt"         // user prompt captured by UserPromptSubmit hook
  | "claude_message"      // assistant text/thinking turn captured from transcript
  | "subagent_complete"   // sub-agent invocation completed (from Stop hook scraper)
  | "langfuse_trace"      // Langfuse trace captured from Stop hook (B1)
  | "gh_agent_run"        // GitHub claude-code-action PR run imported via CLI (B2)
  | "skill_invoked"       // Skill SKILL.md read detected in transcript scraper (B3)
  | "visual_direction"    // Visual direction decision logged via CLI (B4)
  | "qa_finding";         // QA finding logged via MCP tool (B5)

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

/**
 * Input shape accepted by `appendEvent` in `src/store/index.ts`.
 *
 * Callers (CLI, MCP, hook ingest) build an EventInput and pass it to
 * appendEvent. The store fills all structural fields (id, traceId, spanId,
 * timestamp, schemaVersion, redacted) and then calls redactEventDeep before
 * writing to disk.
 *
 * `id`, `traceId`, `spanId`, and `timestamp` are optional so that
 * deterministic test injection is still possible (the hook ingest path already
 * builds its own ids).
 *
 * `payload.entryType` is the subdiscriminator for `kind: "user_entry"` records:
 *   "lesson" | "decision" | "resource" | "milestone" | "error" | "fix" |
 *   "snapshot" | "visual" | "annotation" | "promote" |
 *   "session_start" | "phase_change" | "session_rename" | "mcp_audit" | "review" |
 *   "session_goal" | "session_outcome"
 */
export interface EventInput {
  // --- Required from caller ---
  kind: EventKind;
  sessionId: string;
  payload: EventPayload | Record<string, unknown>;

  // --- Optional from caller ---
  provider?: string;
  model?: string;
  phase?: string;
  parentId?: string;
  meta?: Record<string, unknown>;
  tokens?: EventTokens;
  latencyMs?: number;

  // --- Reserved for hook ingest / deterministic test injection ---
  id?: string;
  traceId?: string;
  spanId?: string;
  timestamp?: string;
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
