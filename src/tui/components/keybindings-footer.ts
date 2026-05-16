/**
 * KeybindingsFooter component — renders a one-line key binding hint bar.
 *
 * Uses React.createElement (no JSX) to match src/review/tui.ts pattern.
 * Styling: borderStyle "single" + dimColor, same as review/tui.ts footer.
 */

import React from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Pure formatter (exported for unit testing without Ink)
// ---------------------------------------------------------------------------

export interface KeyBinding {
  /** e.g. "j/k", "↑↓", "enter", "esc" */
  keys: string;
  /** e.g. "navigate", "select", "back" */
  label: string;
}

/**
 * Format bindings array into a single hint string.
 * Example: [{ keys: "j/k", label: "navigate" }, { keys: "q", label: "quit" }]
 *   → "[j/k] navigate  [q] quit"
 * Empty array → "".
 */
export function formatKeybindingsLine(bindings: KeyBinding[]): string {
  if (bindings.length === 0) return "";
  return bindings.map((b) => `[${b.keys}] ${b.label}`).join("  ");
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KeybindingsFooterProps {
  bindings: KeyBinding[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders one line of key binding hints inside a single-border box at the
 * bottom of a screen. Wraps if the line exceeds terminal width.
 */
export function KeybindingsFooter(props: KeybindingsFooterProps): React.ReactElement {
  return React.createElement(
    Box,
    { borderStyle: "single", flexWrap: "wrap" },
    React.createElement(
      Text,
      { dimColor: true },
      formatKeybindingsLine(props.bindings),
    ),
  );
}
