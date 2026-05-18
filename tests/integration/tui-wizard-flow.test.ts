/**
 * Integration test — TUI install-wizard end-to-end keypress flow.
 *
 * REGRESSION CONTEXT (2026-05-18):
 *   A user reported "Enter no funciona y no se selecciona nada" the first
 *   time they launched the TUI on a non-installed project. The wizard's
 *   reducer was setting choices.preset on Enter but NOT advancing to step 2.
 *   1575 tests passed regardless. The 73 shell-flows reducer tests only
 *   asserted "select sets the choice" — they did not assert that select
 *   ALSO transitioned to the next step. Both old and new behaviors satisfied
 *   the test's expectation.
 *
 *   This file closes that coverage gap with a true end-to-end test: mount
 *   ShellApp via ink-testing-library, push keystrokes through stdin, assert
 *   the user-visible state at each step.
 *
 * Pattern: same as tests/integration/shell-tui-smoke.test.ts (gated behind
 * ink-testing-library availability).
 */

import { describe, it, expect } from "vitest";
import React from "react";
import type { ShellSnapshot } from "../../src/tui/types.js";

// ---------------------------------------------------------------------------
// Detect ink-testing-library availability
// ---------------------------------------------------------------------------

let inkTestingLibraryAvailable = false;
let render:
  | ((node: React.ReactNode) => {
      lastFrame: () => string;
      stdin: { write: (s: string) => void };
      unmount: () => void;
    })
  | undefined;

try {
  const lib = await import("ink-testing-library");
  render = lib.render as typeof render;
  inkTestingLibraryAvailable = true;
} catch {
  inkTestingLibraryAvailable = false;
}

// ---------------------------------------------------------------------------
// Fixture — snapshot of a project that is NOT installed.
// Routes ShellApp directly to the install wizard at step 1.
// ---------------------------------------------------------------------------

function makeUninstalledSnapshot(): ShellSnapshot {
  return {
    projectRoot: "/tmp/test-uninstalled-project",
    installed: false,
    disabled: false,
    manifestSize: 0,
    tokenBreakdown: {
      skill: 0,
      augmentClaudemd: 0,
      mcpToolDescriptions: 0,
      slashCommandDescriptions: 0,
      subagentDescriptions: 0,
      statusline: 0,
      sessionStart: 0,
    },
    fixedContextTokens: 0,
    budget: 500,
    recentEvents: [],
    pendingReview: 0,
    adrCount: 0,
    lessonCount: 0,
  };
}

/** Wait for Ink v5 to process input and re-render. */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("install-wizard end-to-end keypress flow (regression coverage)", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "mounts at wizard step 1 when project is not installed",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeUninstalledSnapshot();
      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap }),
      );

      await tick();
      const frame = instance.lastFrame();
      expect(frame).toContain("Step 1 of 3");
      expect(frame).toContain("Choose a preset");
      instance.unmount();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "Enter on step 1 saves the preset choice AND advances to step 2 (the bug)",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeUninstalledSnapshot();
      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap }),
      );

      await tick();
      // Sanity: we start on step 1
      expect(instance.lastFrame()).toContain("Step 1 of 3");

      // Press Enter (terminal Enter sends \r in raw mode)
      instance.stdin.write("\r");
      await tick();

      // Bug regression assertion: Enter must advance the wizard, not silently
      // mutate state. If this fails, the reducer reverted to the "save only,
      // require Tab to advance" behavior that confused the first user.
      const frame = instance.lastFrame();
      expect(frame).toContain("Step 2 of 3");
      expect(frame).toContain("provider"); // step 2 chooses provider
      instance.unmount();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "Enter on step 2 advances to step 3 with both choices preserved",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeUninstalledSnapshot();
      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap }),
      );

      await tick();
      // Step 1 → step 2
      instance.stdin.write("\r");
      await tick();
      expect(instance.lastFrame()).toContain("Step 2 of 3");

      // Step 2 → step 3
      instance.stdin.write("\r");
      await tick();
      const frame = instance.lastFrame();
      expect(frame).toContain("Step 3 of 3");
      // Step 3 shows the chosen preset (verifies choices survived the
      // transition; if the reducer wiped choices on step change, this
      // would render "(none)" or similar)
      expect(frame).toMatch(/Preset:\s+\w+/);
      instance.unmount();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "j moves the cursor down in step 1 (input capture sanity)",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeUninstalledSnapshot();
      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap }),
      );

      await tick();
      const before = instance.lastFrame();
      // Find which line starts with "> " — that's the cursor row
      const beforeCursorLine = before
        .split("\n")
        .find((line) => line.includes("> "));
      expect(beforeCursorLine).toBeDefined();

      instance.stdin.write("j");
      await tick();

      const after = instance.lastFrame();
      const afterCursorLine = after
        .split("\n")
        .find((line) => line.includes("> "));
      expect(afterCursorLine).toBeDefined();
      // Cursor row must have changed (j moves down)
      expect(afterCursorLine).not.toBe(beforeCursorLine);
      instance.unmount();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "Enter after j picks the cursored option (cursor + Enter integration)",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeUninstalledSnapshot();
      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap }),
      );

      await tick();
      // Move cursor down to "standard" preset (index 1)
      instance.stdin.write("j");
      await tick();
      // Confirm with Enter — advances AND saves the cursored value
      instance.stdin.write("\r");
      await tick();

      const frame = instance.lastFrame();
      expect(frame).toContain("Step 2 of 3");

      // Now advance to step 3 and confirm the preset was the cursored one.
      // Step 3 renders the preset with variable whitespace ("Preset:   standard"
      // or "Preset: standard" depending on which sub-block); use a regex.
      instance.stdin.write("\r");
      await tick();
      expect(instance.lastFrame()).toMatch(/Preset:\s+standard/);
      instance.unmount();
    },
  );
});
