/**
 * logbook summarize — Generate LLM-backed summaries.
 *
 * Subcommands:
 *   milestone [id|last]   Summarize a specific milestone (default: last)
 *   project               Summarize the full project arc
 */

import { defineCommand } from "citty";
import milestone from "./summarize/milestone.js";
import project from "./summarize/project.js";

export default defineCommand({
  meta: {
    name: "summarize",
    description: "Generate LLM-backed summaries",
  },
  subCommands: { milestone, project },
});
