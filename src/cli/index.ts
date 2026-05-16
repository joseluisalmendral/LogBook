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
  },
});

runMain(main);
