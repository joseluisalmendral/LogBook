/**
 * ModalConfirm component — a centered yes/no confirmation overlay.
 *
 * Uses React.createElement (no JSX) to match src/review/tui.ts pattern.
 * Captures y/n/enter/esc keypresses via Ink's useInput hook.
 *
 * Key bindings:
 *   y / enter → calls onYes
 *   n / esc   → calls onNo
 */

import React from "react";
import { Box, Text, useInput } from "ink";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ModalConfirmProps {
  /** The confirmation question to show */
  message: string;
  /** Called when the user confirms (y or enter) */
  onYes: () => void;
  /** Called when the user cancels (n or esc) */
  onNo: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a centered confirmation dialog with y/n hints.
 * Captures keyboard input directly via useInput.
 */
export function ModalConfirm(props: ModalConfirmProps): React.ReactElement {
  const { message, onYes, onNo } = props;

  useInput((input, key) => {
    if (input === "y" || key.return) {
      onYes();
      return;
    }
    if (input === "n" || key.escape) {
      onNo();
      return;
    }
  });

  return React.createElement(
    Box,
    {
      flexDirection: "column",
      alignItems: "center",
      borderStyle: "single",
      padding: 1,
    },
    React.createElement(Text, { bold: true }, message),
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, null, "[y] yes  [n] no"),
    ),
  );
}
