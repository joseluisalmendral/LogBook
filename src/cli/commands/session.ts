/**
 * logbook session — Session management commands.
 *
 * Parent command; delegates to subcommands:
 *   - rename: rename the current session label
 *   - goal: record a goal for the current session
 *   - outcome: record the outcome of the current session
 *
 * Design §3 CLI command signatures — session row.
 */

import { defineCommand } from "citty";
import rename from "./session/rename.js";
import goal from "./session/goal.js";
import outcome from "./session/outcome.js";

export default defineCommand({
  meta: {
    name: "session",
    description: "Session management",
  },
  subCommands: { rename, goal, outcome },
});
