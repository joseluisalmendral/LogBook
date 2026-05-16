/**
 * logbook ingest — ingest events from an external agent.
 */

import { defineCommand } from "citty";
import claude from "./claude.js";
import otel from "./otel.js";
import codex from "./codex.js";

export default defineCommand({
  meta: {
    name: "ingest",
    description: "Ingest events from an external agent",
  },
  subCommands: { claude, otel, codex },
});
