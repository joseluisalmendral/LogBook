/**
 * render-context.ts — Read and normalize events from JSONL (T11).
 *
 * JSONL is the primary read source. SQLite is best-effort index only (T10b.D2).
 *
 * Normalization (T10b.D1 closure + Shape-A compat):
 *  - Legacy CLI events use TOP-LEVEL fields: { type, title, ... }
 *  - MCP events use payload wrapper: { type, payload: { title, ... } }
 *  - New Shape-A events from appendEvent use: { kind, timestamp, payload: { entryType, ... } }
 *  - All shapes are normalized into RenderEvent (top-level fields).
 *  - When payload is present, it is flattened into top-level. Raw event
 *    preserved in _raw for debugging.
 *  - Top-level fields win over payload fields when both are present.
 *  - Shape-A: when kind==="user_entry" and payload.entryType exists, synthesize
 *    type = "manual." + entryType so downstream type-based filters keep working.
 *  - Shape-A: accept `timestamp` as fallback for `ts` (new events use timestamp).
 */

import { promises as fsPromises } from "node:fs";
import type { ProjectPaths } from "../core/paths.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderEvent {
  id: string;
  type: string;
  ts: string;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

export interface RenderContext {
  /** The id of the most recent session, or '' if no sessions exist.
   *  ADR-D2: used as the default landing target for the hash router.
   *  Populated from sessions[sessions.length - 1]?.id in readContext.
   */
  latestSessionId: string;
  sessions: RenderEvent[];          // type === "manual.session_start"
  phases: RenderEvent[];            // type === "manual.phase"
  decisions: RenderEvent[];         // type === "manual.decision"
  errors: RenderEvent[];            // type === "manual.error"
  fixes: RenderEvent[];             // type === "manual.fix"
  lessons: RenderEvent[];           // type === "manual.lesson"
  resources: RenderEvent[];         // type === "manual.resource"
  visuals: RenderEvent[];           // type === "manual.visual"
  milestones: RenderEvent[];        // type === "manual.milestone"
  all: RenderEvent[];               // all events sorted by ts ascending
  /**
   * Conversation-thread events sorted by ts ascending.
   * Includes: user_prompt, claude_message, tool_use.*, tool_result.*,
   * subagent_complete, manual.annotation, manual.session_goal, manual.session_outcome,
   * skill_invoked (B3), gh_agent_run (B2).
   * Populated by readContext; consumers use this bucket for conversation timeline rendering.
   * Optional for backward compat with manually constructed contexts in tests.
   */
  conversation?: RenderEvent[];
  /** B1: Langfuse traces captured from Stop hook. */
  langfuseTraces?: RenderEvent[];
  /** B2: GitHub agent runs imported via CLI. */
  ghAgentRuns?: RenderEvent[];
  /** B3: Skill invocations detected in transcript scraper. */
  skillInvocations?: RenderEvent[];
  /** B4: Visual direction decisions logged via CLI. */
  visualDirections?: RenderEvent[];
  /** B5: QA findings logged via MCP tool. */
  qaFindings?: RenderEvent[];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw parsed object into a RenderEvent.
 *
 * Handles three shapes:
 *  1. Legacy CLI shape: { id, type, ts, title, ... } — pass through.
 *  2. MCP shape: { id, type, ts, payload: { title, ... } } — flatten payload.
 *  3. Shape-A (appendEvent): { id, kind, timestamp, payload: { entryType, ... } }
 *     - Accept `timestamp` as `ts` when `ts` is absent.
 *     - Synthesize `type = "manual." + entryType` for user_entry kind so
 *       downstream filters (e.g. e.type === "manual.lesson") keep working.
 *     - Synthesize `type = "manual." + entryType` for system kind (session_start,
 *       phase_change, session_rename).
 *
 * Payload fields are flattened into top-level. Raw event preserved in `_raw`.
 * Top-level fields win over payload fields when duplicated.
 */
function normalizeEvent(raw: Record<string, unknown>): RenderEvent {
  const payload = raw["payload"];
  let merged: Record<string, unknown>;

  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    // Flatten: payload fields first, then top-level overrides
    merged = {
      ...(payload as Record<string, unknown>),
      ...raw,
      _raw: raw,
    };
    // Remove the payload field from top-level (it's been flattened)
    delete merged["payload"];
  } else {
    merged = { ...raw };
  }

