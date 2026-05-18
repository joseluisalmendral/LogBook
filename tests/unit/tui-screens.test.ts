/**
 * Unit tests for src/tui/screens — T4 screen renderer components.
 *
 * TDD Cycle:
 *   RED  → fail: "Cannot find module src/tui/screens/..."
 *   GREEN → implement all 5 screen files so tests pass
 *
 * Strategy:
 *   1. PURE function tests: calling each renderer with a fixture state
 *      returns a defined React element (no exceptions). No Ink needed.
 *   2. Ink render tests: gated behind inkTestingLibraryAvailable.
 *   3. ReviewApp onExit: verify additive prop doesn't break existing behavior.
 *
 * Uses React.createElement (no JSX) to match project conventions.
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import type { ShellState, ShellSnapshot } from "../../src/tui/types.js";

// ---------------------------------------------------------------------------
// Detect ink-testing-library availability
// ---------------------------------------------------------------------------

let inkTestingLibraryAvailable = false;
try {
  await import("ink-testing-library");
  inkTestingLibraryAvailable = true;
} catch {
  inkTestingLibraryAvailable = false;
}

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ShellSnapshot> = {}): ShellSnapshot {
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
    fixedContextTokens: 200,
    budget: 500,
    recentEvents: [
      { ts: "2026-05-16T10:00:00Z", type: "session.start", preview: "Session started" },
      { ts: "2026-05-16T10:01:00Z", type: "tool_use", preview: "Used read_file" },
    ],
    pendingReview: 3,
    adrCount: 2,
    lessonCount: 5,
    currentPhase: "development",
    sessionLabel: "iter6-testing",
    ...overrides,
  };
}

function makeHomeState(): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: { kind: "home", cursor: 0 },
  };
}

function makeInstallStep1State(): ShellState {
  return {
    snapshot: makeSnapshot({ installed: false }),
    screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
  };
}

function makeInstallStep3State(): ShellState {
  return {
    snapshot: makeSnapshot({ installed: false }),
    screen: {
      kind: "install",
      step: 3,
      choices: { preset: "standard", provider: "api-key" },
      cursor: 0,
    },
  };
}

function makeConfigureState(): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: { kind: "configure", cursor: 0 },
  };
}

function makeReviewState(): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: {
      kind: "review",
      nested: {
        items: [],
        index: 0,
        decisions: {},
        teachingValues: {},
        exiting: false,
        committed: false,
      },
    },
  };
}

function makeDoingState(
  promise: "pending" | "ok" | "err" = "pending",
  message?: string,
): ShellState {
  const screen = message !== undefined
    ? { kind: "doing" as const, label: "Building docs...", promise, message, returnTo: "home" as const }
    : { kind: "doing" as const, label: "Building docs...", promise, returnTo: "home" as const };
  return {
    snapshot: makeSnapshot(),
    screen,
  };
}

const noop = () => {};

// ---------------------------------------------------------------------------
// HomeScreen — pure function tests (no Ink needed)
// ---------------------------------------------------------------------------

describe("HomeScreen pure function", () => {
  it("returns a defined React element with fixture state", async () => {
    const { HomeScreen } = await import("../../src/tui/screens/home.js");
    const el = HomeScreen({ state: makeHomeState(), dispatch: noop });
    expect(el).toBeDefined();
    expect(typeof el).toBe("object");
    expect(el).not.toBeNull();
  });

  it("accepts cursor=5 without throwing", async () => {
    const { HomeScreen } = await import("../../src/tui/screens/home.js");
    const state: ShellState = { ...makeHomeState(), screen: { kind: "home", cursor: 5 } };
    const el = HomeScreen({ state, dispatch: noop });
    expect(el).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// HomeScreen — Ink render (gated)
// ---------------------------------------------------------------------------

describe("HomeScreen Ink render", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "renders LogBook title and project path",
    async () => {
      const { render } = await import("ink-testing-library");
      const { HomeScreen } = await import("../../src/tui/screens/home.js");
      const state = makeHomeState();
      const { lastFrame } = render(
        createElement(HomeScreen, { state, dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("LogBook");
      expect(frame).toContain("/tmp/test-project");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "renders all home action menu labels",
    async () => {
      const { render } = await import("ink-testing-library");
      const { HomeScreen } = await import("../../src/tui/screens/home.js");
      const { lastFrame } = render(
        createElement(HomeScreen, { state: makeHomeState(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      // Must contain at least some action labels
      expect(frame).toContain("build");
      expect(frame).toContain("review");
      expect(frame).toContain("configure");
      expect(frame).toContain("quit");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "renders pending review count in stats",
    async () => {
      const { render } = await import("ink-testing-library");
      const { HomeScreen } = await import("../../src/tui/screens/home.js");
      const { lastFrame } = render(
        createElement(HomeScreen, { state: makeHomeState(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      // Snapshot has pendingReview=3
      expect(frame).toContain("3");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "renders cursor > prefix on selected action",
    async () => {
      const { render } = await import("ink-testing-library");
      const { HomeScreen } = await import("../../src/tui/screens/home.js");
      const { lastFrame } = render(
        createElement(HomeScreen, { state: makeHomeState(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      // Cursor at 0 → first action gets > prefix
      expect(frame).toContain(">");
    },
  );
});

// ---------------------------------------------------------------------------
// InstallWizardScreen — pure function tests
// ---------------------------------------------------------------------------

describe("InstallWizardScreen pure function", () => {
  it("step 1: returns a defined React element", async () => {
    const { InstallWizardScreen } = await import("../../src/tui/screens/install-wizard.js");
    const el = InstallWizardScreen({ state: makeInstallStep1State(), dispatch: noop });
    expect(el).toBeDefined();
    expect(el).not.toBeNull();
  });

  it("step 3: returns a defined React element with choices", async () => {
    const { InstallWizardScreen } = await import("../../src/tui/screens/install-wizard.js");
    const el = InstallWizardScreen({ state: makeInstallStep3State(), dispatch: noop });
    expect(el).toBeDefined();
    expect(el).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// InstallWizardScreen — Ink render (gated)
// ---------------------------------------------------------------------------

describe("InstallWizardScreen Ink render", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "step 1: renders all 3 preset names",
    async () => {
      const { render } = await import("ink-testing-library");
      const { InstallWizardScreen } = await import("../../src/tui/screens/install-wizard.js");
      const { lastFrame } = render(
        createElement(InstallWizardScreen, { state: makeInstallStep1State(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("minimal");
      expect(frame).toContain("standard");
      expect(frame).toContain("teaching");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "step 3: renders Install button and preview",
    async () => {
      const { render } = await import("ink-testing-library");
      const { InstallWizardScreen } = await import("../../src/tui/screens/install-wizard.js");
      const { lastFrame } = render(
        createElement(InstallWizardScreen, { state: makeInstallStep3State(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Install");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "step 1: renders breadcrumb and step progress with Preset highlighted",
    async () => {
      const { render } = await import("ink-testing-library");
      const { InstallWizardScreen } = await import("../../src/tui/screens/install-wizard.js");
      const { lastFrame } = render(
        createElement(InstallWizardScreen, { state: makeInstallStep1State(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      // New visual: breadcrumb "LogBook > Install" + 3-step progress
      // ([●] Preset → [○] Provider → [○] Confirm).
      expect(frame).toContain("Install");
      expect(frame).toContain("Preset");
      expect(frame).toContain("Provider");
      expect(frame).toContain("Confirm");
      // The "current" step marker for step 1
      expect(frame).toContain("[●] Preset");
    },
  );
});

// ---------------------------------------------------------------------------
// ConfigureScreen — pure function tests
// ---------------------------------------------------------------------------

describe("ConfigureScreen pure function", () => {
  it("returns a defined React element", async () => {
    const { ConfigureScreen } = await import("../../src/tui/screens/configure.js");
    const el = ConfigureScreen({ state: makeConfigureState(), dispatch: noop });
    expect(el).toBeDefined();
    expect(el).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ConfigureScreen — Ink render (gated)
// ---------------------------------------------------------------------------

describe("ConfigureScreen Ink render", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "renders configure action labels",
    async () => {
      const { render } = await import("ink-testing-library");
      const { ConfigureScreen } = await import("../../src/tui/screens/configure.js");
      const { lastFrame } = render(
        createElement(ConfigureScreen, { state: makeConfigureState(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Configure");
      expect(frame).toContain("switch-preset");
      expect(frame).toContain("toggle-disabled");
    },
  );
});

// ---------------------------------------------------------------------------
// ReviewBridgeScreen — pure function tests
// ---------------------------------------------------------------------------

describe("ReviewBridgeScreen pure function", () => {
  it("returns a defined React element", async () => {
    const { ReviewBridgeScreen } = await import("../../src/tui/screens/review-bridge.js");
    const el = ReviewBridgeScreen({ state: makeReviewState(), dispatch: noop });
    expect(el).toBeDefined();
    expect(el).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ReviewBridgeScreen — Ink render (gated)
// ---------------------------------------------------------------------------

describe("ReviewBridgeScreen Ink render", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "renders review breadcrumb",
    async () => {
      const { render } = await import("ink-testing-library");
      const { ReviewBridgeScreen } = await import("../../src/tui/screens/review-bridge.js");
      const { lastFrame } = render(
        createElement(ReviewBridgeScreen, { state: makeReviewState(), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("LogBook");
      expect(frame).toContain("Review");
    },
  );
});

// ---------------------------------------------------------------------------
// DoingScreen — render tests (uses hooks; must render via ink-testing-library)
// ---------------------------------------------------------------------------

describe("DoingScreen pure function", () => {
  // DoingScreen uses React hooks (useState/useEffect for spinner), so it must
  // be rendered via ink-testing-library rather than called directly.
  it.skipIf(!inkTestingLibraryAvailable)(
    "pending: renders without throwing",
    async () => {
      const { render } = await import("ink-testing-library");
      const { DoingScreen } = await import("../../src/tui/screens/doing.js");
      expect(() => {
        render(createElement(DoingScreen, { state: makeDoingState("pending"), dispatch: noop }));
      }).not.toThrow();
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "err: renders without throwing (error message state)",
    async () => {
      const { render } = await import("ink-testing-library");
      const { DoingScreen } = await import("../../src/tui/screens/doing.js");
      expect(() => {
        render(createElement(DoingScreen, { state: makeDoingState("err", "Something went wrong"), dispatch: noop }));
      }).not.toThrow();
    },
  );
});

// ---------------------------------------------------------------------------
// DoingScreen — Ink render (gated)
// ---------------------------------------------------------------------------

describe("DoingScreen Ink render", () => {
  it.skipIf(!inkTestingLibraryAvailable)(
    "pending: renders label text",
    async () => {
      const { render } = await import("ink-testing-library");
      const { DoingScreen } = await import("../../src/tui/screens/doing.js");
      const { lastFrame } = render(
        createElement(DoingScreen, { state: makeDoingState("pending"), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Building docs...");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "err: renders error message and press enter hint",
    async () => {
      const { render } = await import("ink-testing-library");
      const { DoingScreen } = await import("../../src/tui/screens/doing.js");
      const { lastFrame } = render(
        createElement(DoingScreen, { state: makeDoingState("err", "Build failed"), dispatch: noop }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Build failed");
      expect(frame).toMatch(/enter/i);
    },
  );
});

// ---------------------------------------------------------------------------
// screens/index.ts barrel
// ---------------------------------------------------------------------------

describe("src/tui/screens/index.ts barrel", () => {
  it("re-exports all 5 screen components", async () => {
    const idx = await import("../../src/tui/screens/index.js");
    expect(typeof idx.HomeScreen).toBe("function");
    expect(typeof idx.InstallWizardScreen).toBe("function");
    expect(typeof idx.ConfigureScreen).toBe("function");
    expect(typeof idx.ReviewBridgeScreen).toBe("function");
    expect(typeof idx.DoingScreen).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ReviewApp onExit prop — additive backward-compat tests
// ---------------------------------------------------------------------------

describe("ReviewApp onExit prop", () => {
  it("module exports ReviewApp with no breakage", async () => {
    const mod = await import("../../src/review/tui.js");
    expect(typeof mod.ReviewApp).toBe("function");
  });

  it.skipIf(!inkTestingLibraryAvailable)(
    "ReviewApp without onExit still renders normally (backward compat)",
    async () => {
      const { render } = await import("ink-testing-library");
      const { ReviewApp } = await import("../../src/review/tui.js");
      // No onExit → legacy behavior (uses useApp().exit internally)
      const { lastFrame } = render(
        createElement(ReviewApp, { initialItems: [] }),
      );
      const frame = lastFrame() ?? "";
      // Empty items renders the no-items message
      expect(frame).toContain("No items");
    },
  );

  it.skipIf(!inkTestingLibraryAvailable)(
    "ReviewApp accepts onExit prop (additive)",
    async () => {
      const { render } = await import("ink-testing-library");
      const { ReviewApp } = await import("../../src/review/tui.js");
      const onExit = vi.fn();
      // Should render without error even when onExit is provided
      const { lastFrame } = render(
        createElement(ReviewApp, { initialItems: [], onExit }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("No items");
      // onExit is not called just by rendering
      expect(onExit).not.toHaveBeenCalled();
    },
  );
});
