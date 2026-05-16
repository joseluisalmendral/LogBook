/**
 * shell-flows.ts — Shell TUI state machine (iter6 T2).
 *
 * This module is STRICTLY Ink-free. No React, no framework imports.
 * No I/O — pure functions only.
 *
 * Pattern mirrors src/review/flows.ts exactly:
 *   - Explicit switch on action.type
 *   - Never `as any`
 *   - Return new state object literally (spread)
 *   - Cursor clamping via Math.min / Math.max (same as review/flows.ts)
 *   - default branch returns state unchanged (exhaustiveness guard)
 */

import type {
  ShellState,
  ShellSnapshot,
  ShellAction,
  ShellScreen,
  InstallWizardChoices,
} from "./types.js";
import type { ReviewState } from "../types/review.js";

// ---------------------------------------------------------------------------
// Menu length constants
//
// HOME_ACTIONS (0-indexed):
//   0=build, 1=review, 2=summarize, 3=export-html, 4=export-instructor-pack,
//   5=configure, 6=doctor, 7=install, 8=uninstall, 9=quit
//
// Cursor clamping policy (mirrors review/flows.ts Math.min/Math.max):
//   - navigate +1 past last → CLAMP at last (no-op)
//   - navigate -1 below 0  → CLAMP at 0    (no-op)
// ---------------------------------------------------------------------------

export const HOME_ACTIONS = [
  "build",
  "review",
  "summarize",
  "export-html",
  "export-instructor-pack",
  "configure",
  "doctor",
  "install",
  "uninstall",
  "quit",
] as const;

export const CONFIGURE_ACTIONS = [
  "switch-preset",
  "toggle-disabled",
  "manage-providers",
  "set-phase",
  "rename-session",
  "rerun-doctor",
  "back",
] as const;

export const HOME_MENU_LEN = HOME_ACTIONS.length;         // 10
export const CONFIGURE_MENU_LEN = CONFIGURE_ACTIONS.length; // 7
export const INSTALL_STEP1_LEN = 3; // minimal | standard | teaching
export const INSTALL_STEP2_LEN = 3; // claude-agent-sdk | api-key | disabled

// Preset options for install step 1 (cursor → value)
const PRESET_OPTIONS = ["minimal", "standard", "teaching"] as const;

// Provider options for install step 2 (cursor → value)
const PROVIDER_OPTIONS = ["claude-agent-sdk", "api-key", "disabled"] as const;

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

/**
 * Build initial ShellState from a snapshot.
 * Pure — no I/O.
 *
 * If installed → start on home screen.
 * If not installed → start on install wizard step 1.
 */
export function initialState(snapshot: ShellSnapshot): ShellState {
  if (snapshot.installed) {
    return {
      snapshot,
      screen: { kind: "home", cursor: 0 },
    };
  }
  return {
    snapshot,
    screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
  };
}

// ---------------------------------------------------------------------------
// reduce — pure state machine
// ---------------------------------------------------------------------------

/**
 * Pure reducer. Returns a NEW state object; never mutates input.
 */
