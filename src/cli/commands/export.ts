/**
 * logbook export — parent command with format subcommands (T12, iter5).
 *
 * Design §3 CLI command signatures — export row.
 * Subcommands: html, instructor-pack, pdf
 */

import { defineCommand } from "citty";
import html from "./export/html.js";
import instructorPack from "./export/instructor-pack.js";
import pdf from "./export/pdf.js";

export default defineCommand({
  meta: {
    name: "export",
    description: "Export LogBook docs to other formats",
  },
  subCommands: {
    html,
    "instructor-pack": instructorPack,
    pdf,
  },
});
