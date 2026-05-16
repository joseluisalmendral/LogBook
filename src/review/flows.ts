/**
 * Review state machine — pure reducer and data loader (T10).
 *
 * This module is STRICTLY Ink-free. No React, no framework imports.
 * All functions here are either:
 *   - Synchronous pure functions (initialState, reduce, summarize)
 *   - Async file-reading helpers (loadReviewItems) — I/O only, no UI
 *
 * The TUI (T11 — src/review/tui.ts) mounts this state machine and
 * dispatches actions on keypress via React hooks.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type {
  ReviewItem,
  ReviewState,
  ReviewAction,
  ReviewSummary,
} from "../types/review.js";

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

/**
 * Build the initial ReviewState from a list of items.
 * Pure — no I/O.
 */
export function initialState(items: ReviewItem[]): ReviewState {
  return {
    items,
    index: 0,
    decisions: {},
    teachingValues: {},
    exiting: false,
    committed: false,
  };
}

// ---------------------------------------------------------------------------
// reduce — pure state machine
// ---------------------------------------------------------------------------

/**
 * Pure reducer. Returns a NEW state object; never mutates input.
 */
export function reduce(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "next":
      return {
        ...state,
        index: Math.min(state.index + 1, Math.max(state.items.length - 1, 0)),
      };

    case "prev":
      return {
        ...state,
        index: Math.max(state.index - 1, 0),
      };

    case "promote": {
      const item = state.items[state.index];
      if (!item) return state;
      return {
        ...state,
        decisions: { ...state.decisions, [item.id]: "promote" },
        teachingValues: { ...state.teachingValues, [item.id]: action.teaching },
        // auto-advance: move to next item; cap at end
        index: Math.min(state.index + 1, state.items.length - 1),
      };
    }

    case "discard": {
      const item = state.items[state.index];
      if (!item) return state;
      return {
        ...state,
        decisions: { ...state.decisions, [item.id]: "discard" },
        index: Math.min(state.index + 1, state.items.length - 1),
      };
    }

    case "skip": {
      const item = state.items[state.index];
      if (!item) return state;
      return {
        ...state,
        decisions: { ...state.decisions, [item.id]: "skip" },
        index: Math.min(state.index + 1, state.items.length - 1),
      };
    }

    case "commit":
      return { ...state, committed: true };

    case "exit":
      return { ...state, exiting: true };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

/**
 * Compute summary counts from the current review state.
 * Pure — no I/O.
 */
export function summarize(state: ReviewState): ReviewSummary {
  let promoted = 0;
  let discarded = 0;
  let skipped = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const decision of Object.values(state.decisions)) {
    if (decision === "promote") promoted++;
    else if (decision === "discard") discarded++;
    else if (decision === "skip") skipped++;
  }

  for (const teaching of Object.values(state.teachingValues)) {
    if (teaching === "high") high++;
    else if (teaching === "medium") medium++;
    else if (teaching === "low") low++;
  }

  return {
    totalItems: state.items.length,
    promoted,
    discarded,
    skipped,
    untouched: state.items.length - promoted - discarded - skipped,
    teachingHigh: high,
    teachingMedium: medium,
    teachingLow: low,
  };
}

// ---------------------------------------------------------------------------
// loadReviewItems
// ---------------------------------------------------------------------------

/**
 * Options for loadReviewItems.
 */
export interface LoadReviewItemsOpts {
  /** Path to .logbook/pending-suggestions.jsonl */
  pendingSuggestionsPath: string;
  /** Path to logbook/evidence/events.jsonl */
  eventsJsonlPath: string;
}

/**
 * Load review items from JSONL files.
 *
 * Algorithm:
 * 1. Read pending-suggestions.jsonl (if exists).
 *    Each line becomes a ReviewItem of kind "pending_suggestion".
 *
 * 2. Read events.jsonl (if exists).
 *    Build a Set of eventIds referenced by manual.promote events.
 *    Filter to keep events that:
 *      - Have type starting with "manual." (user-captured)
 *      - Are NOT of type "manual.promote" (those are classification records)
 *      - Are NOT referenced by any manual.promote event
 *    Each qualifying event becomes a ReviewItem of kind "unclassified_event".
 *
 * 3. Combine both arrays and sort by ts ascending.
 */
export async function loadReviewItems(
  opts: LoadReviewItemsOpts
): Promise<ReviewItem[]> {
  const { pendingSuggestionsPath, eventsJsonlPath } = opts;

  const items: ReviewItem[] = [];

  // ---- 1. Pending suggestions -------------------------------------------------
  if (fs.existsSync(pendingSuggestionsPath)) {
    const raw = fs.readFileSync(pendingSuggestionsPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as Record<string, unknown>;
        const id = String(record["id"] ?? "");
        const ts = String(record["ts"] ?? "");
        if (!id) continue;

        // Build preview from payload fields: description, message, title, type
        const payload = record["payload"] as Record<string, unknown> | undefined;
        const previewSource =
          (payload?.["description"] as string | undefined) ??
          (payload?.["message"] as string | undefined) ??
          (payload?.["title"] as string | undefined) ??
          (record["type"] as string | undefined) ??
          id;
        const preview = previewSource.slice(0, 120);

        items.push({ id, kind: "pending_suggestion", ts, preview, raw: record });
      } catch {
        // Skip malformed lines silently
      }
    }
  }

  // ---- 2. Unclassified events from events.jsonl -------------------------------
  if (fs.existsSync(eventsJsonlPath)) {
    const raw = fs.readFileSync(eventsJsonlPath, "utf-8");
    const allLines: Record<string, unknown>[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        allLines.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // Skip malformed lines silently
      }
    }

    // Build the set of eventIds that have been promoted (classified)
    const promotedEventIds = new Set<string>();
    for (const record of allLines) {
      if (record["type"] === "manual.promote") {
        const eventId = record["eventId"] as string | undefined;
        if (eventId) promotedEventIds.add(eventId);
      }
    }

    // Filter to keep unclassified manual.* events
    for (const record of allLines) {
      const type = record["type"] as string | undefined;
      if (!type) continue;
      // Only manual.* events, but not manual.promote itself
      if (!type.startsWith("manual.")) continue;
      if (type === "manual.promote") continue;

      const id = String(record["id"] ?? "");
      if (!id) continue;
      // Skip if already promoted/classified
      if (promotedEventIds.has(id)) continue;

      const ts = String(record["ts"] ?? "");

      // Build preview from: title, message, description, summary
      const previewSource =
        (record["title"] as string | undefined) ??
        (record["message"] as string | undefined) ??
        (record["description"] as string | undefined) ??
        (record["summary"] as string | undefined) ??
        type;
      const preview = previewSource.slice(0, 120);

      items.push({ id, kind: "unclassified_event", ts, preview, raw: record });
    }
  }

  // ---- 3. Sort by ts ascending ------------------------------------------------
  items.sort((a, b) => a.ts.localeCompare(b.ts));

  return items;
}
