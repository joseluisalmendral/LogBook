/**
 * TokenBudgetBar component — visual token-budget progress bar.
 *
 * Uses React.createElement (no JSX) to match src/review/tui.ts pattern.
 * Exports a pure formatTokenBar() helper for unit testing without Ink.
 *
 * Bar characters:
 *   █ (U+2588 full block) — filled portion
 *   ░ (U+2591 light shade) — empty portion
 *
 * Colors:
 *   green  → used < 80% of budget
 *   yellow → 80–99% of budget
 *   red    → ≥ 100% (over budget)
 *
 * Edge case: if used > budget, the visual bar is capped at 100% but the
 * count displays the real used value with an "OVER" indicator.
 */

import React from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILLED = "█";
const EMPTY = "░";
const DEFAULT_WIDTH = 30;

// ---------------------------------------------------------------------------
// Pure formatter (exported for unit testing without Ink)
// ---------------------------------------------------------------------------

/**
 * Format the token budget bar into a plain string.
 *
 * @param used    - tokens consumed
 * @param budget  - total allowed tokens
 * @param width   - bar character width (default 30)
 * @returns a string like "████████░░░░ 499 / 500"
 */
export function formatTokenBar(used: number, budget: number, width = DEFAULT_WIDTH): string {
  const ratio = budget > 0 ? Math.min(used / budget, 1) : 1;
  const filledCount = Math.floor(ratio * width);
  const emptyCount = width - filledCount;

  const bar = FILLED.repeat(filledCount) + EMPTY.repeat(emptyCount);
  const over = used > budget ? " OVER" : "";

  return `${bar} ${used} / ${budget}${over}`;
}

// ---------------------------------------------------------------------------
// Color helper
// ---------------------------------------------------------------------------

function barColor(used: number, budget: number): "green" | "yellow" | "red" {
  if (budget <= 0) return "red";
  const pct = used / budget;
  if (pct >= 1) return "red";
  if (pct >= 0.8) return "yellow";
  return "green";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TokenBudgetBarProps {
  /** tokens consumed */
  used: number;
  /** total budget (e.g. 500) */
  budget: number;
  /** bar character width (default 30) */
  width?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a colored token-budget bar.
 * Example: ████████████░░░░  499 / 500 tokens
 */
export function TokenBudgetBar(props: TokenBudgetBarProps): React.ReactElement {
  const { used, budget, width = DEFAULT_WIDTH } = props;
  const color = barColor(used, budget);
  const barText = formatTokenBar(used, budget, width);

  return React.createElement(
    Box,
    null,
    React.createElement(Text, { color }, barText),
  );
}
