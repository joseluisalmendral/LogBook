/**
 * shell-flows.test.ts — Exhaustive reducer matrix for src/tui/shell-flows.ts
 *
 * TDD: tests written BEFORE implementation (T2.2 RED, T2.4 RED).
 * All cases are pure — no I/O, no Ink imports.
 *
 * Cursor policy (mirroring src/review/flows.ts):
 *   - navigate +1 past last  → CLAMP at last (no-op)
 *   - navigate -1 below 0    → CLAMP at 0    (no-op)
 * This matches review/flows.ts Math.min / Math.max clamping.
 */

import { describe, it, expect } from "vitest";
import { initialState, reduce, HOME_MENU_LEN, CONFIGURE_MENU_LEN, INSTALL_STEP1_LEN, INSTALL_STEP2_LEN } from "../../src/tui/shell-flows.js";
import type { ShellSnapshot, ShellState, ShellAction, InstallWizardChoices } from "../../src/tui/types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ShellSnapshot> = {}): ShellSnapshot {
  return {
    projectRoot: "/tmp/test-project",
    installed: true,
    preset: "minimal",
    disabled: false,
    manifestSize: 5,
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
    ...overrides,
  };
}

function dispatch(state: ShellState, action: ShellAction): ShellState {
  return reduce(state, action);
}

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

