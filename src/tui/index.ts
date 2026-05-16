/**
 * src/tui/index.ts — Barrel exports for the LogBook TUI module (iter6 T5).
 *
 * Re-exports:
 *   - runShell, ShellApp from shell.ts (Ink entry points)
 *   - reduce, initialState from shell-flows.ts (pure reducer)
 *   - types from types.ts (discriminated unions)
 */

export { runShell, ShellApp } from "./shell.js";
export type { RunShellOptions, ShellAppProps, ShellHandlers } from "./shell.js";

export { reduce, initialState } from "./shell-flows.js";
export type {
  // Re-export constants and action arrays for external use
} from "./shell-flows.js";

export * as types from "./types.js";
