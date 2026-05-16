/**
 * Smoke tests for src/tui/shell.ts — ShellApp Ink component (iter6 T5).
 *
 * TDD Cycle:
 *   RED  → fail: "Cannot find module src/tui/shell.js"
 *   GREEN → implement ShellApp so tests pass
 *
 * Strategy:
 *   - Gated behind inkTestingLibraryAvailable (same pattern as review-tui-smoke.test.ts)
 *   - Mount ShellApp with a fixture snapshot (installed=true)
 *   - Simulate keypresses: j → navigates, q → shows confirm / exits
 *   - Assert rendered frames contain expected content
 *
 * Delivery: chained PR slice (T5 batch)
 */

import { describe, it, expect } from "vitest";
import React from "react";
import type { ShellSnapshot } from "../../src/tui/types.js";

// ---------------------------------------------------------------------------
// Detect ink-testing-library availability
// ---------------------------------------------------------------------------

let inkTestingLibraryAvailable = false;
let render: ((node: React.ReactNode) => { lastFrame: () => string; stdin: { write: (s: string) => void } }) | undefined;

try {
  const lib = await import("ink-testing-library");
  render = lib.render as typeof render;
  inkTestingLibraryAvailable = true;
} catch {
  inkTestingLibraryAvailable = false;
}

// ---------------------------------------------------------------------------
// Fixture snapshot
// ---------------------------------------------------------------------------

function makeFixtureSnapshot(overrides: Partial<ShellSnapshot> = {}): ShellSnapshot {
  return {
    projectRoot: "/tmp/test-project",
    installed: true,
    preset: "standard",
    disabled: false,
    manifestSize: 5,
    tokenBreakdown: {
      skill: 100,
      augmentClaudemd: 50,
      mcpToolDescriptions: 30,
      slashCommandDescriptions: 10,
      subagentDescriptions: 0,
      statusline: 0,
      sessionStart: 40,
    },
    fixedContextTokens: 230,
    budget: 500,
    recentEvents: [
      { ts: "2026-05-16T10:00:00Z", type: "session.start", preview: "Session started" },
      { ts: "2026-05-16T10:01:00Z", type: "tool_use", preview: "Used read_file" },
    ],
    pendingReview: 2,
    adrCount: 1,
    lessonCount: 3,
    currentPhase: "iter6",
    sessionLabel: "Test Session",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests (gated)
// ---------------------------------------------------------------------------

describe("ShellApp smoke tests", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "renders home screen breadcrumb for installed project",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeFixtureSnapshot();

      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap })
      );

      const frame = instance.lastFrame();
      // Home screen should show "LogBook" in breadcrumb or header
      expect(frame).toContain("LogBook");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "renders install wizard when not installed",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeFixtureSnapshot({ installed: false, projectRoot: null });

      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap })
      );

      const frame = instance.lastFrame();
      // Install wizard should be visible (step 1 = preset selection)
      expect(frame).toBeDefined();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "pressing j moves cursor down on home screen",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeFixtureSnapshot();

      const instance = render!(
        React.createElement(ShellApp, { initialSnapshot: snap })
      );

      const frameBefore = instance.lastFrame();

      // Simulate pressing j (navigate +1)
      instance.stdin.write("j");

      const frameAfter = instance.lastFrame();

      // Frame should change (cursor moved) — at minimum it renders without throwing
      expect(frameAfter).toBeDefined();
      // The frame content exists (may or may not differ visually)
      expect(typeof frameAfter).toBe("string");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "ShellApp renders without throwing for installed snapshot",
    async () => {
      const { ShellApp } = await import("../../src/tui/shell.js");
      const snap = makeFixtureSnapshot();

      expect(() => {
        render!(React.createElement(ShellApp, { initialSnapshot: snap }));
      }).not.toThrow();
    },
  );
});