export function reduce(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    // -------------------------------------------------------------------------
    // navigate — move cursor up/down within current screen
    // -------------------------------------------------------------------------
    case "navigate": {
      const { delta } = action;
      const screen = state.screen;

      switch (screen.kind) {
        case "home":
          return {
            ...state,
            screen: {
              ...screen,
              cursor: Math.max(0, Math.min(screen.cursor + delta, HOME_MENU_LEN - 1)),
            },
          };

        case "install": {
          const maxLen =
            screen.step === 1
              ? INSTALL_STEP1_LEN - 1
              : screen.step === 2
                ? INSTALL_STEP2_LEN - 1
                : 0; // step 3 has no cursor movement (preview + confirm/abort)
          return {
            ...state,
            screen: {
              ...screen,
              cursor: Math.max(0, Math.min(screen.cursor + delta, maxLen)),
            },
          };
        }

        case "configure":
          return {
            ...state,
            screen: {
              ...screen,
              cursor: Math.max(0, Math.min(screen.cursor + delta, CONFIGURE_MENU_LEN - 1)),
            },
          };

        // review, doing, exiting: navigate is a no-op
        default:
          return state;
      }
    }

    // -------------------------------------------------------------------------
    // select — confirm current cursor position
    // -------------------------------------------------------------------------
    case "select": {
      const screen = state.screen;

      switch (screen.kind) {
        case "home": {
          const action_name = HOME_ACTIONS[screen.cursor];
          switch (action_name) {
            case "review":
              return {
                ...state,
                screen: {
                  kind: "review",
                  nested: emptyReviewState(),
                },
              };

            case "configure":
              return {
                ...state,
                screen: { kind: "configure", cursor: 0 },
              };

            case "install":
              return {
                ...state,
                screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
              };

            case "quit":
              return { ...state, screen: { kind: "exiting" } };

            case "build":
              return {
                ...state,
                screen: {
                  kind: "doing",
                  label: "Building...",
                  promise: "pending",
                  returnTo: "home",
                },
              };

            case "summarize":
              return {
                ...state,
                screen: {
                  kind: "doing",
                  label: "Summarizing...",
                  promise: "pending",
                  returnTo: "home",
                },
              };

            case "export-html":
              return {
                ...state,
                screen: {
                  kind: "doing",
                  label: "Exporting HTML...",
                  promise: "pending",
                  returnTo: "home",
                },
              };

            case "export-instructor-pack":
              return {
                ...state,
                screen: {
                  kind: "doing",
                  label: "Exporting instructor pack...",
                  promise: "pending",
                  returnTo: "home",
                },
              };

            case "doctor":
              return {
                ...state,
                screen: {
                  kind: "doing",
                  label: "Running doctor...",
                  promise: "pending",
                  returnTo: "home",
                },
              };

            case "uninstall":
              return {
                ...state,
                screen: {
                  kind: "doing",
                  label: "Uninstalling...",
                  promise: "pending",
                  returnTo: "home",
                },
              };

            default:
              return state;
          }
        }

        case "install": {
          const { step, cursor, choices } = screen;

          if (step === 1) {
            const preset = PRESET_OPTIONS[cursor];
            if (!preset) return state;
            return {
              ...state,
              screen: {
                ...screen,
                choices: { ...choices, preset },
              },
            };
          }

          if (step === 2) {
            const provider = PROVIDER_OPTIONS[cursor];
            if (!provider) return state;
            return {
              ...state,
              screen: {
                ...screen,
                choices: { ...choices, provider },
              },
            };
          }

          if (step === 3) {
            // Confirm → transition to doing, forwarding wizard choices as opts
            const doingScreen: import("./types.js").ShellScreen & { kind: "doing" } = {
              kind: "doing",
              label: "Installing...",
              promise: "pending",
              returnTo: "home",
            };
            if (choices.preset !== undefined) {
              doingScreen.opts = { preset: choices.preset };
            }
            return { ...state, screen: doingScreen };
          }

          return state;
        }

        case "configure": {
          // Configure actions handled by screen renderers for now.
          // Structural transitions go here; sub-options call doing.start from T5.
          const action_name = CONFIGURE_ACTIONS[screen.cursor];
          switch (action_name) {
            case "switch-preset":
              return {
                ...state,
                screen: { kind: "install", step: 1, choices: {}, cursor: 0 },
              };
            case "back":
              return { ...state, screen: { kind: "home", cursor: 0 } };
            default:
              // Other configure options (toggle-disabled, manage-providers, etc.)
              // trigger doing transitions via persist.ts handlers in T5.
              return {
                ...state,
                screen: {
                  kind: "doing",
                  label: `Running ${action_name ?? "action"}...`,
                  promise: "pending",
                  returnTo: "configure",
                },
              };
          }
        }

        // doing, exiting: select is a no-op (wait for doing.ok/err or user to dismiss)
        default:
          return state;
      }
    }

    // -------------------------------------------------------------------------
    // back — navigate to parent screen
    // -------------------------------------------------------------------------
    case "back": {
      const screen = state.screen;

      switch (screen.kind) {
        case "home":
          // Per design §3: back from home → no-op (use q to quit, which shows confirm modal in T5)
          return state;

        case "configure":
          return { ...state, screen: { kind: "home", cursor: 0 } };

        case "review":
          return { ...state, screen: { kind: "home", cursor: 0 } };

        case "install": {
          const { step, choices } = screen;
          if (step === 1) {
            // If the project is already installed, return to home; otherwise exit
            if (state.snapshot.installed) {
              return { ...state, screen: { kind: "home", cursor: 0 } };
            }
            return { ...state, screen: { kind: "exiting" } };
          }
          if (step === 2) {
            return {
              ...state,
              screen: {
                kind: "install",
                step: 1,
                choices: { ...choices },
                cursor: 0,
              },
            };
          }
          if (step === 3) {
            return {
              ...state,
              screen: {
                kind: "install",
                step: 2,
                choices: { ...choices },
                cursor: 0,
              },
            };
          }
          return state;
        }

        case "doing":
          // Per design §3: back from doing → no-op (cannot abort mid-action)
          return state;

        case "exiting":
          // Already exiting; no-op
          return state;

        default:
          return state;
      }
    }

    // -------------------------------------------------------------------------
    // go — direct navigation to a specific screen
    // -------------------------------------------------------------------------
    case "go": {
      const target = action.screen;
      switch (target) {
        case "home":
          return { ...state, screen: { kind: "home", cursor: 0 } };
        case "configure":
          return { ...state, screen: { kind: "configure", cursor: 0 } };
        case "install":
          return { ...state, screen: { kind: "install", step: 1, choices: {}, cursor: 0 } };
        case "review":
          return { ...state, screen: { kind: "review", nested: emptyReviewState() } };
        case "doing":
          // go to doing requires using doing.start instead
          return state;
        case "exiting":
          return { ...state, screen: { kind: "exiting" } };
        default:
          return state;
      }
    }

    // -------------------------------------------------------------------------
    // wizard.next — advance wizard step (requires relevant choice to be set)
    // -------------------------------------------------------------------------
    case "wizard.next": {
      const screen = state.screen;
      if (screen.kind !== "install") return state;

      if (screen.step === 1) {
        // Require preset to be set before advancing
        if (!screen.choices.preset) return state;
        return {
          ...state,
          screen: { ...screen, step: 2, cursor: 0 },
        };
      }

      if (screen.step === 2) {
        // Require provider to be set before advancing
        if (!screen.choices.provider) return state;
        return {
          ...state,
          screen: { ...screen, step: 3, cursor: 0 },
        };
      }

      // step 3: already at last step → no-op
      return state;
    }

    // -------------------------------------------------------------------------
    // wizard.back — go to previous wizard step
    // -------------------------------------------------------------------------
    case "wizard.back": {
      const screen = state.screen;
      if (screen.kind !== "install") return state;

      if (screen.step === 2) {
        return {
          ...state,
          screen: { ...screen, step: 1, cursor: 0 },
        };
      }

      if (screen.step === 3) {
        return {
          ...state,
          screen: { ...screen, step: 2, cursor: 0 },
        };
      }

      // step 1: delegate to back action semantics
      return state;
    }

    // -------------------------------------------------------------------------
    // wizard.set — set a choice field immutably
    // -------------------------------------------------------------------------
    case "wizard.set": {
      const screen = state.screen;
      if (screen.kind !== "install") return state;

      const newChoices: InstallWizardChoices = {
        ...screen.choices,
        [action.field]: action.value,
      };
      return {
        ...state,
        screen: { ...screen, choices: newChoices },
      };
    }

    // -------------------------------------------------------------------------
    // doing.start — transition to doing screen
    // -------------------------------------------------------------------------
    case "doing.start":
      return {
        ...state,
        screen: {
          kind: "doing",
          label: action.label,
          promise: "pending",
          returnTo: action.returnTo,
        },
      };

    // -------------------------------------------------------------------------
    // doing.ok — mark doing as successful
    // -------------------------------------------------------------------------
    case "doing.ok": {
      const screen = state.screen;
      if (screen.kind !== "doing") return state;
      const base = { kind: "doing" as const, label: screen.label, promise: "ok" as const, returnTo: screen.returnTo };
      const updated: ShellScreen = action.message !== undefined
        ? { ...base, message: action.message }
        : base;
      return { ...state, screen: updated };
    }

    // -------------------------------------------------------------------------
    // doing.err — mark doing as failed
    // -------------------------------------------------------------------------
    case "doing.err": {
      const screen = state.screen;
      if (screen.kind !== "doing") return state;
      return {
        ...state,
        screen: {
          ...screen,
          promise: "err",
          message: action.message,
        },
      };
    }

    // -------------------------------------------------------------------------
    // doing.dismiss — return to returnTo screen after completion/error
    // -------------------------------------------------------------------------
    case "doing.dismiss": {
      const screen = state.screen;
      if (screen.kind !== "doing") return state;

      const returnTo = screen.returnTo;
      switch (returnTo) {
        case "home":
          return { ...state, screen: { kind: "home", cursor: 0 } };
        case "configure":
          return { ...state, screen: { kind: "configure", cursor: 0 } };
        case "install":
          return { ...state, screen: { kind: "install", step: 1, choices: {}, cursor: 0 } };
        case "review":
          return { ...state, screen: { kind: "review", nested: emptyReviewState() } };
        default:
          return { ...state, screen: { kind: "home", cursor: 0 } };
      }
    }

    // -------------------------------------------------------------------------
    // snapshot.refresh — update snapshot without changing screen
    // -------------------------------------------------------------------------
    case "snapshot.refresh":
      return { ...state, snapshot: action.snapshot };

    // -------------------------------------------------------------------------
    // review.update — update nested ReviewState inside review screen
    // -------------------------------------------------------------------------
    case "review.update": {
      const screen = state.screen;
      if (screen.kind !== "review") return state;
      return {
        ...state,
        screen: { ...screen, nested: action.nested },
      };
    }

    // -------------------------------------------------------------------------
    // modal.confirm.show — store confirm dialog on the current screen
    // (overlay only — not modeled as a separate screen kind per design §3)
    // For T2, we transition to a special doing-like state; T5 will implement
    // the actual modal overlay using Ink. The reducer records intent.
    // -------------------------------------------------------------------------
    case "modal.confirm.show":
      // Store in state for the Ink layer to render as an overlay.
      // Implementation deferred to T5 (modal overlay component).
      // For now, return state unchanged — the Ink layer will handle display.
      return state;

    // -------------------------------------------------------------------------
    // modal.confirm.resolve — replay or dismiss the confirm action
    // -------------------------------------------------------------------------
    case "modal.confirm.resolve":
      // Implementation deferred to T5.
      return state;

    // -------------------------------------------------------------------------
    // exit — transition to exiting screen
    // -------------------------------------------------------------------------
    case "exit":
      return { ...state, screen: { kind: "exiting" } };

    // -------------------------------------------------------------------------
    // default — unknown action type → state unchanged (exhaustiveness guard)
    // -------------------------------------------------------------------------
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptyReviewState(): ReviewState {
  return {
    items: [],
    index: 0,
    decisions: {},
    teachingValues: {},
    exiting: false,
    committed: false,
  };
}

// Satisfy TypeScript exhaustiveness for ShellScreen["kind"] in go action.
// The type is already complete; this is a development guard.
type _AssertGoScreenKinds = ShellScreen["kind"];
