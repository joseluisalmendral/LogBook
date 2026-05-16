/**
 * Type contracts for the review state machine (T10).
 *
 * These types are shared between:
 *   - src/review/flows.ts  (pure reducer — Ink-free)
 *   - src/review/tui.ts    (Ink renderer — T11)
 *
 * Keep this file free of any I/O, framework, or runtime dependencies.
 */

export type ReviewItemKind = "pending_suggestion" | "unclassified_event";

export interface ReviewItem {
  id: string;
  kind: ReviewItemKind;
  ts: string;            // ISO 8601
  preview: string;       // short text for TUI rendering (≤120 chars)
  raw: unknown;          // full underlying record (pending suggestion or event)
}

export interface ReviewState {
  items: ReviewItem[];
  index: number;         // current cursor (0-based); 0 when items is empty
  decisions: Record<string, "promote" | "discard" | "skip">;
  teachingValues: Record<string, "high" | "medium" | "low">;
  exiting: boolean;
  committed: boolean;    // set true after COMMIT action is dispatched
}

export type ReviewAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "promote"; teaching: "high" | "medium" | "low" }
  | { type: "discard" }
  | { type: "skip" }
  | { type: "commit" }
  | { type: "exit" };

export interface ReviewSummary {
  totalItems: number;
  promoted: number;
  discarded: number;
  skipped: number;
  untouched: number;
  teachingHigh: number;
  teachingMedium: number;
  teachingLow: number;
}
