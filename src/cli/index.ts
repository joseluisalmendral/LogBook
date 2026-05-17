/**
 * LogBook CLI entry point.
 *
 * Wires all subcommands and delegates to citty's runMain.
 * The shebang (#!/usr/bin/env node) is injected by tsup's banner config.
 *
 * Zero-arg intercept (iter6 T6):
 *   When invoked with no arguments AND both stdin and stdout are TTYs,
 *   the interactive shell TUI is launched instead of printing citty help.
 *   Any error from the shell falls through to runMain (safe degradation).
 *   Non-TTY invocations (CI, scripts, piped) always go straight to runMain.
 */

import { defineCommand, runMain } from "citty";
import init from "./commands/init.js";
import status from "./commands/status.js";
import state from "./commands/state.js";
import doctor from "./commands/doctor.js";
import disable from "./commands/disable.js";
import enable from "./commands/enable.js";
import uninstall from "./commands/uninstall.js";
import purge from "./commands/purge.js";
import ingest from "./commands/ingest/index.js";
import start from "./commands/start.js";
import phase from "./commands/phase.js";
import session from "./commands/session.js";
import snapshot from "./commands/snapshot.js";
import visual from "./commands/visual.js";
import decision from "./commands/decision.js";
import error from "./commands/error.js";
import fix from "./commands/fix.js";
import lesson from "./commands/lesson.js";
import resource from "./commands/resource.js";
import milestone from "./commands/milestone.js";
import build from "./commands/build.js";
import exportCmd from "./commands/export.js";
import providers from "./commands/providers.js";
import summarize from "./commands/summarize.js";
import promote from "./commands/promote.js";
import review from "./commands/review.js";
import teachingScript from "./commands/teaching-script.js";
import annotate from "./commands/annotate.js";

const main = defineCommand({
  meta: {
    name: "logbook",
    version: "0.1.0",
    description: "LogBook CLI — structured project memory for AI-assisted development",
  },
  subCommands: {
    init,
    status,
    state,
    doctor,
    disable,
    enable,
    uninstall,
    purge,
    ingest,
    start,
    phase,
    session,
    snapshot,
    visual,
    decision,
    error,
    fix,
    lesson,
    resource,
    milestone,
    build,
    export: exportCmd,
    providers,
    summarize,
    promote,
    review,
    "teaching-script": teachingScript,
    annotate,
  },
});

// ---------------------------------------------------------------------------
// Zero-arg intercept — launch TUI shell when invoked interactively
// ---------------------------------------------------------------------------

/**
 * Attempt to launch the interactive TUI shell.
 *
 * Returns true if the shell handled the invocation (caller should return).
 * Returns false if the shell should be skipped (fall through to runMain).
 *
 * Conditions for launching the shell:
 *   1. No subcommand/flag arguments (process.argv.length === 2).
 *   2. Both stdin AND stdout are TTYs (interactive terminal session).
 *
 * The dynamic import keeps Ink + React out of the cold-start bundle for all
 * subcommand invocations (design §6, ADR-iter6-04).
 */
async function maybeShell(): Promise<boolean> {
  // argv[0] = node, argv[1] = script path — length === 2 means no user args
  if (process.argv.length !== 2) return false;
  // Both stdin and stdout must be TTYs — prevents shell launch in CI / pipes
  if (!(process.stdin.isTTY && process.stdout.isTTY)) return false;

  try {
    const { runShell } = await import("../tui/shell.js");
    await runShell();
    return true;
  } catch (err) {
    if (process.env["LOGBOOK_DEBUG"] === "1") {
      process.stderr.write(`[shell] ${(err as Error).message}\n`);
    }
    // Fall through to runMain — citty prints help on no-args invocation
    return false;
  }
}

(async () => {
  if (await maybeShell()) return;
  await runMain(main);
})();
