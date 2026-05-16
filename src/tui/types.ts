/**
 * Type contracts for the shell TUI state machine (iter6 T2).
 *
 * These types are shared between:
 *   - src/tui/shell-flows.ts  (pure reducer — Ink-free)
 *   - src/tui/shell.ts        (Ink renderer — T5)
 *
 * Keep this file free of any I/O, framework, or runtime dependencies.
 */

import type { ReviewState } from "../types/review.js";
import type { TokenBreakdown } from "../core/token-measure.js";

// ---------------------------------------------------------------------------
// Preset + Provider
// ---------------------------------------------------------------------------

export type Preset = "minimal" | "standard" | "teaching";

export type ProviderChoice = "claude-agent-sdk" | "api-key" | "disabled";

// ---------------------------------------------------------------------------
// Install wizard choices accumulator
// ---------------------------------------------------------------------------

export interface InstallWizardChoices {
  preset?: Preset;
  provider?: ProviderChoice;
}

// ---------------------------------------------------------------------------
// Screen discriminated union
// ---------------------------------------------------------------------------

export type ShellScreen =
  | { kind: "home"; cursor: number }
  | {
      kind: "install";
      step: 1 | 2 | 3;
      choices: InstallWizardChoices;
      cursor: number;
    }
  | { kind: "configure"; cursor: number }
  | { kind: "review"; nested: ReviewState }
  | {
      kind: "doing";
      label: string;
      promise: "pending" | "ok" | "err";
      message?: string;
      returnTo: Exclude<ShellScreen["kind"], "doing" | "exiting">;
      /**
       * Optional structured options forwarded from the triggering screen.
       * Used to pass wizard choices (e.g. preset) through the doing transition
       * so the action handler can read them without re-deriving from state.
       */
      opts?: { preset?: Preset; safe?: boolean };
    }
  | { kind: "exiting" };

// ---------------------------------------------------------------------------
// Snapshot — read-only view of project state
// ---------------------------------------------------------------------------

export interface ShellSnapshot {
  projectRoot: string | null;
  installed: boolean;
  preset?: Preset;
  disabled?: boolean;
  manifestSize: number;
  tokenBreakdown: TokenBreakdown;
  fixedContextTokens: number;
  budget: number; // 500
  recentEvents: Array<{ ts: string; type: string; preview: string }>;
  pendingReview: number;
  adrCount: number;
  lessonCount: number;
  currentPhase?: string;
  sessionLabel?: string;
}

// ---------------------------------------------------------------------------
// Full shell state
// ---------------------------------------------------------------------------

export interface ShellState {
  snapshot: ShellSnapshot;
  screen: ShellScreen;
}

// ---------------------------------------------------------------------------
// Action discriminated union
// ---------------------------------------------------------------------------

export type ShellAction =
  | { type: "navigate"; delta: 1 | -1 }
  | { type: "select" }
  | { type: "back" }
  | { type: "go"; screen: ShellScreen["kind"] }
  | { type: "wizard.next" }
  | { type: "wizard.back" }
  | { type: "wizard.set"; field: keyof InstallWizardChoices; value: string }
  | { type: "doing.start"; label: string; returnTo: Exclude<ShellScreen["kind"], "doing" | "exiting"> }
  | { type: "doing.ok"; message?: string }
  | { type: "doing.err"; message: string }
  | { type: "doing.dismiss" }
  | { type: "snapshot.refresh"; snapshot: ShellSnapshot }
  | { type: "review.update"; nested: ReviewState }
  | { type: "modal.confirm.show"; message: string; onConfirmAction: ShellAction }
  | { type: "modal.confirm.resolve"; confirmed: boolean }
  | { type: "exit" };
