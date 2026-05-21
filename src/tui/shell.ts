/**
 * shell.ts — Ink entry point for the LogBook TUI (iter6 T5).
 *
 * Pattern: mirrors src/review/tui.ts (iter3). Pure reducer (shell-flows.ts)
 * + thin Ink wrapper (this file). Side effects in persist.ts.
 *
 * Two exports:
 *   - ShellApp({ initialSnapshot, handlers? }) — testable Ink component.
 *     handlers is an optional injection point for tests (stubs).
 *   - runShell(opts?) — full-screen entry point; resolves project root,
 *     builds snapshot, renders ShellApp, awaits exit.
 *
 * Key design points (ADR-iter6-04: React.createElement, no JSX):
 *   - useReducer(reduce, initialState(snapshot))
 *   - useInput → keypressToAction → dispatch
 *   - useEffect watching screen transitions to "doing, promise=pending"
 *     → invoke matching action handler (side effect bridge)
 *   - useEffect watching screen.kind === "exiting" → useApp().exit()
 */

import React, { useReducer, useEffect } from "react";
import { Box, render, useApp, useInput } from "ink";
import { initialState, reduce } from "./shell-flows.js";
import {
  buildSnapshot,
  runInstallAction,
  runUninstallAction,
  runBuildAction,
  runExportHtmlAction,
  runExportInstructorPackAction,
  runDoctorAction,
  runToggleDisabledAction,
  runProviderTestAction,
  runProviderRemoveAction,
  runProviderAddAction,
} from "./persist.js";
import {
  HomeScreen,
  InstallWizardScreen,
  ConfigureScreen,
  ReviewBridgeScreen,
  DoingScreen,
  ProvidersScreen,
} from "./screens/index.js";
import { resolveProjectRoot, makePaths } from "../core/paths.js";
import type { ShellSnapshot, ShellState, ShellAction, ShellScreen } from "./types.js";
import type { ActionContext } from "./persist.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunShellOptions {
  /** For testing: inject a pre-built snapshot, bypassing disk reads. */
  initialSnapshot?: ShellSnapshot;
}

/**
 * Optional action handler injection for tests.
 * Mirrors the shape of the action handlers in persist.ts.
 */
