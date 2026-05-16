/**
 * render-context.ts — Read and normalize events from JSONL (T11).
 *
 * JSONL is the primary read source. SQLite is best-effort index only (T10b.D2).
 *
 * Normalization (T10b.D1 closure):
 *  - CLI events use TOP-LEVEL fields: { type, title, ... }
 *  - MCP events use payload wrapper: { type, payload: { title, ... } }
 *  - Both are normalized into RenderEvent (top-level fields).
 *  - When payload is present, it is flattened into top-level. Raw event
 *    preserved in _raw for debugging.
 *  - Top-level fields win over payload fields when both are present.
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
 * If the event has a `payload` field (MCP shape), flatten payload fields
 * into top-level. Preserve the original via `_raw`. Top-level fields win
 * when duplicated in payload.
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

    // Require at minimum: id, type, ts
    if (
      typeof event["id"] !== "string" ||
      typeof event["type"] !== "string" ||
      typeof event["ts"] !== "string"
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
