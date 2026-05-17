/**
 * HomeScreen — renders the LogBook dashboard home screen.
 *
 * Pure function: (state, dispatch) → ReactElement.
 * Uses React.createElement (no JSX) to match src/review/tui.ts convention.
 *
 * Layout:
 *   Banner (animated, line-reveal, cyan)
 *   Breadcrumb ["LogBook"]
 *   ─────────────────────────────────
 *   Project: /path/to/project  [standard]  [enabled]
 *   Token budget bar
 *   Quick stats: pending review N | ADRs M | lessons K
 *   ─────────────────────────────────
 *   Action menu (j/k to navigate, enter to select, > prefix on cursor)
 *   ─────────────────────────────────
 *   Recent activity (last 5 events)
 *   ─────────────────────────────────
 *   Keybindings footer
 */

import React from "react";
import { Box, Text } from "ink";
import {
  Banner,
  Breadcrumb,
  TokenBudgetBar,
  KeybindingsFooter,
} from "../components/index.js";
import type { ShellState, ShellAction } from "../types.js";
import { HOME_ACTIONS } from "../shell-flows.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HomeScreenProps {
  state: ShellState;
  dispatch: (a: ShellAction) => void;
}

// ---------------------------------------------------------------------------
// Menu item labels — human-readable display for each HOME_ACTION entry
// ---------------------------------------------------------------------------

const HOME_LABELS: Record<(typeof HOME_ACTIONS)[number], string> = {
  "build":                  "build            — generate docs",
  "review":                 "review           — review pending items",
  "summarize":              "summarize        — summarize milestone",
  "export-html":            "export-html      — export HTML report",
  "export-instructor-pack": "export-instructor-pack — export instructor pack",
  "configure":              "configure        — settings and options",
  "doctor":                 "doctor           — run token budget check",
  "install":                "install/update   — install or update LogBook",
  "uninstall":              "uninstall        — remove LogBook",
  "quit":                   "quit             — exit LogBook",
};

// Footer bindings for home screen
const HOME_BINDINGS = [
  { keys: "j/k", label: "navigate" },
  { keys: "enter", label: "select" },
  { keys: "q", label: "quit (confirm)" },
];

// ---------------------------------------------------------------------------
// HomeScreen
// ---------------------------------------------------------------------------

export function HomeScreen({ state, dispatch: _dispatch }: HomeScreenProps): React.ReactElement {
  const { snapshot, screen } = state;
  if (screen.kind !== "home") {
    // Guard: should not happen when used correctly
    return React.createElement(Box, null, React.createElement(Text, { color: "red" }, "HomeScreen: invalid screen kind"));
  }
  const { cursor } = screen;

  // --- Project header row
  const presetLabel = snapshot.preset ? `[${snapshot.preset}]` : "[unknown]";
  const statusLabel = snapshot.disabled ? "[disabled]" : "[enabled]";
  const projectPath = snapshot.projectRoot ?? "(no project)";

  // --- Quick stats row
  const statsText = `pending review: ${snapshot.pendingReview}  |  ADRs: ${snapshot.adrCount}  |  lessons: ${snapshot.lessonCount}`;

  // --- Action menu items
  const menuItems = HOME_ACTIONS.map((action, idx) => {
    const label = HOME_LABELS[action];
    const prefix = idx === cursor ? "> " : "  ";
    const isCurrent = idx === cursor;
    const colorProp = isCurrent ? { color: "cyan" as const } : {};
    return React.createElement(
      Text,
      { key: action, bold: isCurrent, ...colorProp },
      `${prefix}${label}`,
    );
  });

  // --- Recent events (last shown, newest first via slice/reverse logic)
  const events = snapshot.recentEvents.slice(-5).reverse();
  const eventItems = events.map((ev, idx) =>
    React.createElement(
      Text,
      { key: idx, dimColor: true },
      `${ev.ts.slice(0, 16).replace("T", " ")}  ${ev.type}  — ${ev.preview.slice(0, 60)}`,
    ),
  );

  return React.createElement(
    Box,
    { flexDirection: "column" },

    // Banner (animated line-reveal; auto-skips in tests / no-anim env)
    React.createElement(Banner, {}),

    // Breadcrumb
    React.createElement(Breadcrumb, { path: ["LogBook"] }),

    // Separator
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),

    // Project header
    React.createElement(
      Box,
      { flexDirection: "row", gap: 2 },
      React.createElement(Text, { bold: true }, projectPath),
      React.createElement(Text, { color: "yellow" }, presetLabel),
      React.createElement(Text, { color: snapshot.disabled ? "red" : "green" }, statusLabel),
    ),

    // Token budget bar
    React.createElement(TokenBudgetBar, {
      used: snapshot.fixedContextTokens,
      budget: snapshot.budget,
      width: 30,
    }),

    // Quick stats
    React.createElement(Text, { dimColor: true }, statsText),

    // Separator
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),

    // Action menu
    React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      ...menuItems,
    ),

    // Recent activity
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(Text, { dimColor: true, bold: true }, "Recent activity:"),
    React.createElement(
      Box,
      { flexDirection: "column" },
      ...eventItems,
    ),

    // Footer
    React.createElement(Text, { dimColor: true }, "─".repeat(60)),
    React.createElement(KeybindingsFooter, { bindings: HOME_BINDINGS }),
  );
}