export interface ShellHandlers {
  runInstall?: (ctx: ActionContext, opts: { preset: "minimal" | "standard" | "teaching" }) => Promise<void>;
  runUninstall?: (ctx: ActionContext) => Promise<void>;
  runBuild?: (ctx: ActionContext) => Promise<void>;
  runExportHtml?: (ctx: ActionContext) => Promise<void>;
  runExportInstructorPack?: (ctx: ActionContext, opts?: { safe?: boolean }) => Promise<void>;
  runDoctor?: (ctx: ActionContext) => Promise<void>;
  runToggleDisabled?: (ctx: ActionContext, currentDisabled: boolean) => Promise<void>;
  runProviderTest?: (ctx: ActionContext, opts: { providerId: string }) => Promise<void>;
  runProviderRemove?: (ctx: ActionContext, opts: { providerId: string }) => Promise<void>;
  runProviderAdd?: (ctx: ActionContext, opts: { name: string; kind: string; model: string; envVar: string }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Keypress → action mapper
// ---------------------------------------------------------------------------

function keypressToAction(
  screen: ShellScreen,
  input: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
): ShellAction | null {
  // Global navigation
  if (input === "j" || key.downArrow) return { type: "navigate", delta: 1 };
  if (input === "k" || key.upArrow) return { type: "navigate", delta: -1 };

  // Escape / back
  if (key.escape || input === "b") {
    if (screen.kind === "home") {
      // q on home → exit (design §5: q shows confirm; using direct exit for simplicity)
      return null;
    }
    return { type: "back" };
  }

  // Enter / select
  if (key.return) {
    if (screen.kind === "doing" && screen.promise !== "pending") {
      return { type: "doing.dismiss" };
    }
    return { type: "select" };
  }

  // Wizard navigation
  if (screen.kind === "install") {
    if (key.tab || input === "n") return { type: "wizard.next" };
    if (input === "p") return { type: "wizard.back" };
    // Step 3 explicit confirm keys — matches the keybindings the footer
    // advertises ("[i] Install [d] Dry-run [esc] Back"). Previously only
    // Enter worked, which confused users who saw `i` in the footer.
    // `d` (dry-run) currently triggers the same install action; dry-run
    // semantics will land when the install action exposes a dry-run flag.
    if (screen.step === 3 && (input === "i" || input === "d")) {
      return { type: "select" };
    }
  }

  // q on home → exit (design §9: confirm modal for home; direct for subscreens)
  if (input === "q") {
    if (screen.kind === "home") {
      return { type: "exit" };
    }
    return { type: "back" };
  }

  // Ctrl+C → always exit
  if (key.ctrl && input === "c") {
    return { type: "exit" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Resolve action label → handler name
// ---------------------------------------------------------------------------

/**
 * Determine which action handler to call based on the doing screen's label.
 * The label is set by shell-flows.ts when transitioning to doing state.
 */
function resolveHandler(
  label: string,
  state: ShellState,
  paths: import("../core/paths.js").ProjectPaths,
  dispatch: (a: ShellAction) => void,
  handlers: ShellHandlers,
): void {
  const ctx: ActionContext = { paths, dispatch };

  if (label === "Installing...") {
    // Read wizard choices forwarded via doing screen opts (T6 risk #1 fix).
    // Falls back to snapshot preset, then "minimal" as last resort.
    const screen = state.screen;
    const chosenPreset =
      (screen.kind === "doing" && screen.opts?.preset) ??
      state.snapshot.preset ??
      "minimal";
    const preset = chosenPreset as "minimal" | "standard" | "teaching";
    const fn = handlers.runInstall ?? runInstallAction;
    void fn(ctx, { preset });
    return;
  }

  if (label === "Uninstalling...") {
    const fn = handlers.runUninstall ?? runUninstallAction;
    void fn(ctx);
    return;
  }

  if (label.startsWith("Building") || label === "Building docs...") {
    const fn = handlers.runBuild ?? runBuildAction;
    void fn(ctx);
    return;
  }

  if (label.startsWith("Exporting HTML")) {
    const fn = handlers.runExportHtml ?? runExportHtmlAction;
    void fn(ctx);
    return;
  }

  if (label.startsWith("Exporting instructor")) {
    const fn = handlers.runExportInstructorPack ?? runExportInstructorPackAction;
    void fn(ctx);
    return;
  }

  if (label.startsWith("Running doctor")) {
    const fn = handlers.runDoctor ?? runDoctorAction;
    void fn(ctx);
    return;
  }

  if (label.startsWith("Enabling") || label.startsWith("Disabling")) {
    const currentDisabled = state.snapshot.disabled ?? false;
    const fn = handlers.runToggleDisabled ?? runToggleDisabledAction;
    void fn(ctx, currentDisabled);
    return;
  }

  if (label.startsWith("Testing provider ")) {
    // Extract provider id from label: "Testing provider <id>..."
    const providerId = label.slice("Testing provider ".length).replace(/\.\.\.$/, "");
    const fn = handlers.runProviderTest ?? runProviderTestAction;
    void fn(ctx, { providerId });
    return;
  }

  if (label.startsWith("Removing provider ")) {
    const providerId = label.slice("Removing provider ".length).replace(/\.\.\.$/, "");
    const fn = handlers.runProviderRemove ?? runProviderRemoveAction;
    void fn(ctx, { providerId });
    return;
  }

  if (label === "Adding provider...") {
    const screen = state.screen;
    // Read wizard fields forwarded via doing screen opts.providerAdd.
    // These were set by the providers.add.commit reducer case.
    const providerAdd = screen.kind === "doing" ? screen.opts?.providerAdd : undefined;
    if (providerAdd) {
      const fn = handlers.runProviderAdd ?? runProviderAddAction;
      void fn(ctx, providerAdd as { name: string; kind: import("../types/providers.js").ProviderEntry["kind"]; model: string; envVar: string });
    } else {
      dispatch({ type: "doing.err", message: "Missing provider fields — cannot add" });
    }
    return;
  }

  // Unknown label → dispatch doing.err
  dispatch({ type: "doing.err", message: `Unknown action: ${label}` });
}

// ---------------------------------------------------------------------------
// ShellApp — testable Ink component
// ---------------------------------------------------------------------------

export interface ShellAppProps {
  initialSnapshot: ShellSnapshot;
  handlers?: ShellHandlers;
}

/**
 * Main Ink component for the LogBook TUI shell.
 *
 * Accepts an injected initialSnapshot (allows tests to bypass disk I/O).
 * Uses useReducer for pure state transitions and useEffect for side-effect dispatch.
 */
export function ShellApp({ initialSnapshot, handlers = {} }: ShellAppProps): React.ReactElement {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(initialSnapshot));

  // ---------------------------------------------------------------------------
  // Side-effect bridge: when screen transitions to doing+pending, call handler
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const screen = state.screen;
    if (screen.kind !== "doing" || screen.promise !== "pending") return;

    // Paths may be null when not installed (install wizard path)
    const paths = state.snapshot.projectRoot
      ? makePaths(state.snapshot.projectRoot)
      : null;

    if (paths === null) {
      dispatch({ type: "doing.err", message: "No project root — cannot run action" });
      return;
    }

    resolveHandler(screen.label, state, paths, dispatch, handlers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.screen]);

  // ---------------------------------------------------------------------------
  // Exit bridge: when screen is "exiting", call useApp().exit()
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (state.screen.kind === "exiting") {
      exit();
    }
  }, [state.screen.kind, exit]);

  // ---------------------------------------------------------------------------
  // Key handler
  // ---------------------------------------------------------------------------

  useInput((input, key) => {
    const action = keypressToAction(state.screen, input, key);
    if (action) dispatch(action);
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const screen = state.screen;

  return React.createElement(
    Box,
    { flexDirection: "column" },
    renderScreen(screen, state, dispatch),
  );
}

function renderScreen(
  screen: ShellScreen,
  state: ShellState,
  dispatch: (a: ShellAction) => void,
): React.ReactNode {
  switch (screen.kind) {
    case "home":
      return React.createElement(HomeScreen, { state, dispatch });

    case "install":
      return React.createElement(InstallWizardScreen, { state, dispatch });

    case "configure":
      return React.createElement(ConfigureScreen, { state, dispatch });

    case "review":
      return React.createElement(ReviewBridgeScreen, { state, dispatch });

    case "providers":
      return React.createElement(ProvidersScreen, { state, dispatch });

    case "doing":
      return React.createElement(DoingScreen, { state, dispatch });

    case "exiting":
      // Transitioning out — render nothing
      return null;

    default:
      // Exhaustiveness guard — should never reach here
      return null;
  }
}

// ---------------------------------------------------------------------------
// runShell — full-screen entry point
// ---------------------------------------------------------------------------

/**
 * Mount the ShellApp Ink tree and return a Promise<void> that resolves
 * when the user exits (q, Ctrl+C).
 *
 * Algorithm:
 *   1. Resolve project root (catch → null)
 *   2. Build initial snapshot (null paths → empty snapshot)
 *   3. render(ShellApp) → get RenderInstance
 *   4. waitUntilExit() → return
 */
export async function runShell(opts?: RunShellOptions): Promise<void> {
  let initialSnapshot: ShellSnapshot;

  if (opts?.initialSnapshot) {
    initialSnapshot = opts.initialSnapshot;
  } else {
    // Resolve project root. If the directory has no `.git` / `package.json` /
    // `.claude` marker, fall back to `process.cwd()` so the install wizard
    // can still run (regression 2026-05-21 audit, CRITICAL #4: when paths
    // was null the side-effect bridge always dispatched
    // `doing.err: "No project root"`, making the wizard's "i" / "d" install
    // keys an instant failure on fresh directories).
    //
    // Falling back to cwd means: if the user runs `logbook` in a marker-less
    // dir and proceeds through the wizard, LogBook will install there. This
    // mirrors `logbook init --here` from the CLI.
    let paths: ReturnType<typeof makePaths>;
    try {
      paths = makePaths(resolveProjectRoot());
    } catch {
      paths = makePaths(process.cwd());
    }

    initialSnapshot = await buildSnapshot(paths);
  }

  const { waitUntilExit } = render(
    React.createElement(ShellApp, { initialSnapshot }),
  );

  await waitUntilExit();
}
