/**
 * Review TUI — Ink-based renderer for the review state machine (T11).
 *
 * Uses React.createElement (no JSX syntax) to avoid tsconfig jsx changes.
 * The ReviewApp component is thin — all logic lives in flows.ts (pure reducer).
 *
 * Key bindings:
 *   j / ArrowDown / ArrowRight  → next
 *   k / ArrowUp   / ArrowLeft   → prev
 *   p                           → promote (teaching: high)
 *   m                           → promote (teaching: medium)
 *   l                           → promote (teaching: low)
 *   d                           → discard
 *   s                           → skip
 *   c                           → commit
 *   q / Ctrl+C                  → exit
 *
 * runReviewTUI(opts) mounts the tree and returns a Promise<ReviewState> that
 * resolves when the user exits.
 */

import React, { useState } from "react";
import { Box, Text, useApp, useInput, render } from "ink";
import { initialState, reduce, summarize } from "./flows.js";
import type { ReviewItem, ReviewState, ReviewAction } from "../types/review.js";

// ---------------------------------------------------------------------------
// Shared key handler
// ---------------------------------------------------------------------------

/** Map a raw keypress to a ReviewAction, or null if unrecognized. */
function keypressToAction(
  input: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
): ReviewAction | null {
  if (input === "j" || key.downArrow || key.rightArrow)
    return { type: "next" };
  if (input === "k" || key.upArrow || key.leftArrow)
    return { type: "prev" };
  if (input === "p")
    return { type: "promote", teaching: "high" };
  if (input === "m")
    return { type: "promote", teaching: "medium" };
  if (input === "l")
    return { type: "promote", teaching: "low" };
  if (input === "d")
    return { type: "discard" };
  if (input === "s")
    return { type: "skip" };
  if (input === "c")
    return { type: "commit" };
  if (input === "q" || (key.ctrl && input === "c"))
    return { type: "exit" };
  return null;
}

// ---------------------------------------------------------------------------
// Shared render helper
// ---------------------------------------------------------------------------

/** Render the review TUI frame from the current state. */
function renderFrame(state: ReviewState): React.ReactNode {
  const { items, index } = state;
  const total = items.length;
  const currentItem = items[index];

  if (!currentItem) {
    return React.createElement(
      Box,
      { flexDirection: "column", padding: 1 },
      React.createElement(Text, { color: "yellow" }, "No items to review."),
      React.createElement(Text, { dimColor: true }, "Press q to quit."),
    );
  }

  const decision = state.decisions[currentItem.id];
  const decisionBadge = decision ? ` [${decision.toUpperCase()}]` : "";
  const sum = summarize(state);

  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },

    // Header
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(
        Text,
        { bold: true },
        `Review (item ${index + 1} of ${total})`,
      ),
      React.createElement(
        Text,
        { dimColor: true },
        ` | promoted:${sum.promoted} discarded:${sum.discarded} skipped:${sum.skipped}`,
      ),
    ),

    // Current item details
    React.createElement(
      Box,
      { flexDirection: "column", marginBottom: 1 },
      React.createElement(
        Text,
        { color: "cyan" },
        `[${currentItem.kind}]${decisionBadge} — ${currentItem.ts}`,
      ),
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { wrap: "wrap" }, currentItem.preview),
      ),
    ),

    // Footer — key bindings
    React.createElement(
      Box,
      { borderStyle: "single", marginTop: 1 },
      React.createElement(
        Text,
        { dimColor: true },
        "j/k navigate | p=promote(high) m=medium l=low | d=discard | s=skip | c=commit | q=quit",
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// ReviewApp — exported for ink-testing-library
// ---------------------------------------------------------------------------

export interface ReviewAppProps {
  initialItems: ReviewItem[];
}

/**
 * Thin Ink component for testing via ink-testing-library.
 * Uses shared renderFrame and keypressToAction helpers.
 */
export function ReviewApp({ initialItems }: ReviewAppProps): React.ReactNode {
  const { exit } = useApp();
  const [state, setState] = useState<ReviewState>(() => initialState(initialItems));

  useInput((input, key) => {
    const action = keypressToAction(input, key);
    if (!action) return;

    if (action.type === "commit" || action.type === "exit") {
      setState((s) => reduce(s, action));
      exit();
      return;
    }

    setState((s) => reduce(s, action));
  });

  return renderFrame(state);
}

// ---------------------------------------------------------------------------
// runReviewTUI — full-screen interactive entry point
// ---------------------------------------------------------------------------

export interface RunReviewTUIOptions {
  items: ReviewItem[];
}

/**
 * Mount the ReviewApp Ink tree and return a Promise<ReviewState> that resolves
 * when the user exits (q, Ctrl+C, or c for commit).
 *
 * NOTE: Ink takes control of the terminal. Do not call this in test environments
 * unless using ink-testing-library.
 */
export function runReviewTUI(opts: RunReviewTUIOptions): Promise<ReviewState> {
  return new Promise<ReviewState>((resolve) => {
    let finalState: ReviewState = initialState(opts.items);

    function ReviewAppWithResolve() {
      const [state, setState] = useState<ReviewState>(() => initialState(opts.items));
      const { exit } = useApp();

      // Keep finalState in sync so the Promise captures the latest state.
      finalState = state;

      useInput((input, key) => {
        const action = keypressToAction(input, key);
        if (!action) return;

        const next = reduce(state, action);
        finalState = next;

        if (action.type === "commit" || action.type === "exit") {
          exit();
          resolve(next);
          return;
        }

        setState(next);
      });

      return renderFrame(state);
    }

    const { waitUntilExit } = render(React.createElement(ReviewAppWithResolve, null));

    // Fallback: resolve on process-level unmount (e.g. SIGTERM)
    waitUntilExit()
      .then(() => resolve(finalState))
      .catch(() => resolve(finalState));
  });
}
