/**
 * logbook ingest — ingest events from an external agent.
 */

import { defineCommand } from "citty";
import claude from "./claude.js";

export default defineCommand({
  meta: {
    name: "ingest",
    description: "Ingest events from an external agent",
  },
  subCommands: { claude },
});