describe("initialState", () => {
  it("installed=true → screen.kind === 'home', cursor=0", () => {
    const snap = makeSnapshot({ installed: true });
    const state = initialState(snap);
    expect(state.screen.kind).toBe("home");
    expect(state.snapshot).toBe(snap);
    if (state.screen.kind === "home") {
      expect(state.screen.cursor).toBe(0);
    }
  });

  it("installed=false → screen.kind === 'install', step=1, cursor=0", () => {
    const snap = makeSnapshot({ installed: false });
    const state = initialState(snap);
    expect(state.screen.kind).toBe("install");
    if (state.screen.kind === "install") {
      expect(state.screen.step).toBe(1);
      expect(state.screen.cursor).toBe(0);
      expect(state.screen.choices).toEqual({});
    }
  });

  it("snapshot is preserved in returned state", () => {
    const snap = makeSnapshot({ installed: true, adrCount: 3 });
    const state = initialState(snap);
    expect(state.snapshot.adrCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// navigate — home screen
// ---------------------------------------------------------------------------

describe("navigate on home", () => {
  function homeState(cursor: number): ShellState {
    return {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor },
    };
  }

  it("cursor 0, navigate +1 → cursor 1", () => {
    const s = dispatch(homeState(0), { type: "navigate", delta: 1 });
    if (s.screen.kind === "home") expect(s.screen.cursor).toBe(1);
  });

  it("cursor 1, navigate +1 → cursor 2", () => {
    const s = dispatch(homeState(1), { type: "navigate", delta: 1 });
    if (s.screen.kind === "home") expect(s.screen.cursor).toBe(2);
  });

  it("cursor 0, navigate -1 → clamps at 0 (no-op)", () => {
    const s = dispatch(homeState(0), { type: "navigate", delta: -1 });
    if (s.screen.kind === "home") expect(s.screen.cursor).toBe(0);
  });

  it("cursor at HOME_MENU_LEN-1, navigate +1 → clamps at HOME_MENU_LEN-1 (no-op)", () => {
    const last = HOME_MENU_LEN - 1;
    const s = dispatch(homeState(last), { type: "navigate", delta: 1 });
    if (s.screen.kind === "home") expect(s.screen.cursor).toBe(last);
  });

  it("cursor at HOME_MENU_LEN-1, navigate -1 → cursor HOME_MENU_LEN-2", () => {
    const last = HOME_MENU_LEN - 1;
    const s = dispatch(homeState(last), { type: "navigate", delta: -1 });
    if (s.screen.kind === "home") expect(s.screen.cursor).toBe(last - 1);
  });

  it("navigate does not mutate input state", () => {
    const original = homeState(0);
    dispatch(original, { type: "navigate", delta: 1 });
    if (original.screen.kind === "home") expect(original.screen.cursor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// navigate — install step 1 (INSTALL_STEP1_LEN options)
// ---------------------------------------------------------------------------

describe("navigate on install step 1", () => {
  function installStep1State(cursor: number): ShellState {
    return {
      snapshot: makeSnapshot({ installed: false }),
      screen: { kind: "install", step: 1, choices: {}, cursor },
    };
  }

  it("cursor 0, navigate +1 → cursor 1", () => {
    const s = dispatch(installStep1State(0), { type: "navigate", delta: 1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(1);
  });

  it("cursor 1, navigate +1 → cursor 2", () => {
    const s = dispatch(installStep1State(1), { type: "navigate", delta: 1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(2);
  });

  it("cursor INSTALL_STEP1_LEN-1, navigate +1 → clamps at INSTALL_STEP1_LEN-1", () => {
    const last = INSTALL_STEP1_LEN - 1;
    const s = dispatch(installStep1State(last), { type: "navigate", delta: 1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(last);
  });

  it("cursor 0, navigate -1 → clamps at 0", () => {
    const s = dispatch(installStep1State(0), { type: "navigate", delta: -1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(0);
  });

  it("cursor 2, navigate -1 → cursor 1", () => {
    const s = dispatch(installStep1State(2), { type: "navigate", delta: -1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// navigate — install step 2 (INSTALL_STEP2_LEN options)
// ---------------------------------------------------------------------------

describe("navigate on install step 2", () => {
  function installStep2State(cursor: number): ShellState {
    return {
      snapshot: makeSnapshot({ installed: false }),
      screen: { kind: "install", step: 2, choices: { preset: "minimal" }, cursor },
    };
  }

  it("cursor 0, navigate +1 → cursor 1", () => {
    const s = dispatch(installStep2State(0), { type: "navigate", delta: 1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(1);
  });

  it("cursor INSTALL_STEP2_LEN-1, navigate +1 → clamps", () => {
    const last = INSTALL_STEP2_LEN - 1;
    const s = dispatch(installStep2State(last), { type: "navigate", delta: 1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(last);
  });

  it("cursor 0, navigate -1 → clamps at 0", () => {
    const s = dispatch(installStep2State(0), { type: "navigate", delta: -1 });
    if (s.screen.kind === "install") expect(s.screen.cursor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// navigate — configure screen
// ---------------------------------------------------------------------------

describe("navigate on configure", () => {
  function configureState(cursor: number): ShellState {
    return {
      snapshot: makeSnapshot(),
      screen: { kind: "configure", cursor },
    };
  }

  it("cursor 0, navigate +1 → cursor 1", () => {
    const s = dispatch(configureState(0), { type: "navigate", delta: 1 });
    if (s.screen.kind === "configure") expect(s.screen.cursor).toBe(1);
  });

  it("cursor CONFIGURE_MENU_LEN-1, navigate +1 → clamps", () => {
    const last = CONFIGURE_MENU_LEN - 1;
    const s = dispatch(configureState(last), { type: "navigate", delta: 1 });
    if (s.screen.kind === "configure") expect(s.screen.cursor).toBe(last);
  });

  it("cursor 0, navigate -1 → clamps at 0", () => {
    const s = dispatch(configureState(0), { type: "navigate", delta: -1 });
    if (s.screen.kind === "configure") expect(s.screen.cursor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// select — home screen
// ---------------------------------------------------------------------------

describe("select on home", () => {
  function homeState(cursor: number, installed = true): ShellState {
    return {
      snapshot: makeSnapshot({ installed }),
      screen: { kind: "home", cursor },
    };
  }

  // HOME_ACTIONS order (0-indexed, slice 19 removed export-instructor-pack):
  // 0=build, 1=review, 2=summarize, 3=export-html, 4=configure,
  // 5=doctor, 6=install, 7=uninstall, 8=quit
  //
  // We test structural behaviour: some cursors → doing, install → install, quit → exiting

  it("cursor mapped to 'review' → transitions to review screen", () => {
    // We know 'review' is index 1 (per HOME_ACTIONS constant in shell-flows.ts)
    const s = dispatch(homeState(1), { type: "select" });
    expect(s.screen.kind).toBe("review");
  });

  it("cursor mapped to 'configure' → transitions to configure screen, cursor=0", () => {
    // configure = index 4 (slice 19 removed export-instructor-pack at index 4,
    // shifting configure from 5 → 4)
    const s = dispatch(homeState(4), { type: "select" });
    expect(s.screen.kind).toBe("configure");
    if (s.screen.kind === "configure") expect(s.screen.cursor).toBe(0);
  });

  it("cursor mapped to 'install' → transitions to install step 1", () => {
    // install = index 6 (was 7 pre-slice-19)
    const s = dispatch(homeState(6), { type: "select" });
    expect(s.screen.kind).toBe("install");
    if (s.screen.kind === "install") {
      expect(s.screen.step).toBe(1);
      expect(s.screen.cursor).toBe(0);
    }
  });

  it("cursor mapped to 'quit' → transitions to exiting", () => {
    // quit = last index (slice 19 menu length 9 → last index = 8)
    const s = dispatch(homeState(HOME_MENU_LEN - 1), { type: "select" });
    expect(s.screen.kind).toBe("exiting");
  });

  it("cursor mapped to 'build' → transitions to doing with label", () => {
    // build = index 0
    const s = dispatch(homeState(0), { type: "select" });
    expect(s.screen.kind).toBe("doing");
    if (s.screen.kind === "doing") {
      expect(s.screen.promise).toBe("pending");
      expect(s.screen.label.length).toBeGreaterThan(0);
      expect(s.screen.returnTo).toBe("home");
    }
  });

  it("cursor mapped to 'doctor' → transitions to doing with doctor label", () => {
    // doctor = index 5 (was 6 pre-slice-19)
    const s = dispatch(homeState(5), { type: "select" });
    expect(s.screen.kind).toBe("doing");
    if (s.screen.kind === "doing") {
      expect(s.screen.promise).toBe("pending");
    }
  });
});

// ---------------------------------------------------------------------------
// select — install step 1 (preset selection)
// ---------------------------------------------------------------------------

describe("select on install step 1", () => {
  function step1State(cursor: number): ShellState {
    return {
      snapshot: makeSnapshot({ installed: false }),
      screen: { kind: "install", step: 1, choices: {}, cursor },
    };
  }

  it("cursor 0 → choices.preset='minimal', step stays 1 (user must wizard.next)", () => {
    // Per design: select sets the choice; wizard.next advances
    const s = dispatch(step1State(0), { type: "select" });
    if (s.screen.kind === "install") {
      expect(s.screen.choices.preset).toBe("minimal");
    }
  });

  it("cursor 1 → choices.preset='standard'", () => {
    const s = dispatch(step1State(1), { type: "select" });
    if (s.screen.kind === "install") {
      expect(s.screen.choices.preset).toBe("standard");
    }
  });

  it("cursor 2 → choices.preset='teaching'", () => {
    const s = dispatch(step1State(2), { type: "select" });
    if (s.screen.kind === "install") {
      expect(s.screen.choices.preset).toBe("teaching");
    }
  });
});

// ---------------------------------------------------------------------------
// select — install step 2 (provider selection)
// ---------------------------------------------------------------------------

describe("select on install step 2", () => {
  function step2State(cursor: number): ShellState {
    return {
      snapshot: makeSnapshot({ installed: false }),
      screen: { kind: "install", step: 2, choices: { preset: "minimal" }, cursor },
    };
  }

  it("cursor 0 → choices.provider='claude-agent-sdk'", () => {
    const s = dispatch(step2State(0), { type: "select" });
    if (s.screen.kind === "install") {
      expect(s.screen.choices.provider).toBe("claude-agent-sdk");
    }
  });

  it("cursor 1 → choices.provider='api-key'", () => {
    const s = dispatch(step2State(1), { type: "select" });
    if (s.screen.kind === "install") {
      expect(s.screen.choices.provider).toBe("api-key");
    }
  });

  it("cursor 2 → choices.provider='disabled'", () => {
    const s = dispatch(step2State(2), { type: "select" });
    if (s.screen.kind === "install") {
      expect(s.screen.choices.provider).toBe("disabled");
    }
  });

  it("preset from step 1 is preserved", () => {
    const s = dispatch(step2State(0), { type: "select" });
    if (s.screen.kind === "install") {
      expect(s.screen.choices.preset).toBe("minimal");
    }
  });
});

// ---------------------------------------------------------------------------
// select — install step 3 (confirm → doing)
// ---------------------------------------------------------------------------

describe("select on install step 3", () => {
  function step3State(): ShellState {
    return {
      snapshot: makeSnapshot({ installed: false }),
      screen: {
        kind: "install",
        step: 3,
        choices: { preset: "minimal", provider: "claude-agent-sdk" },
        cursor: 0,
      },
    };
  }

  it("select on step 3 → transitions to doing screen", () => {
    const s = dispatch(step3State(), { type: "select" });
    expect(s.screen.kind).toBe("doing");
    if (s.screen.kind === "doing") {
      expect(s.screen.promise).toBe("pending");
      expect(s.screen.label.length).toBeGreaterThan(0);
    }
  });

  it("select on step 3 → doing screen carries opts.preset from wizard choices (T6 risk #1)", () => {
    // Wizard had preset="minimal" in choices; doing.opts.preset must match
    const s = dispatch(step3State(), { type: "select" });
    if (s.screen.kind === "doing") {
      expect(s.screen.opts?.preset).toBe("minimal");
    }
  });

  it("select on step 3 with 'standard' preset → doing screen carries opts.preset='standard'", () => {
    const state: ShellState = {
      snapshot: makeSnapshot({ installed: false }),
      screen: {
        kind: "install",
        step: 3,
        choices: { preset: "standard", provider: "api-key" },
        cursor: 0,
      },
    };
    const s = dispatch(state, { type: "select" });
    if (s.screen.kind === "doing") {
      expect(s.screen.opts?.preset).toBe("standard");
    }
  });

  it("select on step 3 with 'teaching' preset → doing screen carries opts.preset='teaching'", () => {
    const state: ShellState = {
      snapshot: makeSnapshot({ installed: false }),
      screen: {
        kind: "install",
        step: 3,
        choices: { preset: "teaching", provider: "disabled" },
        cursor: 0,
      },
    };
    const s = dispatch(state, { type: "select" });
    if (s.screen.kind === "doing") {
      expect(s.screen.opts?.preset).toBe("teaching");
    }
  });
});

// ---------------------------------------------------------------------------
// back actions
// ---------------------------------------------------------------------------

describe("back from configure → home", () => {
  it("back transitions to home, cursor=0", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "configure", cursor: 3 },
    };
    const next = dispatch(s, { type: "back" });
    expect(next.screen.kind).toBe("home");
    if (next.screen.kind === "home") expect(next.screen.cursor).toBe(0);
  });
});

describe("back from review → home", () => {
  it("back transitions to home", () => {
    const s: ShellState = {
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
    const next = dispatch(s, { type: "back" });
    expect(next.screen.kind).toBe("home");
  });
});

describe("back from install", () => {
  it("back from step 1 (installed=false) → exits (exiting)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot({ installed: false }),
      screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
    };
    const next = dispatch(s, { type: "back" });
    // Per design: back from step 1 when not installed → exiting
    expect(next.screen.kind).toBe("exiting");
  });

  it("back from step 1 (installed=true) → home", () => {
    const s: ShellState = {
      snapshot: makeSnapshot({ installed: true }),
      screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
    };
    const next = dispatch(s, { type: "back" });
    expect(next.screen.kind).toBe("home");
  });

  it("back from step 2 → step 1 (preserves choices.preset)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot({ installed: false }),
      screen: { kind: "install", step: 2, choices: { preset: "standard" }, cursor: 1 },
    };
    const next = dispatch(s, { type: "back" });
    expect(next.screen.kind).toBe("install");
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(1);
      expect(next.screen.choices.preset).toBe("standard");
      expect(next.screen.cursor).toBe(0);
    }
  });

  it("back from step 3 → step 2 (preserves both choices)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot({ installed: false }),
      screen: {
        kind: "install",
        step: 3,
        choices: { preset: "teaching", provider: "api-key" },
        cursor: 0,
      },
    };
    const next = dispatch(s, { type: "back" });
    expect(next.screen.kind).toBe("install");
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(2);
      expect(next.screen.choices.preset).toBe("teaching");
      expect(next.screen.choices.provider).toBe("api-key");
    }
  });
});

describe("back from home", () => {
  it("back from home → no-op (per design: use q to quit)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const next = dispatch(s, { type: "back" });
    // Design §3: back from home → no-op (q triggers exit)
    expect(next.screen.kind).toBe("home");
  });
});

describe("back from doing → no-op", () => {
  it("back during doing → state unchanged (cannot abort mid-action)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "doing", label: "Building...", promise: "pending", returnTo: "home" },
    };
    const next = dispatch(s, { type: "back" });
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.promise).toBe("pending");
    }
  });
});

// ---------------------------------------------------------------------------
// wizard.next and wizard.set
// ---------------------------------------------------------------------------

describe("wizard.next", () => {
  it("step 1 with preset set → step 2", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "install", step: 1, choices: { preset: "minimal" }, cursor: 0 },
    };
    const next = dispatch(s, { type: "wizard.next" });
    expect(next.screen.kind).toBe("install");
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(2);
      expect(next.screen.cursor).toBe(0);
    }
  });

  it("step 2 with provider set → step 3", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "install",
        step: 2,
        choices: { preset: "standard", provider: "api-key" },
        cursor: 1,
      },
    };
    const next = dispatch(s, { type: "wizard.next" });
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(3);
      expect(next.screen.cursor).toBe(0);
    }
  });

  it("step 3 → no-op (already at last step)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "install",
        step: 3,
        choices: { preset: "minimal", provider: "disabled" },
        cursor: 0,
      },
    };
    const next = dispatch(s, { type: "wizard.next" });
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(3);
    }
  });

  it("step 1 without preset → no-op (choice must be set first)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
    };
    const next = dispatch(s, { type: "wizard.next" });
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(1);
    }
  });

  it("step 2 without provider → no-op", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "install",
        step: 2,
        choices: { preset: "minimal" },
        cursor: 0,
      },
    };
    const next = dispatch(s, { type: "wizard.next" });
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(2);
    }
  });
});

describe("wizard.set", () => {
  it("sets preset field immutably", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
    };
    const next = dispatch(s, { type: "wizard.set", field: "preset", value: "teaching" });
    if (next.screen.kind === "install") {
      expect(next.screen.choices.preset).toBe("teaching");
    }
    // original is not mutated
    if (s.screen.kind === "install") {
      expect(s.screen.choices.preset).toBeUndefined();
    }
  });

  it("sets provider field without touching preset", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "install", step: 2, choices: { preset: "standard" }, cursor: 0 },
    };
    const next = dispatch(s, { type: "wizard.set", field: "provider", value: "api-key" });
    if (next.screen.kind === "install") {
      expect(next.screen.choices.provider).toBe("api-key");
      expect(next.screen.choices.preset).toBe("standard"); // preserved
    }
  });

  it("returns a new choices object (not the same reference)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
    };
    const next = dispatch(s, { type: "wizard.set", field: "preset", value: "minimal" });
    if (next.screen.kind === "install" && s.screen.kind === "install") {
      expect(next.screen.choices).not.toBe(s.screen.choices);
    }
  });
});

