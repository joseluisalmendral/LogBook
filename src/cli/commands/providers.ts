/**
 * logbook providers — Manage LLM providers (.logbook/providers.json).
 *
 * Subcommands:
 *   list   List configured providers
 *   set    Set provider mapping for a task or phase
 *   test   Test LLM connectivity via the configured router
 */

import { defineCommand } from "citty";
import list from "./providers/list.js";
import set from "./providers/set.js";
import testCmd from "./providers/test.js";

export default defineCommand({
  meta: {
    name: "providers",
    description: "Manage LLM providers (.logbook/providers.json)",
  },
  subCommands: { list, set, test: testCmd },
});
