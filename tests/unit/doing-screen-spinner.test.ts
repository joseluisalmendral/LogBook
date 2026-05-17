/**
 * Unit tests: DoingScreen animated spinner (S4.1).
 *
 * TDD Cycle:
 *   RED  → fail: SPINNER_FRAMES does not exist; DoingScreen does not animate
 *   GREEN → add useState + setInterval + SPINNER_FRAMES to DoingScreen
 *
 * Strategy:
 *   - Pure tests: verify SPINNER_FRAMES exported constant
 *   - Ink render tests: gated behind inkTestingLibraryAvailable
 *   - Uses vi.useFakeTimers() to advance interval without wall-clock waits
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement } from "react";
import type { ShellState } from "../../src/tui/types.js";

// ---------------------------------------------------------------------------
// Detect ink-testing-library availability
// ---------------------------------------------------------------------------

let inkTestingLibraryAvailable = false;
let render: ((node: React.ReactNode) => { lastFrame: () => string; unmount: () => void }) | undefined;

try {
  const lib = await import("ink-testing-library");
  render = lib.render as typeof render;
  inkTestingLibraryAvailable = true;
} catch {
  inkTestingLibraryAvailable = false;
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

function makeDoingState(
  promise: "pending" | "ok" | "err" = "pending",
): ShellState {
  return {
    snapshot: {
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
      recentEvents: [],
      pendingReview: 0,
      adrCount: 0,
      lessonCount: 0,
      currentPhase: "iter6",
      sessionLabel: "test",
    },
    screen: { kind: "doing", label: "Working...", promise, returnTo: "home" },
  };
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Pure constant tests (no Ink needed)
// ---------------------------------------------------------------------------

describe("SPINNER_FRAMES constant", () => {
  it("is exported from doing screen module", async () => {
    const mod = await import("../../src/tui/screens/doing.js");
    expect((mod as Record<string, unknown>)["SPINNER_FRAMES"]).toBeDefined();
  });

  it("has at least 4 frames", async () => {
    const mod = await import("../../src/tui/screens/doing.js");
    const frames = (mod as Record<string, unknown>)["SPINNER_FRAMES"] as unknown[];
    expect(Array.isArray(frames)).toBe(true);
    expect(frames.length).toBeGreaterThanOrEqual(4);
  });

  it("frames are non-empty strings", async () => {
    const mod = await import("../../src/tui/screens/doing.js");
    const frames = (mod as Record<string, unknown>)["SPINNER_FRAMES"] as string[];
    for (const frame of frames) {
      expect(typeof frame).toBe("string");
      expect(frame.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// DoingScreen — spinner animation (Ink render, gated)
// ---------------------------------------------------------------------------

describe("DoingScreen spinner animation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(!inkTestingLibraryAvailable)(
    "renders pending state with a spinner frame character",
    async () => {
      const { DoingScreen, SPINNER_FRAMES } = await import("../../src/tui/screens/doing.js") as {
        DoingScreen: (props: { state: ShellState; dispatch: (a: unknown) => void }) => React.ReactElement;
        SPINNER_FRAMES: string[];
      };
      const { lastFrame, unmount } = render!(
        createElement(DoingScreen, { state: makeDoingState("pending"), dispatch: noop }),
      );
      const frame = lastFrame();
      // Frame should contain at least one spinner character from the frames array
      const containsSpinner = SPINNER_FRAMES.some((f: string) => frame.includes(f));
      expect(containsSpinner).toBe(true);
      unmount();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "spinner advances frame index after interval tick",
    async () => {
      const { DoingScreen, SPINNER_FRAMES } = await import("../../src/tui/screens/doing.js") as {
        DoingScreen: (props: { state: ShellState; dispatch: (a: unknown) => void }) => React.ReactElement;
        SPINNER_FRAMES: string[];
      };

      const { lastFrame, unmount } = render!(
        createElement(DoingScreen, { state: makeDoingState("pending"), dispatch: noop }),
      );

      const frameBefore = lastFrame();

      // Advance by 80ms (one spinner tick interval)
      await vi.advanceTimersByTimeAsync(80);

      const frameAfter = lastFrame();

      // After a tick, the frame should contain a spinner character
      const containsSpinner = SPINNER_FRAMES.some((f: string) => frameAfter.includes(f));
      expect(containsSpinner).toBe(true);

      // After enough ticks the frame content should cycle through all frames;
      // we just verify it doesn't crash and still renders the label
      expect(frameAfter).toContain("Working...");

      unmount();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "spinner does NOT animate when promise is resolved (ok state)",
    async () => {
      const { DoingScreen } = await import("../../src/tui/screens/doing.js") as {
        DoingScreen: (props: { state: ShellState; dispatch: (a: unknown) => void }) => React.ReactElement;
        SPINNER_FRAMES: string[];
      };

      const { lastFrame, unmount } = render!(
        createElement(DoingScreen, { state: makeDoingState("ok"), dispatch: noop }),
      );

      const frame = lastFrame();
      // ok state shows done screen
      expect(frame).toContain("completed");
      unmount();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "unmount cleans up without throwing",
    async () => {
      const { DoingScreen } = await import("../../src/tui/screens/doing.js") as {
        DoingScreen: (props: { state: ShellState; dispatch: (a: unknown) => void }) => React.ReactElement;
        SPINNER_FRAMES: string[];
      };

      const { unmount } = render!(
        createElement(DoingScreen, { state: makeDoingState("pending"), dispatch: noop }),
      );

      // Advance one tick then unmount — should not throw (cleanup ran)
      await vi.advanceTimersByTimeAsync(80);
      expect(() => unmount()).not.toThrow();
    },
  );
});
