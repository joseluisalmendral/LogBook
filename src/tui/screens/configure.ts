/**
 * ConfigureScreen — renders the LogBook configuration menu.
 *
 * Pure function: (state, dispatch) → ReactElement.
 * Uses React.createElement (no JSX) to match project conventions.
 *
 * Menu items map to CONFIGURE_ACTIONS from shell-flows.ts.
 * Cursor highlight uses ">" prefix on the active item.
 */

import React from "react";
import { Box, Text } from "ink";
import { Breadcrumb, KeybindingsFooter } from "../components/index.js";
import type { ShellState, ShellAction } from "../types.js";
import { CONFIGURE_ACTIONS } from "../shell-flows.js";

// ---------------------------------------------------------------------------
// Human-readable labels per configure action
// ---------------------------------------------------------------------------

const CONFIGURE_LABELS: Record<(typeof CONFIGURE_ACTIONS)[number], string> = {
  "switch-preset":    "switch-preset    — change the installed preset",
  "toggle-disabled":  "toggle-disabled  — enable or disable LogBook hooks",
  "manage-providers": "manage-providers — view and configure AI providers",
  "set-phase":        "set-phase        — set the current development phase",
  "rename-session":   "rename-session   — rename the active session",
  "rerun-doctor":     "rerun-doctor     — re-run the token budget check",
  "back":             "back             — return to home screen",
};

// Footer bindings for configure screen
const CONFIGURE_BINDINGS = [
  { keys: "j/k", label: "navigate" },
  { keys: "enter", label: "select" },
  { keys: "esc", label: "back" },
];

// ---------------------------------------------------------------------------
// ConfigureScreen
// ---------------------------------------------------------------------------

export interface ConfigureScreenProps {
  state: ShellState;
  dispatch: (a: ShellAction) => void;
}

export function ConfigureScreen({ state, dispatch: _dispatch }: ConfigureScreenProps): React.ReactElement {
  const { screen, snapshot } = state;
  if (screen.kind !== "configure") {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "red" }, "ConfigureScreen: invalid screen kind"),
    );
  }

  const { cursor } = screen;
  const presetLabel = snapshot.preset ? `  Current preset: ${snapshot.preset}` : "";
  const statusLabel = snapshot.disabled ? "  Status: DISABLED" : "  Status: enabled";

  const menuItems = CONFIGURE_ACTIONS.map((action, idx) => {
    const isSelected = idx === cursor;
    const prefix = isSelected ? "> " : "  ";
    const label = CONFIGURE_LABELS[action];
    const colorProp = isSelected ? { color: "cyan" as const } : {};
    return React.createElement(
      Text,
      { key: action, bold: isSelected, ...colorProp },
      `${prefix}${label}`,
    );
  });

  return React.createElement(
    Box,
    { flexDirection: "column" },

    // Breadcrumb
    React.createElement(Breadcrumb, { path: ["LogBook", "Configure"] }),

    // Separator
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),

    // Current status info
    React.createElement(Text, { dimColor: true }, presetLabel),
    React.createElement(Text, { dimColor: true }, statusLabel),

    // Separator
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),

    // Menu
    React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      ...menuItems,
    ),

    // Footer
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(KeybindingsFooter, { bindings: CONFIGURE_BINDINGS }),
  );
}
