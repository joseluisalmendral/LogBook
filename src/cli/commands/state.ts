/**
 * logbook state --inline — statusline output mode.
 *
 * Design §5 (iter4 T3.7): reads .logbook/state.json synchronously (no SQLite)
 * and prints a single line to stdout:
 *
 *   <phase> | <session> | <pending>
 *
 * Format:
 *   phase   — currentPhase or "—" if absent
 *   session — sessionLabel (or first 8 chars of session id) or "—" if absent
 *   pending — number of warnings or "0" if none
 *
 * This command runs as the Claude Code statusLine shell command.
 * It must complete in ≤200ms (statusline refresh budget).
 * It reads state.json only — no SQLite open, no network.
 *
 * Output:
 *   <phase> | <session> | <pending>
 *
 * Falls back to "— | — | 0" when state is absent or malformed.
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";

export default defineCommand({
  meta: {
    name: "state",
    description: "Show current LogBook state (inline format for statusline)",
  },
  args: {
    inline: {
      type: "boolean",
      default: false,
      description: "Print phase | session | pending (statusline format)",
    },
  },
  async run({ args }) {
    if (args["inline"]) {
      // Inline mode: fast, synchronous, stdout-only.
      // Do not fail on missing project root — fall back gracefully.
      let statePath: string | null = null;
      try {
        const root = resolveProjectRoot();
        const paths = makePaths(root);
        statePath = paths.statePath;
      } catch {
        // Not in a LogBook project — show dashes.
        process.stdout.write("— | — | 0\n");
        return;
      }

      const state = readState(statePath);

      const phase = state.currentPhase ?? "—";
      const session = state.sessionLabel
        ? state.sessionLabel
        : state.session
          ? state.session.slice(0, 8)
          : "—";
      const pending = String(state.warnings.length ?? 0);

      process.stdout.write(`${phase} | ${session} | ${pending}\n`);
      return;
    }

    // Non-inline mode: show full state JSON.
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const paths = makePaths(root);
    const state = readState(paths.statePath);
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
  },
});
