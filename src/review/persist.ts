/**
 * Persist review decisions to JSONL (T11).
 *
 * Translates a final ReviewState into JSONL appends:
 *   - "promote" decisions → manual.promote event (with teachingValue)
 *   - "discard" decisions → manual.discard event
 *   - "skip" decisions → no-op (skip = leave as-is for future review)
 *
 * Event shape follows the T3 top-level convention (no payload wrapper).
 */

import { appendEvent } from "../store/index.js";
import type { ReviewState } from "../types/review.js";
import type { ProjectPaths } from "../core/paths.js";

export interface PersistReviewDecisionsOpts {
  paths: ProjectPaths;
  state: ReviewState;
}

export interface PersistReviewDecisionsCounts {
  promoted: number;
  discarded: number;
  skipped: number;
}

/**
 * Persist all review decisions from the final ReviewState to JSONL.
 *
 * For each id in state.decisions:
 *   - "promote" → appends manual.promote event with teachingValue
 *   - "discard" → appends manual.discard event
 *   - "skip"    → no-op (intentionally not persisted; allows re-review)
 *
 * Returns counts of each decision type.
 */
export async function persistReviewDecisions(
  opts: PersistReviewDecisionsOpts,
): Promise<PersistReviewDecisionsCounts> {
  const { paths, state } = opts;
  const { decisions, teachingValues } = state;

  let promoted = 0;
  let discarded = 0;
  let skipped = 0;

  for (const [eventId, decision] of Object.entries(decisions)) {
    if (decision === "promote") {
      const teachingValue = teachingValues[eventId] ?? "medium";
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId: "",
        provider: "logbook-review",
        payload: {
          entryType: "review",
          kind: "promote",
          eventId,
          teachingValue,
          source: "review-tui",
        },
      });
      promoted++;
    } else if (decision === "discard") {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId: "",
        provider: "logbook-review",
        payload: {
          entryType: "review",
          kind: "discard",
          eventId,
          source: "review-tui",
        },
      });
      discarded++;
    } else if (decision === "skip") {
      // Intentionally no-op: skip = "leave as-is for next review session"
      skipped++;
    }
  }

  return { promoted, discarded, skipped };
}
