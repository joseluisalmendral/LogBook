/**
 * Review subsystem barrel (T10 + T11).
 *
 * Exports:
 *   - Pure state machine functions (initialState, reduce, summarize)
 *   - Async data loader (loadReviewItems)
 *   - Ink TUI entry point (runReviewTUI) — T11
 *   - Decision persister (persistReviewDecisions) — T11
 */
export {
  initialState,
  reduce,
  summarize,
  loadReviewItems,
} from "./flows.js";

export type { LoadReviewItemsOpts } from "./flows.js";

// T11 — Ink TUI
export { runReviewTUI, ReviewApp } from "./tui.js";
export type { RunReviewTUIOptions, ReviewAppProps } from "./tui.js";

// T11 — Decision persister
export { persistReviewDecisions } from "./persist.js";
export type {
  PersistReviewDecisionsOpts,
  PersistReviewDecisionsCounts,
} from "./persist.js";
