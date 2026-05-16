/**
 * logbook export — parent command with format subcommands (T12).
 *
 * Design §3 CLI command signatures — export row.
 * Subcommands: html
 */

import { defineCommand } from "citty";
import html from "./export/html.js";

export default defineCommand({
  meta: {
    name: "export",
    description: "Export LogBook docs to other formats",
  },
  subCommands: {
    html,
  },
});
