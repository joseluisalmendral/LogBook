/**
 * ReviewBridgeScreen — mounts the existing ReviewApp as a child component.
 *
 * Pure function: (state, dispatch) → ReactElement.
 * Uses React.createElement (no JSX) to match project conventions.
 *
 * Design decision (ADR-iter6-05):
 *   Mount ReviewApp as a CHILD component, NOT via a nested render() call.
 *   A nested render() would create a second Ink tree → double terminal control.
 *   The bridge adds a thin shell chrome (breadcrumb) above the review UI.
 *
 *   The onExit callback on ReviewApp dispatches { type: "back" } to the shell,
 *   returning to the home screen without closing the parent Ink tree.
 */

import React from "react";
import { Box } from "ink";
import { Breadcrumb } from "../components/index.js";
import { ReviewApp } from "../../review/tui.js";
import type { ShellState, ShellAction } from "../types.js";

// ---------------------------------------------------------------------------
// ReviewBridgeScreen
// ---------------------------------------------------------------------------

export interface ReviewBridgeScreenProps {
  state: ShellState;
  dispatch: (a: ShellAction) => void;
}

export function ReviewBridgeScreen({ state, dispatch }: ReviewBridgeScreenProps): React.ReactElement {
  const { screen } = state;
  if (screen.kind !== "review") {
    return React.createElement(
      Box,
      null,
    );
  }

  // The review items come from the nested ReviewState's items array.
  // When the bridge first mounts, items are empty (shell doesn't preload them);
  // the shell entrypoint (T5) will dispatch snapshot data or load items on
  // entering the review screen. For now we pass the nested state's items.
  const initialItems = screen.nested.items;

  // onExit: intercept ReviewApp exit and navigate back to home screen.
  // This prevents ReviewApp from calling useApp().exit() (which would close
  // the whole shell). Instead we dispatch { type: "back" } to the shell reducer.
  function onExit(): void {
    dispatch({ type: "back" });
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },

    // Shell chrome: breadcrumb header for visual consistency
    React.createElement(Breadcrumb, { path: ["LogBook", "Review"] }),

    // Mount ReviewApp as a child — same Ink tree, no nested render()
    React.createElement(ReviewApp, {
      initialItems,
      onExit,
    }),
  );
}