// ---------------------------------------------------------------------------
// doing transitions
// ---------------------------------------------------------------------------

describe("doing transitions", () => {
  function doingPendingState(): ShellState {
    return {
      snapshot: makeSnapshot(),
      screen: { kind: "doing", label: "Building...", promise: "pending", returnTo: "home" },
    };
  }

  it("doing.start → transitions to doing screen with label", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const next = dispatch(s, { type: "doing.start", label: "Doctor...", returnTo: "home" });
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.label).toBe("Doctor...");
      expect(next.screen.promise).toBe("pending");
      expect(next.screen.returnTo).toBe("home");
    }
  });

  // Regression: ShellApp's useEffect(..., [state.screen]) re-fired on every
  // redundant doing.start dispatch, causing runInstallAction to be invoked
  // repeatedly and tripping React's "Maximum update depth exceeded" guard.
  // The reducer must return the SAME state reference when the doing/pending
  // screen would not change materially.
  it("doing.start → idempotent when already in doing/pending with same label/returnTo (preserves ref + opts)", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "doing",
        label: "Installing...",
        promise: "pending",
        returnTo: "home",
        opts: { preset: "teaching" },
      },
    };
    const next = dispatch(s, {
      type: "doing.start",
      label: "Installing...",
      returnTo: "home",
    });
    // Same reference — proves the reducer no-ops (effect deps unchanged).
    expect(next).toBe(s);
    expect(next.screen).toBe(s.screen);
    // opts must survive (proves the no-op preserved wizard payload).
    if (next.screen.kind === "doing") {
      expect(next.screen.opts).toEqual({ preset: "teaching" });
    }
  });

  it("doing.start → creates new state when label differs from current pending screen", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "doing",
        label: "Running build...",
        promise: "pending",
        returnTo: "configure",
      },
    };
    const next = dispatch(s, {
      type: "doing.start",
      label: "Building docs...",
      returnTo: "home",
    });
    expect(next).not.toBe(s);
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.label).toBe("Building docs...");
      expect(next.screen.returnTo).toBe("home");
    }
  });

  it("doing.ok → updates promise to 'ok', message optional", () => {
    const next = dispatch(doingPendingState(), { type: "doing.ok", message: "Done!" });
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.promise).toBe("ok");
      expect(next.screen.message).toBe("Done!");
    }
  });

  it("doing.ok without message → promise='ok', message undefined", () => {
    const next = dispatch(doingPendingState(), { type: "doing.ok" });
    if (next.screen.kind === "doing") {
      expect(next.screen.promise).toBe("ok");
      expect(next.screen.message).toBeUndefined();
    }
  });

  it("doing.err → updates promise to 'err' with message", () => {
    const next = dispatch(doingPendingState(), { type: "doing.err", message: "Build failed" });
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.promise).toBe("err");
      expect(next.screen.message).toBe("Build failed");
    }
  });

  it("doing.dismiss (ok) → returns to home screen", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "doing", label: "Done", promise: "ok", message: "Success", returnTo: "home" },
    };
    const next = dispatch(s, { type: "doing.dismiss" });
    expect(next.screen.kind).toBe("home");
    if (next.screen.kind === "home") {
      expect(next.screen.cursor).toBe(0);
    }
  });

  it("doing.dismiss (err) → returns to home screen", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "doing", label: "Failed", promise: "err", message: "Oops", returnTo: "home" },
    };
    const next = dispatch(s, { type: "doing.dismiss" });
    expect(next.screen.kind).toBe("home");
  });
});

