/**
 * LogBook CLI entry point.
 *
 * Wires all subcommands and delegates to citty's runMain.
 * The shebang (#!/usr/bin/env node) is injected by tsup's banner config.
 */

import { defineCommand, runMain } from "citty";
import init from "./commands/init.js";
import status from "./commands/status.js";
import doctor from "./commands/doctor.js";
import disable from "./commands/disable.js";
import enable from "./commands/enable.js";
import uninstall from "./commands/uninstall.js";
import purge from "./commands/purge.js";
import ingest from "./commands/ingest/index.js";

const main = defineCommand({
  meta: {
    name: "logbook",
    version: "0.1.0",
    description: "LogBook CLI — structured project memory for AI-assisted development",
  },
  subCommands: {
    init,
    status,
    doctor,
    disable,
    enable,
    uninstall,
    purge,
    ingest,
  },
});

runMain(main);