  // Shape-A compat: accept `timestamp` as fallback for `ts`.
  if (typeof merged["ts"] !== "string" && typeof merged["timestamp"] === "string") {
    merged["ts"] = merged["timestamp"];
  }

  // Shape-A compat: synthesize `type` from kind + payload.entryType when type is absent.
  // This keeps all downstream type-based filters working (e.g. type === "manual.lesson").
  if (typeof merged["type"] !== "string" && typeof merged["kind"] === "string") {
    const entryType = merged["entryType"];
    const kind = merged["kind"] as string;

    if (typeof entryType === "string") {
      if (kind === "user_entry") {
        merged["type"] = `manual.${entryType}`;
      } else if (kind === "system") {
        // Map system entryTypes to their legacy type names.
        const systemTypeMap: Record<string, string> = {
          session_start: "manual.session_start",
          phase_change: "manual.phase",
          session_rename: "manual.session_rename",
          mcp_audit: "system.mcp_audit",
        };
        merged["type"] = systemTypeMap[entryType] ?? `system.${entryType}`;
      }
    } else {
      // No entryType — synthesize type from the kind itself for hook-originated events.
      // These kinds carry no entryType subtype; the kind IS the discriminator.
      if (kind === "user_prompt") {
        merged["type"] = "user_prompt";
      } else if (kind === "claude_message") {
        merged["type"] = "claude_message";
      } else if (kind === "subagent_complete") {
        merged["type"] = "subagent_complete";
      } else if (kind === "tool_use") {
        // Suffix with tool_name when available for more specific filtering.
        const toolName = merged["tool_name"];
        merged["type"] =
          typeof toolName === "string" && toolName
            ? `tool_use.${toolName.toLowerCase()}`
            : "tool_use";
      } else if (kind === "tool_result") {
        const toolName = merged["tool_name"];
        merged["type"] =
          typeof toolName === "string" && toolName
            ? `tool_result.${toolName.toLowerCase()}`
            : "tool_result";
      } else if (kind === "hook_event") {
        const hookEventName = merged["hook_event_name"] ?? merged["hook"];
        merged["type"] =
          typeof hookEventName === "string" && hookEventName
            ? `hook.${hookEventName}`
            : "hook_event";
      } else if (kind === "langfuse_trace") {
        // B1: Langfuse trace captured from Stop hook.
        merged["type"] = "langfuse_trace";
      } else if (kind === "gh_agent_run") {
        // B2: GitHub claude-code-action PR run import.
        merged["type"] = "gh_agent_run";
      } else if (kind === "skill_invoked") {
        // B3: Skill SKILL.md read detected in transcript scraper.
        merged["type"] = "skill_invoked";
      } else if (kind === "visual_direction") {
        // B4: Visual direction decision logged via CLI.
        merged["type"] = "visual_direction";
      } else if (kind === "qa_finding") {
        // B5: QA finding logged via MCP tool.
        merged["type"] = "qa_finding";
      } else if (kind !== "") {
        // Unknown kind — synthesize "unknown" rather than dropping the event.
        merged["type"] = "unknown";
      }
    }
  }

  return merged as RenderEvent;
}

// ---------------------------------------------------------------------------
// Bucket helpers
// ---------------------------------------------------------------------------

function sortByTs(events: RenderEvent[]): RenderEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    // Tiebreak by id (ULID is time-ordered) for deterministic output.
    const aId = typeof a["id"] === "string" ? a["id"] : "";
    const bId = typeof b["id"] === "string" ? b["id"] : "";
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
}

