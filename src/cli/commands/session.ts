/**
 * logbook session — Session management commands.
 *
 * Parent command; delegates to subcommands:
 *   - rename: rename the current session label
 *
 * Design §3 CLI command signatures — session row.
 */

import { defineCommand } from "citty";
import rename from "./session/rename.js";

export default defineCommand({
  meta: {
    name: "session",
    description: "Session management",
  },
  subCommands: { rename },
});