// ---------------------------------------------------------------------------
// snapshot.refresh
// ---------------------------------------------------------------------------

describe("snapshot.refresh", () => {
  it("updates snapshot without changing screen", () => {
    const s: ShellState = {
      snapshot: makeSnapshot({ adrCount: 0 }),
      screen: { kind: "home", cursor: 2 },
    };
    const newSnap = makeSnapshot({ adrCount: 5, lessonCount: 3 });
    const next = dispatch(s, { type: "snapshot.refresh", snapshot: newSnap });
    expect(next.snapshot.adrCount).toBe(5);
    expect(next.snapshot.lessonCount).toBe(3);
    expect(next.screen.kind).toBe("home");
    if (next.screen.kind === "home") {
      expect(next.screen.cursor).toBe(2); // unchanged
    }
  });

  it("new snapshot is a different object reference", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const newSnap = makeSnapshot({ adrCount: 99 });
    const next = dispatch(s, { type: "snapshot.refresh", snapshot: newSnap });
    expect(next.snapshot).toBe(newSnap);
    expect(next.snapshot).not.toBe(s.snapshot);
  });
});

// ---------------------------------------------------------------------------
// review.update
// ---------------------------------------------------------------------------

describe("review.update", () => {
  it("updates nested ReviewState, screen kind unchanged", () => {
    const s: ShellState = {
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
    const newNested = {
      items: [],
      index: 1,
      decisions: { "abc": "promote" as const },
      teachingValues: {},
      exiting: false,
      committed: true,
    };
    const next = dispatch(s, { type: "review.update", nested: newNested });
    expect(next.screen.kind).toBe("review");
    if (next.screen.kind === "review") {
      expect(next.screen.nested.committed).toBe(true);
      expect(next.screen.nested.index).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// exit action
// ---------------------------------------------------------------------------

describe("exit action", () => {
  it("exit → transitions to exiting screen", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const next = dispatch(s, { type: "exit" });
    expect(next.screen.kind).toBe("exiting");
  });

  it("exit from configure → exiting", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "configure", cursor: 1 },
    };
    const next = dispatch(s, { type: "exit" });
    expect(next.screen.kind).toBe("exiting");
  });
});

// ---------------------------------------------------------------------------
// go action
// ---------------------------------------------------------------------------

describe("go action", () => {
  it("go home → home screen with cursor 0", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "configure", cursor: 3 },
    };
    const next = dispatch(s, { type: "go", screen: "home" });
    expect(next.screen.kind).toBe("home");
    if (next.screen.kind === "home") expect(next.screen.cursor).toBe(0);
  });

  it("go configure → configure screen with cursor 0", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 5 },
    };
    const next = dispatch(s, { type: "go", screen: "configure" });
    expect(next.screen.kind).toBe("configure");
    if (next.screen.kind === "configure") expect(next.screen.cursor).toBe(0);
  });

  it("go install → install step 1 with cursor 0", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const next = dispatch(s, { type: "go", screen: "install" });
    expect(next.screen.kind).toBe("install");
    if (next.screen.kind === "install") {
      expect(next.screen.step).toBe(1);
      expect(next.screen.cursor).toBe(0);
    }
  });

  it("go exiting → exiting screen", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const next = dispatch(s, { type: "go", screen: "exiting" });
    expect(next.screen.kind).toBe("exiting");
  });
});

