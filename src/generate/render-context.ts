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
  sessions: RenderEvent[];   // type === "manual.session_start"
  phases: RenderEvent[];     // type === "manual.phase"
  decisions: RenderEvent[];  // type === "manual.decision"
  errors: RenderEvent[];     // type === "manual.error"
  fixes: RenderEvent[];      // type === "manual.fix"
  lessons: RenderEvent[];    // type === "manual.lesson"
  resources: RenderEvent[];  // type === "manual.resource"
  visuals: RenderEvent[];    // type === "manual.visual"
  milestones: RenderEvent[]; // type === "manual.milestone"
  all: RenderEvent[];        // all events sorted by ts ascending
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
    if (typeof entryType === "string") {
      const kind = merged["kind"] as string;
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
    return 0;
  });
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

  return {
    sessions:  sortByTs(sorted.filter((e) => e.type === "manual.session_start")),
    phases:    sortByTs(sorted.filter((e) => e.type === "manual.phase")),
    decisions: sortByTs(sorted.filter((e) => e.type === "manual.decision")),
    errors:    sortByTs(sorted.filter((e) => e.type === "manual.error")),
    fixes:     sortByTs(sorted.filter((e) => e.type === "manual.fix")),
    lessons:   sortByTs(sorted.filter((e) => e.type === "manual.lesson")),
    resources: sortByTs(sorted.filter((e) => e.type === "manual.resource")),
    visuals:   sortByTs(sorted.filter((e) => e.type === "manual.visual")),
    milestones: sortByTs(sorted.filter((e) => e.type === "manual.milestone")),
    all:       sorted,
  };
}

function emptyContext(): RenderContext {
  return {
    sessions: [],
    phases: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    all: [],
  };
}
