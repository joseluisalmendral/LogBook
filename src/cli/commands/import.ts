/**
 * logbook import — Import external data as logbook events.
 *
 * Sub-commands:
 *   github-pr <url> — Import claude-code-action runs from a GitHub PR (B2).
 */

import { defineCommand } from "citty";
import githubPr from "./import/github-pr.js";

export default defineCommand({
  meta: {
    name: "import",
    description: "Import external data as logbook events",
  },
  subCommands: {
    "github-pr": githubPr,
  },
});