// ---------------------------------------------------------------------------
// Purity tests — reduce never mutates input
// ---------------------------------------------------------------------------

describe("purity — reduce never mutates input", () => {
  it("reduce returns a NEW state object", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const next = reduce(s, { type: "navigate", delta: 1 });
    expect(next).not.toBe(s);
  });

  it("reduce does not mutate input screen object", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    const screenBefore = s.screen;
    reduce(s, { type: "navigate", delta: 1 });
    expect(s.screen).toBe(screenBefore);
    if (s.screen.kind === "home") expect(s.screen.cursor).toBe(0);
  });

  it("reduce does not mutate input snapshot", () => {
    const snap = makeSnapshot({ adrCount: 0 });
    const s: ShellState = { snapshot: snap, screen: { kind: "home", cursor: 0 } };
    const newSnap = makeSnapshot({ adrCount: 10 });
    reduce(s, { type: "snapshot.refresh", snapshot: newSnap });
    expect(s.snapshot.adrCount).toBe(0);
  });

  it("wizard.set returns new choices object, input choices not mutated", () => {
    const choices: InstallWizardChoices = { preset: "minimal" };
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "install", step: 1, choices, cursor: 0 },
    };
    reduce(s, { type: "wizard.set", field: "provider", value: "api-key" });
    expect(choices.provider).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness — unknown action type → state unchanged
// ---------------------------------------------------------------------------

describe("exhaustiveness", () => {
  it("unknown action type → state unchanged", () => {
    const s: ShellState = {
      snapshot: makeSnapshot(),
      screen: { kind: "home", cursor: 0 },
    };
    // Force an unknown action via type cast
    const next = reduce(s, { type: "UNKNOWN_ACTION_XYZ" } as unknown as ShellAction);
    expect(next.screen.kind).toBe("home");
    if (next.screen.kind === "home") expect(next.screen.cursor).toBe(0);
  });
});