/** Return true for event types that belong to the conversation timeline bucket. */
function isConversationEvent(e: RenderEvent): boolean {
  const t = e.type;
  if (
    t === "user_prompt" ||
    t === "claude_message" ||
    t === "subagent_complete" ||
    t === "manual.annotation" ||
    t === "manual.session_goal" ||
    t === "manual.session_outcome" ||
    t === "skill_invoked" ||  // B3: skill invocation synthesized at read-time
    t === "gh_agent_run"      // B2: GitHub agent run shows in conversation layer
  ) {
    return true;
  }
  // tool_use.* and tool_result.*
  if (t.startsWith("tool_use.") || t.startsWith("tool_result.")) return true;
  // bare tool_use / tool_result (no tool_name suffix)
  if (t === "tool_use" || t === "tool_result") return true;
  return false;
}

// ---------------------------------------------------------------------------
// readContext
// ---------------------------------------------------------------------------

/**
 * Read all events from events.jsonl, normalize both CLI and MCP shapes,
 * filter into typed buckets, and sort each bucket + `all` by ts ascending.
 *
 * Returns empty context if events.jsonl does not exist.
 * Malformed JSON lines are skipped with a stderr warning.
 */
export async function readContext(paths: ProjectPaths): Promise<RenderContext> {
  let content: string;
  try {
    content = await fsPromises.readFile(paths.eventsJsonl, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyContext();
    }
    throw err;
  }

  const all: RenderEvent[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stderr.write(
        `[logbook] render-context: skipping malformed JSON line: ${trimmed.slice(0, 80)}\n`
      );
      continue;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      process.stderr.write(
        `[logbook] render-context: skipping non-object event\n`
      );
      continue;
    }

    const event = normalizeEvent(parsed as Record<string, unknown>);

    // Require at minimum: id, ts (or timestamp), and type (or kind).
    // Shape-A events use `timestamp` and `kind`; legacy events use `ts` and `type`.
    // normalizeEvent() already maps timestamp→ts and synthesizes type from kind+entryType.
    if (
      typeof event["id"] !== "string" ||
      typeof event["ts"] !== "string" ||
      typeof event["type"] !== "string"
    ) {
      process.stderr.write(
        `[logbook] render-context: skipping event missing id/type/ts\n`
      );
      continue;
    }

    all.push(event);
  }

  const sorted = sortByTs(all);

  const sessions = sortByTs(sorted.filter((e) => e.type === "manual.session_start"));
  // ADR-D2: latestSessionId is the id of the most recent session_start event.
  // Sessions are sorted ascending, so the last entry is the most recent.
  const latestSessionId: string =
    sessions.length > 0
      ? (typeof sessions[sessions.length - 1]!["id"] === "string"
          ? (sessions[sessions.length - 1]!["id"] as string)
          : "")
      : "";

  return {
    latestSessionId,
    sessions,
    phases:           sortByTs(sorted.filter((e) => e.type === "manual.phase")),
    decisions:        sortByTs(sorted.filter((e) => e.type === "manual.decision")),
    errors:           sortByTs(sorted.filter((e) => e.type === "manual.error")),
    fixes:            sortByTs(sorted.filter((e) => e.type === "manual.fix")),
    lessons:          sortByTs(sorted.filter((e) => e.type === "manual.lesson")),
    resources:        sortByTs(sorted.filter((e) => e.type === "manual.resource")),
    visuals:          sortByTs(sorted.filter((e) => e.type === "manual.visual")),
    milestones:       sortByTs(sorted.filter((e) => e.type === "manual.milestone")),
    conversation:     sortByTs(sorted.filter(isConversationEvent)),
    langfuseTraces:   sortByTs(sorted.filter((e) => e.type === "langfuse_trace")),
    ghAgentRuns:      sortByTs(sorted.filter((e) => e.type === "gh_agent_run")),
    skillInvocations: sortByTs(sorted.filter((e) => e.type === "skill_invoked")),
    visualDirections: sortByTs(sorted.filter((e) => e.type === "visual_direction")),
    qaFindings:       sortByTs(sorted.filter((e) => e.type === "qa_finding")),
    all:              sorted,
  };
}

function emptyContext(): RenderContext {
  return {
    latestSessionId: "",
    sessions: [],
    phases: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    conversation: [],
    langfuseTraces: [],
    ghAgentRuns: [],
    skillInvocations: [],
    visualDirections: [],
    qaFindings: [],
    all: [],
  };
}
