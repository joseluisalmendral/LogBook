/**
 * DoingScreen — shows an in-flight action with its label, status, and result.
 *
 * Pure function: (state, dispatch) → ReactElement.
 * Uses React.createElement (no JSX) to match project conventions.
 *
 * States:
 *   promise="pending"  — action is running; show label + spinner placeholder
 *   promise="ok"       — action succeeded; show message + press enter to dismiss
 *   promise="err"      — action failed; show error message + press enter to dismiss
 *
 * On "press enter" the caller (Ink shell) dispatches { type: "doing.dismiss" }.
 * This screen is dumb — it does not call dispatch itself (useInput is in shell.ts).
 */

import React from "react";
import { Box, Text } from "ink";
import { Breadcrumb } from "../components/index.js";
import type { ShellState, ShellAction } from "../types.js";

// ---------------------------------------------------------------------------
// DoingScreen
// ---------------------------------------------------------------------------

export interface DoingScreenProps {
  state: ShellState;
  dispatch: (a: ShellAction) => void;
}

export function DoingScreen({ state, dispatch: _dispatch }: DoingScreenProps): React.ReactElement {
  const { screen } = state;
  if (screen.kind !== "doing") {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "red" }, "DoingScreen: invalid screen kind"),
    );
  }

  const { label, promise, message } = screen;

  // Pending state: show spinner placeholder + label
  if (promise === "pending") {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Breadcrumb, { path: ["LogBook", "Working..."] }),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(
        Box,
        { flexDirection: "row", gap: 1 },
        React.createElement(Text, { color: "yellow" }, "●"),
        React.createElement(Text, { bold: true }, label),
      ),
      React.createElement(Text, { dimColor: true }, ""),
      React.createElement(Text, { dimColor: true }, "Please wait..."),
    );
  }

  // OK state: action completed successfully
  if (promise === "ok") {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Breadcrumb, { path: ["LogBook", "Done"] }),
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(Text, { color: "green", bold: true }, `✓ ${label} — completed`),
      message
        ? React.createElement(
            Box,
            { flexDirection: "column", marginTop: 1 },
            React.createElement(Text, null, message),
          )
        : null,
      React.createElement(Text, { dimColor: true }, "─".repeat(60)),
      React.createElement(Text, { dimColor: true }, "Press enter to dismiss."),
    );
  }

  // Error state: action failed
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Breadcrumb, { path: ["LogBook", "Error"] }),
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, { color: "red", bold: true }, `✗ ${label} — failed`),
    message
      ? React.createElement(
          Box,
          { flexDirection: "column", marginTop: 1 },
          React.createElement(Text, { color: "red" }, message),
        )
      : null,
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, { dimColor: true }, "Press enter to dismiss."),
  );
}
